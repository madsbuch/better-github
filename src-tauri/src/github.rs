//! Thin authenticated proxy to the GitHub REST and GraphQL APIs.
//!
//! Without a session (guest mode), REST reads and download links go out
//! without a token, so public data stays browsable; writes need a token.
//!
//! The token never leaves the Rust side. Requests can only target
//! `https://api.github.com`, so a compromised page cannot exfiltrate the
//! token by pointing a request at another host.

use std::collections::BTreeMap;
use std::time::Duration;

use reqwest::header::{
    HeaderMap, HeaderValue, ACCEPT, AUTHORIZATION, CONTENT_TYPE, LINK, LOCATION,
};
use reqwest::{redirect, Client, Method, StatusCode};
use serde::de::IgnoredAny;
use serde::{Deserialize, Deserializer, Serialize};
use serde_json::value::RawValue;
use url::Url;

use crate::error::{ApiErrors, Error, Result};

pub const API_BASE: &str = "https://api.github.com";
const API_HOST: &str = "api.github.com";
const API_VERSION: &str = "2022-11-28";
const DEFAULT_ACCEPT: &str = "application/vnd.github+json";

pub fn build_client() -> Result<Client> {
    client_with(redirect::Policy::default())
}

/// For resolving download links: the redirect itself is the answer.
pub fn build_no_redirect_client() -> Result<Client> {
    client_with(redirect::Policy::none())
}

fn client_with(policy: redirect::Policy) -> Result<Client> {
    let mut headers = HeaderMap::new();
    headers.insert(
        "X-GitHub-Api-Version",
        HeaderValue::from_static(API_VERSION),
    );
    Ok(Client::builder()
        .user_agent(concat!("better-github/", env!("CARGO_PKG_VERSION")))
        .default_headers(headers)
        .redirect(policy)
        .connect_timeout(Duration::from_secs(15))
        .timeout(Duration::from_secs(45))
        .build()?)
}

/// A query parameter value, as the frontend sends it
/// (`string | number | boolean | null`; `undefined` never arrives).
#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(untagged)]
pub enum QueryValue {
    /// Skipped, like `undefined`.
    Null,
    Bool(bool),
    Int(i64),
    UInt(u64),
    Float(f64),
    Text(String),
}

impl QueryValue {
    /// The value as it goes into the URL; `None` leaves the parameter out.
    fn as_param(&self) -> Option<String> {
        match self {
            QueryValue::Null => None,
            QueryValue::Bool(b) => Some(b.to_string()),
            QueryValue::Int(n) => Some(n.to_string()),
            QueryValue::UInt(n) => Some(n.to_string()),
            QueryValue::Float(n) => Some(n.to_string()),
            QueryValue::Text(s) => Some(s.clone()),
        }
    }
}

