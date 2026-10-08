//! Thin authenticated proxy to the GitHub REST and GraphQL APIs.
//!
//! The token never leaves the Rust side. Requests can only target
//! `https://api.github.com`, so a compromised page cannot exfiltrate the
//! token by pointing a request at another host.

use std::time::Duration;

use reqwest::header::{HeaderMap, HeaderValue, ACCEPT, AUTHORIZATION, CONTENT_TYPE, LINK};
use reqwest::{Client, Method, StatusCode};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use url::Url;

use crate::error::{Error, Result};

pub const API_BASE: &str = "https://api.github.com";
const API_HOST: &str = "api.github.com";
const API_VERSION: &str = "2022-11-28";
const DEFAULT_ACCEPT: &str = "application/vnd.github+json";

pub fn build_client() -> Client {
    let mut headers = HeaderMap::new();
    headers.insert(
        "X-GitHub-Api-Version",
        HeaderValue::from_static(API_VERSION),
    );
    Client::builder()
        .user_agent(concat!("gh-commander/", env!("CARGO_PKG_VERSION")))
        .default_headers(headers)
        .connect_timeout(Duration::from_secs(15))
        .timeout(Duration::from_secs(45))
        .build()
        .expect("failed to build HTTP client")
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RestRequest {
    #[serde(default)]
    pub method: Option<String>,
    /// Either a path such as `/repos/o/r/pulls` or a full
    /// `https://api.github.com/...` URL (e.g. from a `Link` header).
    pub path: String,
    #[serde(default)]
    pub query: Option<Map<String, Value>>,
    #[serde(default)]
    pub body: Option<Value>,
    /// Overrides the `Accept` header, e.g. `application/vnd.github.raw+json`.
    #[serde(default)]
    pub accept: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RestResponse {
    pub status: u16,
    /// Parsed JSON, or a string for non-JSON bodies (raw files, diffs).
    pub body: Value,
    /// The raw `Link` header, used for pagination.
    pub link: Option<String>,
}

/// Resolves a request path to an absolute api.github.com URL, rejecting
/// anything that would leave that host.
pub fn resolve_url(path: &str, query: Option<&Map<String, Value>>) -> Result<Url> {
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
            match value {
                Value::Null => {}
                Value::String(s) => {
                    pairs.append_pair(key, s);
                }
                other => {
                    pairs.append_pair(key, &other.to_string());
                }
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

/// Converts a non-success response into an `Error::Api` with GitHub's message.
async fn api_error(status: StatusCode, response: reqwest::Response) -> Error {
    let text = response.text().await.unwrap_or_default();
    let parsed: Value = serde_json::from_str(&text).unwrap_or(Value::Null);
    let mut message = parsed
        .get("message")
        .and_then(Value::as_str)
        .map(str::to_owned)
        .unwrap_or_else(|| {
            status
                .canonical_reason()
                .unwrap_or("Request failed")
                .to_owned()
        });
    let errors = parsed.get("errors").cloned().filter(|e| !e.is_null());
    // Validation failures carry the useful detail in `errors`.
    if let Some(Value::Array(items)) = &errors {
        let details: Vec<String> = items
            .iter()
            .filter_map(|item| match item {
                Value::String(s) => Some(s.clone()),
                Value::Object(o) => o
                    .get("message")
                    .and_then(Value::as_str)
                    .map(str::to_owned)
                    .or_else(|| {
                        let field = o.get("field").and_then(Value::as_str)?;
                        let code = o.get("code").and_then(Value::as_str)?;
                        Some(format!("{field} {code}"))
                    }),
                _ => None,
            })
            .collect();
        if !details.is_empty() {
            message = format!("{message}: {}", details.join("; "));
        }
    }
    Error::Api {
        status: status.as_u16(),
        message,
        errors,
    }
}

pub async fn rest(client: &Client, token: &str, request: RestRequest) -> Result<RestResponse> {
    let method = parse_method(request.method.as_deref())?;
    let url = resolve_url(&request.path, request.query.as_ref())?;
    let accept = request.accept.as_deref().unwrap_or(DEFAULT_ACCEPT);

    let mut builder = client
        .request(method, url)
        .header(AUTHORIZATION, format!("Bearer {token}"))
        .header(ACCEPT, accept);
    if let Some(body) = &request.body {
        builder = builder.json(body);
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

    let text = response.text().await?;
    let body = if text.is_empty() {
        Value::Null
    } else if is_json {
        serde_json::from_str(&text).unwrap_or(Value::String(text))
    } else {
        Value::String(text)
    };

    Ok(RestResponse {
        status: status.as_u16(),
        body,
        link,
    })
}

/// Runs a GraphQL query. Returns the whole `{ data, errors }` envelope:
/// GitHub often returns partial data alongside errors (e.g. SAML-protected
/// organizations), and the UI can still show what it got.
pub async fn graphql(
    client: &Client,
    token: &str,
    query: &str,
    variables: Option<Value>,
) -> Result<Value> {
    let body = serde_json::json!({
        "query": query,
        "variables": variables.unwrap_or_else(|| Value::Object(Map::new())),
    });
    let response = client
        .post(format!("{API_BASE}/graphql"))
        .header(AUTHORIZATION, format!("Bearer {token}"))
        .header(ACCEPT, "application/json")
        .json(&body)
        .send()
        .await?;
    let status = response.status();
    if !status.is_success() {
        return Err(api_error(status, response).await);
    }
    let envelope: Value = response.json().await?;
    let has_data = envelope.get("data").map(|d| !d.is_null()).unwrap_or(false);
    if !has_data {
        let message = envelope
            .get("errors")
            .and_then(|e| e.get(0))
            .and_then(|e| e.get("message"))
            .and_then(Value::as_str)
            .unwrap_or("GraphQL request failed")
            .to_owned();
        return Err(Error::Api {
            status: status.as_u16(),
            message,
            errors: envelope.get("errors").cloned(),
        });
    }
    Ok(envelope)
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
        let mut query = Map::new();
        query.insert("per_page".into(), Value::from(50));
        query.insert("state".into(), Value::from("open"));
        query.insert("ignored".into(), Value::Null);
        let url = resolve_url("/repos/o/r/pulls", Some(&query)).unwrap();
        assert_eq!(
            url.as_str(),
            "https://api.github.com/repos/o/r/pulls?per_page=50&state=open"
        );
    }

    #[test]
    fn empty_query_leaves_no_question_mark() {
        let url = resolve_url("/user", Some(&Map::new())).unwrap();
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
    fn parses_methods() {
        assert_eq!(parse_method(None).unwrap(), Method::GET);
        assert_eq!(parse_method(Some("patch")).unwrap(), Method::PATCH);
        assert!(parse_method(Some("TRACE")).is_err());
    }
}