pub type Query = BTreeMap<String, QueryValue>;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RestRequest {
    #[serde(default)]
    pub method: Option<String>,
    /// Either a path such as `/repos/o/r/pulls` or a full
    /// `https://api.github.com/...` URL (e.g. from a `Link` header).
    pub path: String,
    #[serde(default)]
    pub query: Option<Query>,
    /// Sent to GitHub as is; never interpreted here.
    #[serde(default)]
    pub body: Option<Box<RawValue>>,
    /// Overrides the `Accept` header, e.g. `application/vnd.github.raw+json`.
    #[serde(default)]
    pub accept: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RestResponse {
    pub status: u16,
    pub body: ResponseBody,
    /// The raw `Link` header, used for pagination.
    pub link: Option<String>,
}

/// A response body, handed to the frontend without being interpreted:
/// JSON as is, other text (raw files, diffs) as a JSON string, and an empty
/// body as `null`.
#[derive(Debug, Serialize)]
#[serde(untagged)]
pub enum ResponseBody {
    Empty,
    Json(Box<RawValue>),
    Text(String),
}

impl ResponseBody {
    fn new(text: String, is_json: bool) -> Self {
        if text.is_empty() {
            return ResponseBody::Empty;
        }
        if is_json {
            if let Ok(json) = serde_json::from_str::<Box<RawValue>>(&text) {
                return ResponseBody::Json(json);
            }
        }
        ResponseBody::Text(text)
    }
}

/// Resolves a request path to an absolute api.github.com URL, rejecting
/// anything that would leave that host.
pub fn resolve_url(path: &str, query: Option<&Query>) -> Result<Url> {
    let mut url = if path.starts_with("https://") {
        Url::parse(path).map_err(|e| Error::Invalid(format!("Invalid URL: {e}")))?
    } else if path.starts_with('/') && !path.starts_with("//") {
        Url::parse(&format!("{API_BASE}{path}"))
            .map_err(|e| Error::Invalid(format!("Invalid path: {e}")))?
    } else {
        return Err(Error::Invalid(format!("Invalid API path: {path}")));
    };

    if url.scheme() != "https"
        || url.host_str() != Some(API_HOST)
        || url.port().is_some()
        || !url.username().is_empty()
        || url.password().is_some()
    {
        return Err(Error::Invalid(
            "Requests may only target https://api.github.com".into(),
        ));
    }

    if let Some(query) = query {
        let mut pairs = url.query_pairs_mut();
        for (key, value) in query {
            if let Some(value) = value.as_param() {
                pairs.append_pair(key, &value);
            }
        }
    }
    // `query_pairs_mut` leaves a dangling `?` when nothing was appended.
    if url.query() == Some("") {
        url.set_query(None);
    }
    Ok(url)
}

fn parse_method(method: Option<&str>) -> Result<Method> {
    match method.map(str::to_ascii_uppercase).as_deref() {
        None | Some("GET") => Ok(Method::GET),
        Some("POST") => Ok(Method::POST),
        Some("PUT") => Ok(Method::PUT),
        Some("PATCH") => Ok(Method::PATCH),
        Some("DELETE") => Ok(Method::DELETE),
        Some(other) => Err(Error::Invalid(format!("Unsupported method {other}"))),
    }
}

/// One entry of `errors` in a REST error body: a plain message, or a
/// validation failure such as `{ resource, field, code }`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(untagged)]
pub enum RestErrorItem {
    Text(String),
    Detail(RestErrorDetail),
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct RestErrorDetail {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub resource: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub field: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub code: Option<String>,
}

impl RestErrorItem {
    fn detail(&self) -> Option<String> {
        match self {
            RestErrorItem::Text(text) => Some(text.clone()),
            RestErrorItem::Detail(detail) => detail.message.clone().or_else(|| {
                let field = detail.field.as_deref()?;
                let code = detail.code.as_deref()?;
                Some(format!("{field} {code}"))
            }),
        }
    }
}

/// GitHub's REST error body. Anything that does not parse counts as empty.
#[derive(Debug, Default, Deserialize)]
struct RestErrorBody {
    #[serde(default)]
    message: Option<String>,
    #[serde(default, deserialize_with = "known_error_items")]
    errors: Option<Vec<RestErrorItem>>,
}

/// `errors`, keeping the entries we understand and dropping the rest, so an
/// odd entry never costs us the main message.
fn known_error_items<'de, D: Deserializer<'de>>(
    deserializer: D,
) -> std::result::Result<Option<Vec<RestErrorItem>>, D::Error> {
    #[derive(Deserialize)]
    #[serde(untagged)]
    enum Item {
        Known(RestErrorItem),
        Unknown(IgnoredAny),
    }
    #[derive(Deserialize)]
    #[serde(untagged)]
    enum Items {
        List(Vec<Item>),
        Other(IgnoredAny),
    }
    Ok(match Option::<Items>::deserialize(deserializer)? {
        Some(Items::List(items)) => Some(
            items
                .into_iter()
                .filter_map(|item| match item {
                    Item::Known(item) => Some(item),
                    Item::Unknown(_) => None,
                })
                .collect(),
        ),
        Some(Items::Other(_)) | None => None,
    })
}

/// The message shown for a failed REST call: GitHub's own, plus the
/// validation details, which is where the useful part usually is.
fn rest_error_message(status: StatusCode, body: &RestErrorBody) -> String {
    let message = body.message.clone().unwrap_or_else(|| {
        status
            .canonical_reason()
            .unwrap_or("Request failed")
            .to_owned()
    });
    let details: Vec<String> = body
        .errors
        .iter()
        .flatten()
        .filter_map(RestErrorItem::detail)
        .collect();
    if details.is_empty() {
        message
    } else {
        format!("{message}: {}", details.join("; "))
    }
}

/// Converts a non-success response into an `Error::Api` with GitHub's message.
async fn api_error(status: StatusCode, response: reqwest::Response) -> Error {
    let text = response.text().await.unwrap_or_default();
    let body: RestErrorBody = serde_json::from_str(&text).unwrap_or_default();
    Error::Api {
        status: status.as_u16(),
        message: rest_error_message(status, &body),
        errors: body.errors.map(ApiErrors::Rest),
    }
}

/// Guests (no token) may only read.
fn check_anonymous(method: &Method, token: Option<&str>) -> Result<()> {
    if token.is_none() && method != Method::GET {
        return Err(Error::NotAuthenticated);
    }
    Ok(())
}

/// Adds the token, when there is one.
fn authorize(builder: reqwest::RequestBuilder, token: Option<&str>) -> reqwest::RequestBuilder {
    match token {
        Some(token) => builder.header(AUTHORIZATION, format!("Bearer {token}")),
        None => builder,
    }
}

/// A REST call; `token` is `None` in guest mode, which allows only reads.
pub async fn rest(
    client: &Client,
    token: Option<&str>,
    request: RestRequest,
) -> Result<RestResponse> {
    let method = parse_method(request.method.as_deref())?;
    check_anonymous(&method, token)?;
    let url = resolve_url(&request.path, request.query.as_ref())?;
    let accept = request.accept.as_deref().unwrap_or(DEFAULT_ACCEPT);

    let mut builder = authorize(client.request(method, url), token).header(ACCEPT, accept);
    if let Some(body) = &request.body {
        builder = builder.json(body.as_ref());
    }

    let response = builder.send().await?;
    let status = response.status();
    if !status.is_success() {
        return Err(api_error(status, response).await);
    }

    let link = response
        .headers()
        .get(LINK)
        .and_then(|v| v.to_str().ok())
        .map(str::to_owned);
    let is_json = response
        .headers()
        .get(CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .map(|ct| ct.contains("json"))
        .unwrap_or(false);

    let body = ResponseBody::new(response.text().await?, is_json);
    Ok(RestResponse {
        status: status.as_u16(),
        body,
        link,
    })
}

/// GraphQL variables: names to JSON values, passed through untouched.
pub type GraphQlVariables = BTreeMap<String, Box<RawValue>>;

#[derive(Serialize)]
struct GraphQlRequest<'a> {
    query: &'a str,
    variables: &'a GraphQlVariables,
}

/// A step in a GraphQL error's `path`: a field name or a list index.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(untagged)]
pub enum PathSegment {
    Field(String),
    Index(u64),
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct GraphQlError {
    pub message: String,
    #[serde(rename = "type", default, skip_serializing_if = "Option::is_none")]
    pub kind: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub path: Option<Vec<PathSegment>>,
}

#[derive(Debug, Deserialize)]
struct GraphQlReply {
    #[serde(default)]
    data: Option<Box<RawValue>>,
    #[serde(default)]
    errors: Option<Vec<GraphQlError>>,
}

/// What the frontend gets: `{ data, errors? }`, `data` untouched.
#[derive(Debug, Serialize)]
pub struct GraphQlEnvelope {
    pub data: Box<RawValue>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub errors: Option<Vec<GraphQlError>>,
}

impl GraphQlReply {
    /// Data, with any errors as partial failures; without data, the first
    /// error is the failure.
    fn into_envelope(self, status: StatusCode) -> Result<GraphQlEnvelope> {
        match self.data {
            Some(data) => Ok(GraphQlEnvelope {
                data,
                errors: self.errors,
            }),
            None => Err(Error::Api {
                status: status.as_u16(),
                message: self
                    .errors
                    .as_deref()
                    .and_then(<[GraphQlError]>::first)
                    .map_or_else(
                        || "GraphQL request failed".to_owned(),
                        |e| e.message.clone(),
                    ),
                errors: self.errors.map(ApiErrors::GraphQl),
            }),
        }
    }
}

/// Runs a GraphQL query. Returns the whole `{ data, errors }` envelope:
/// GitHub often returns partial data alongside errors (e.g. SAML-protected
/// organizations), and the UI can still show what it got.
pub async fn graphql(
    client: &Client,
    token: &str,
    query: &str,
    variables: Option<GraphQlVariables>,
) -> Result<GraphQlEnvelope> {
    let variables = variables.unwrap_or_default();
    let response = client
        .post(format!("{API_BASE}/graphql"))
        .header(AUTHORIZATION, format!("Bearer {token}"))
        .header(ACCEPT, "application/json")
        .json(&GraphQlRequest {
            query,
            variables: &variables,
        })
        .send()
        .await?;
    let status = response.status();
    if !status.is_success() {
        return Err(api_error(status, response).await);
    }
    let reply: GraphQlReply = response.json().await?;
    reply.into_envelope(status)
}

/// Hosts GitHub redirects job log downloads to (short-lived signed URLs).
const LOG_HOST_SUFFIXES: &[&str] = &[".actions.githubusercontent.com", ".blob.core.windows.net"];
/// Longer logs keep their end, which is where failures are.
const MAX_LOG_BYTES: usize = 8 * 1024 * 1024;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct JobLog {
    pub text: String,
    /// The start was cut off to stay under `MAX_LOG_BYTES`.
    pub truncated: bool,
}

/// An owner or repository name, safe to use as a single path segment.
fn name_segment(value: &str) -> Result<&str> {
    let valid = !value.is_empty()
        && value != "."
        && value != ".."
        && value
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.'));
    if valid {
        Ok(value)
    } else {
        Err(Error::Invalid(format!("Invalid name: {value}")))
    }
}

fn is_log_location(url: &Url) -> bool {
    url.scheme() == "https"
        && url.port().is_none()
        && url.host_str().is_some_and(|host| {
            host == API_HOST
                || LOG_HOST_SUFFIXES
                    .iter()
                    .any(|suffix| host.ends_with(suffix))
        })
}

/// Keeps the last `max` bytes, starting at a full line when it has to cut.
fn tail_text(mut bytes: Vec<u8>, max: usize, mut truncated: bool) -> JobLog {
    if bytes.len() > max {
        bytes.drain(..bytes.len() - max);
        truncated = true;
    }
    let text = String::from_utf8_lossy(&bytes);
    let text = if truncated {
        text.split_once('\n').map_or("", |(_, rest)| rest)
    } else {
        &text
    };
    JobLog {
        text: text.to_owned(),
        truncated,
    }
}

/// Downloads a workflow job's log. GitHub answers with a redirect to log
/// storage; reqwest follows it and drops the token for the other host. Logs
/// exist only once the job has finished (GitHub returns 404 before that).
pub async fn job_logs(
    client: &Client,
    token: &str,
    owner: &str,
    repo: &str,
    job_id: u64,
) -> Result<JobLog> {
    let path = format!(
        "/repos/{}/{}/actions/jobs/{job_id}/logs",
        name_segment(owner)?,
        name_segment(repo)?
    );
    let mut response = client
        .get(resolve_url(&path, None)?)
        .header(AUTHORIZATION, format!("Bearer {token}"))
        .header(ACCEPT, DEFAULT_ACCEPT)
        .send()
        .await?;
    let status = response.status();
    if !status.is_success() {
        return Err(api_error(status, response).await);
    }
    if !is_log_location(response.url()) {
        return Err(Error::Invalid(
            "GitHub sent the log to an unexpected host".into(),
        ));
    }
    let mut bytes = Vec::new();
    let mut truncated = false;
    while let Some(chunk) = response.chunk().await? {
        bytes.extend_from_slice(&chunk);
        // Trim as we go so a huge log never sits in memory whole.
        if bytes.len() > 2 * MAX_LOG_BYTES {
            bytes.drain(..bytes.len() - MAX_LOG_BYTES);
            truncated = true;
        }
    }
    Ok(tail_text(bytes, MAX_LOG_BYTES, truncated))
}

// ------------------------------------------------------------- downloads

/// Hosts GitHub sends release asset and source archive downloads to.
const DOWNLOAD_HOST_SUFFIXES: &[&str] = &[".githubusercontent.com"];
const DOWNLOAD_HOSTS: &[&str] = &["codeload.github.com"];

#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ArchiveFormat {
    Zip,
    Tar,
}

fn is_download_location(url: &Url) -> bool {
    url.scheme() == "https"
        && url.port().is_none()
        && url.username().is_empty()
        && url.host_str().is_some_and(|host| {
            DOWNLOAD_HOSTS.contains(&host)
                || DOWNLOAD_HOST_SUFFIXES
                    .iter()
                    .any(|suffix| host.ends_with(suffix))
        })
}

/// A git ref as path segments: tags and branches may contain "/".
fn ref_segments(git_ref: &str) -> Result<Vec<&str>> {
    let segments: Vec<&str> = git_ref.split('/').collect();
    let valid = !git_ref.is_empty()
        && git_ref.len() <= 255
        && segments
            .iter()
            .all(|s| !s.is_empty() && *s != "." && *s != "..")
        && !git_ref.chars().any(|c| c.is_control() || c.is_whitespace());
    if valid {
        Ok(segments)
    } else {
        Err(Error::Invalid(format!("Invalid ref: {git_ref}")))
    }
}

/// Asks the API for a download and returns where it redirects: a
/// short-lived signed URL that needs no token, so the device's download
/// manager can fetch it. The client must not follow redirects.
async fn signed_location(
    client: &Client,
    token: Option<&str>,
    url: Url,
    accept: &str,
) -> Result<String> {
    let response = authorize(client.get(url), token)
        .header(ACCEPT, accept)
        .send()
        .await?;
    let status = response.status();
    if status.is_redirection() {
        let location = response
            .headers()
            .get(LOCATION)
            .and_then(|v| v.to_str().ok())
            .and_then(|v| Url::parse(v).ok())
            .ok_or_else(|| Error::Invalid("GitHub sent no download link".into()))?;
        return if is_download_location(&location) {
            Ok(location.to_string())
        } else {
            Err(Error::Invalid(
                "GitHub sent the download to an unexpected host".into(),
            ))
        };
    }
    if !status.is_success() {
        return Err(api_error(status, response).await);
    }
    Err(Error::Invalid("GitHub sent no download link".into()))
}

/// A release asset's download link. Without a token, public repositories only.
pub async fn asset_url(
    client: &Client,
    token: Option<&str>,
    owner: &str,
    repo: &str,
    asset_id: u64,
) -> Result<String> {
    let path = format!(
        "/repos/{}/{}/releases/assets/{asset_id}",
        name_segment(owner)?,
        name_segment(repo)?
    );
    signed_location(
        client,
        token,
        resolve_url(&path, None)?,
        "application/octet-stream",
    )
    .await
}

/// A zip or tar.gz of the source at a ref (a release's "Source code").
pub async fn archive_url(
    client: &Client,
    token: Option<&str>,
    owner: &str,
    repo: &str,
    git_ref: &str,
    format: ArchiveFormat,
) -> Result<String> {
    let kind = match format {
        ArchiveFormat::Zip => "zipball",
        ArchiveFormat::Tar => "tarball",
    };
    let mut url = resolve_url(
        &format!(
            "/repos/{}/{}/{kind}",
            name_segment(owner)?,
            name_segment(repo)?
        ),
        None,
    )?;
    url.path_segments_mut()
        .map_err(|_| Error::Invalid("Invalid URL".into()))?
        .extend(ref_segments(git_ref)?);
    signed_location(client, token, url, DEFAULT_ACCEPT).await
}

#[derive(Debug, Deserialize)]
pub struct User {
    pub login: String,
    pub name: Option<String>,
    pub avatar_url: String,
}

/// Fetches the authenticated user and the token's OAuth scopes.
pub async fn current_user(client: &Client, token: &str) -> Result<(User, Option<String>)> {
    let response = client
        .get(format!("{API_BASE}/user"))
        .header(AUTHORIZATION, format!("Bearer {token}"))
        .header(ACCEPT, DEFAULT_ACCEPT)
        .send()
        .await?;
    let status = response.status();
    if !status.is_success() {
        return Err(api_error(status, response).await);
    }
    let scopes = response
        .headers()
        .get("x-oauth-scopes")
        .and_then(|v| v.to_str().ok())
        .map(str::to_owned);
    Ok((response.json().await?, scopes))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resolves_relative_paths() {
        let url = resolve_url("/repos/o/r/pulls", None).unwrap();
        assert_eq!(url.as_str(), "https://api.github.com/repos/o/r/pulls");
    }

    #[test]
    fn appends_query_and_skips_nulls() {
        let mut query = Query::new();
        query.insert("per_page".into(), QueryValue::Int(50));
        query.insert("state".into(), QueryValue::Text("open".into()));
        query.insert("ignored".into(), QueryValue::Null);
        let url = resolve_url("/repos/o/r/pulls", Some(&query)).unwrap();
        assert_eq!(
            url.as_str(),
            "https://api.github.com/repos/o/r/pulls?per_page=50&state=open"
        );
    }

    #[test]
    fn parses_query_values_from_the_frontend() {
        let query: Query = serde_json::from_str(
            r#"{"page":2,"all":false,"q":"is:open a&b","since":null,"big":18446744073709551615,"neg":-1,"ratio":1.5}"#,
        )
        .unwrap();
        assert_eq!(query["page"], QueryValue::Int(2));
        assert_eq!(query["big"], QueryValue::UInt(u64::MAX));
        assert_eq!(query["since"], QueryValue::Null);
        let url = resolve_url("/search/issues", Some(&query)).unwrap();
        assert_eq!(
            url.query(),
            Some("all=false&big=18446744073709551615&neg=-1&page=2&q=is%3Aopen+a%26b&ratio=1.5")
        );
        // Nested values are not query parameters.
        assert!(serde_json::from_str::<Query>(r#"{"a":[1]}"#).is_err());
        assert!(serde_json::from_str::<Query>(r#"{"a":{"b":1}}"#).is_err());
    }

    #[test]
    fn response_bodies_keep_their_shape() {
        let json = |text: &str, is_json| {
            serde_json::to_string(&ResponseBody::new(text.into(), is_json)).unwrap()
        };
        assert_eq!(json("", true), "null");
        assert_eq!(json("", false), "null");
        assert_eq!(json(r#"{"a":[1,2.50,"x"]}"#, true), r#"{"a":[1,2.50,"x"]}"#);
        // Not JSON after all, or not meant to be read as JSON: a string.
        assert_eq!(json("not json", true), r#""not json""#);
        assert_eq!(json("{\"a\":1}", false), r#""{\"a\":1}""#);
        assert_eq!(json("diff --git a b\n", false), r#""diff --git a b\n""#);

        let response = RestResponse {
            status: 200,
            body: ResponseBody::new("[1]".into(), true),
            link: None,
        };
        assert_eq!(
            serde_json::to_string(&response).unwrap(),
            r#"{"status":200,"body":[1],"link":null}"#
        );
    }

    #[test]
    fn rest_request_bodies_pass_through_untouched() {
        let request: RestRequest = serde_json::from_str(
            r#"{"method":"POST","path":"/x","body":{"body":"hi","n":1.0,"list":[true,null]}}"#,
        )
        .unwrap();
        assert_eq!(
            request.body.unwrap().get(),
            r#"{"body":"hi","n":1.0,"list":[true,null]}"#
        );
    }

    fn rest_message(status: u16, body: &str) -> String {
        let body: RestErrorBody = serde_json::from_str(body).unwrap_or_default();
        rest_error_message(StatusCode::from_u16(status).unwrap(), &body)
    }

    #[test]
    fn rest_error_messages() {
        assert_eq!(rest_message(404, r#"{"message":"Not Found"}"#), "Not Found");
        assert_eq!(rest_message(502, "<html>bad gateway</html>"), "Bad Gateway");
        assert_eq!(rest_message(500, ""), "Internal Server Error");
        assert_eq!(
            rest_message(
                422,
                r#"{"message":"Validation Failed","errors":[
                    {"resource":"PullRequest","field":"head","code":"invalid"},
                    {"resource":"Issue","code":"custom","message":"A pull request already exists"},
                    "plain text",
                    {"resource":"Label","code":"missing"},
                    42
                ],"documentation_url":"https://docs.github.com"}"#
            ),
            "Validation Failed: head invalid; A pull request already exists; plain text"
        );
        // `errors` that is not a list keeps the main message.
        assert_eq!(
            rest_message(422, r#"{"message":"Nope","errors":{"odd":true}}"#),
            "Nope"
        );
        assert_eq!(
            rest_message(422, r#"{"message":"Nope","errors":[]}"#),
            "Nope"
        );
    }

    #[test]
    fn rest_errors_reach_the_frontend_typed() {
        let body: RestErrorBody = serde_json::from_str(
            r#"{"message":"Validation Failed","errors":[{"field":"head","code":"invalid","value":3},"x",7]}"#,
        )
        .unwrap();
        let errors = body.errors.map(ApiErrors::Rest);
        assert_eq!(
            serde_json::to_string(&errors).unwrap(),
            r#"[{"field":"head","code":"invalid"},"x"]"#
        );
    }

    #[test]
    fn graphql_partial_data_keeps_errors() {
        let reply: GraphQlReply = serde_json::from_str(
            r#"{"data":{"viewer":{"login":"octocat"}},"errors":[{"type":"FORBIDDEN","path":["organization",0,"repos"],"message":"SAML","locations":[{"line":1,"column":2}]}]}"#,
        )
        .unwrap();
        let envelope = reply.into_envelope(StatusCode::OK).unwrap();
        assert_eq!(
            serde_json::to_string(&envelope).unwrap(),
            r#"{"data":{"viewer":{"login":"octocat"}},"errors":[{"message":"SAML","type":"FORBIDDEN","path":["organization",0,"repos"]}]}"#
        );

        let clean: GraphQlReply = serde_json::from_str(r#"{"data":{"a":1}}"#).unwrap();
        assert_eq!(
            serde_json::to_string(&clean.into_envelope(StatusCode::OK).unwrap()).unwrap(),
            r#"{"data":{"a":1}}"#
        );
    }

    #[test]
    fn graphql_without_data_fails_with_the_first_error() {
        let reply: GraphQlReply = serde_json::from_str(
            r#"{"data":null,"errors":[{"message":"Could not resolve"},{"message":"second"}]}"#,
        )
        .unwrap();
        match reply.into_envelope(StatusCode::OK) {
            Err(Error::Api {
                status,
                message,
                errors: Some(ApiErrors::GraphQl(errors)),
            }) => {
                assert_eq!(status, 200);
                assert_eq!(message, "Could not resolve");
                assert_eq!(errors.len(), 2);
            }
            other => panic!("unexpected {other:?}"),
        }

        let empty: GraphQlReply = serde_json::from_str("{}").unwrap();
        assert!(matches!(
            empty.into_envelope(StatusCode::OK),
            Err(Error::Api { message, errors: None, .. }) if message == "GraphQL request failed"
        ));
    }

    #[test]
    fn graphql_variables_pass_through_untouched() {
        let variables: GraphQlVariables =
            serde_json::from_str(r#"{"owner":"o","first":50,"after":null,"labels":["a"]}"#)
                .unwrap();
        let request = GraphQlRequest {
            query: "query { viewer { login } }",
            variables: &variables,
        };
        assert_eq!(
            serde_json::to_string(&request).unwrap(),
            r#"{"query":"query { viewer { login } }","variables":{"after":null,"first":50,"labels":["a"],"owner":"o"}}"#
        );
        let none = GraphQlRequest {
            query: "q",
            variables: &GraphQlVariables::new(),
        };
        assert_eq!(
            serde_json::to_string(&none).unwrap(),
            r#"{"query":"q","variables":{}}"#
        );
        // Variables are always an object.
        assert!(serde_json::from_str::<GraphQlVariables>("[1]").is_err());
    }

    #[test]
    fn empty_query_leaves_no_question_mark() {
        let url = resolve_url("/user", Some(&Query::new())).unwrap();
        assert_eq!(url.as_str(), "https://api.github.com/user");
    }

    #[test]
    fn accepts_pagination_urls() {
        let url = resolve_url("https://api.github.com/user/repos?page=2", None).unwrap();
        assert_eq!(url.query(), Some("page=2"));
    }

    #[test]
    fn rejects_other_hosts() {
        for bad in [
            "https://evil.example.com/user",
            "https://api.github.com.evil.example.com/user",
            "https://api.github.com:8443/user",
            "https://user:pass@api.github.com/user",
            "http://api.github.com/user",
            "//evil.example.com/user",
            "user",
            "ftp://api.github.com/user",
        ] {
            assert!(resolve_url(bad, None).is_err(), "{bad} should be rejected");
        }
    }

    #[test]
    fn rejects_userinfo_tricks_in_paths() {
        // "@" inside a path is just a path character, host must stay api.github.com.
        let url = resolve_url("/@evil.example.com/user", None).unwrap();
        assert_eq!(url.host_str(), Some("api.github.com"));
    }

    #[test]
    fn name_segments_stay_single_segments() {
        for good in ["octo-org", "my_repo.js", "a", ".github"] {
            assert_eq!(name_segment(good).unwrap(), good);
        }
        for bad in ["", ".", "..", "a/b", "a?b", "a#b", "a%2Fb", "a b", "../x"] {
            assert!(name_segment(bad).is_err(), "{bad:?} should be rejected");
        }
    }

    #[test]
    fn logs_only_come_from_github_storage() {
        for good in [
            "https://api.github.com/repos/o/r/actions/jobs/1/logs",
            "https://productionresultssa0.blob.core.windows.net/actions-results/x?sig=1",
            "https://pipelines.actions.githubusercontent.com/serviceHosts/x/logs/1",
        ] {
            assert!(is_log_location(&Url::parse(good).unwrap()), "{good}");
        }
        for bad in [
            "https://evil.example.com/log",
            "https://blob.core.windows.net.evil.example.com/log",
            "http://productionresultssa0.blob.core.windows.net/log",
            "https://productionresultssa0.blob.core.windows.net:8443/log",
            "https://actions.githubusercontent.com.evil.example.com/log",
        ] {
            assert!(!is_log_location(&Url::parse(bad).unwrap()), "{bad}");
        }
    }

    #[test]
    fn downloads_only_come_from_github_storage() {
        for good in [
            "https://objects.githubusercontent.com/github-production-release-asset/1?X-Amz-Signature=x",
            "https://release-assets.githubusercontent.com/github-production-release-asset/1/2?sp=r",
            "https://codeload.github.com/acme/rocket/legacy.zip/refs/tags/v1.0?token=x",
        ] {
            assert!(is_download_location(&Url::parse(good).unwrap()), "{good}");
        }
        for bad in [
            "http://objects.githubusercontent.com/x",
            "https://githubusercontent.com.evil.example.com/x",
            "https://evil.example.com/codeload.github.com",
            "https://codeload.github.com:8443/x",
            "https://user@objects.githubusercontent.com/x",
            "https://api.github.com/repos/o/r/zipball/main",
        ] {
            assert!(!is_download_location(&Url::parse(bad).unwrap()), "{bad}");
        }
    }

    #[test]
    fn refs_become_path_segments() {
        assert_eq!(ref_segments("v1.0").unwrap(), vec!["v1.0"]);
        assert_eq!(ref_segments("app/v1.0").unwrap(), vec!["app", "v1.0"]);
        for bad in ["", "..", "a/../b", "a//b", "/a", "a b", "a\nb"] {
            assert!(ref_segments(bad).is_err(), "{bad:?} should be rejected");
        }
    }

    #[test]
    fn long_logs_keep_their_end_from_a_full_line() {
        let log = tail_text(b"first\nsecond\nthird\n".to_vec(), 9, false);
        assert!(log.truncated);
        assert_eq!(log.text, "third\n");

        let whole = tail_text(b"first\nsecond\n".to_vec(), 100, false);
        assert!(!whole.truncated);
        assert_eq!(whole.text, "first\nsecond\n");
    }

    #[test]
    fn guests_can_only_read() {
        assert!(check_anonymous(&Method::GET, None).is_ok());
        for method in [Method::POST, Method::PUT, Method::PATCH, Method::DELETE] {
            assert!(matches!(
                check_anonymous(&method, None),
                Err(Error::NotAuthenticated)
            ));
            assert!(check_anonymous(&method, Some("gho_x")).is_ok());
        }
    }

    #[test]
    fn parses_methods() {
        assert_eq!(parse_method(None).unwrap(), Method::GET);
        assert_eq!(parse_method(Some("patch")).unwrap(), Method::PATCH);
        assert!(parse_method(Some("TRACE")).is_err());
    }
}
