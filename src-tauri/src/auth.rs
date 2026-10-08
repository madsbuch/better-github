//! GitHub OAuth device flow.
//!
//! The device flow needs only a client id (no client secret and no redirect
//! URI), which makes it the right fit for an app installed on a phone: the
//! user confirms a short code on github.com and the app polls for the token.
//! https://docs.github.com/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps#device-flow

use reqwest::header::ACCEPT;
use reqwest::Client;
use serde::{Deserialize, Serialize};

use crate::error::{Error, Result};

const DEVICE_CODE_URL: &str = "https://github.com/login/device/code";
const ACCESS_TOKEN_URL: &str = "https://github.com/login/oauth/access_token";
const DEVICE_GRANT: &str = "urn:ietf:params:oauth:grant-type:device_code";

/// `repo` covers private repositories, statuses and reviews, `read:org` lets
/// us see team review requests, `notifications` the inbox.
pub const SCOPES: &str = "repo read:org notifications read:user";

/// Client id baked in at build time: `GH_COMMANDER_CLIENT_ID=... tauri build`.
pub fn build_time_client_id() -> Option<&'static str> {
    option_env!("GH_COMMANDER_CLIENT_ID")
        .map(str::trim)
        .filter(|s| !s.is_empty())
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeviceCode {
    #[serde(alias = "device_code")]
    pub device_code: String,
    #[serde(alias = "user_code")]
    pub user_code: String,
    #[serde(alias = "verification_uri")]
    pub verification_uri: String,
    #[serde(alias = "expires_in")]
    pub expires_in: u64,
    pub interval: u64,
}

#[derive(Debug, Deserialize)]
struct OAuthError {
    error: String,
    error_description: Option<String>,
    interval: Option<u64>,
}

#[derive(Debug, Deserialize)]
struct TokenResponse {
    access_token: String,
}

#[derive(Debug, Deserialize)]
#[serde(untagged)]
enum TokenReply {
    Token(TokenResponse),
    Error(OAuthError),
}

/// Outcome of a single poll of the token endpoint.
#[derive(Debug)]
pub enum Poll {
    Pending,
    SlowDown { interval: u64 },
    Expired,
    Denied,
    Token(String),
}

fn describe(error: &OAuthError) -> String {
    match error.error.as_str() {
        "device_flow_disabled" => {
            "Device flow is not enabled for this OAuth app. Enable it in the app's settings on GitHub.".into()
        }
        "incorrect_client_credentials" | "unauthorized_client" => {
            "GitHub did not recognise the OAuth client id. Check it in Settings.".into()
        }
        _ => error
            .error_description
            .clone()
            .unwrap_or_else(|| error.error.replace('_', " ")),
    }
}

pub async fn start(client: &Client, client_id: &str) -> Result<DeviceCode> {
    let response = client
        .post(DEVICE_CODE_URL)
        .header(ACCEPT, "application/json")
        .form(&[("client_id", client_id), ("scope", SCOPES)])
        .send()
        .await?;
    let status = response.status();
    let text = response.text().await?;
    if let Ok(error) = serde_json::from_str::<OAuthError>(&text) {
        return Err(Error::Auth(describe(&error)));
    }
    if !status.is_success() {
        return Err(Error::Auth(if status.as_u16() == 404 {
            "GitHub did not recognise the OAuth client id. Check it in Settings.".into()
        } else {
            format!("GitHub returned {status} when starting sign-in")
        }));
    }
    Ok(serde_json::from_str(&text)?)
}

pub async fn poll(client: &Client, client_id: &str, device_code: &str) -> Result<Poll> {
    let response = client
        .post(ACCESS_TOKEN_URL)
        .header(ACCEPT, "application/json")
        .form(&[
            ("client_id", client_id),
            ("device_code", device_code),
            ("grant_type", DEVICE_GRANT),
        ])
        .send()
        .await?;
    let status = response.status();
    let text = response.text().await?;
    match serde_json::from_str::<TokenReply>(&text) {
        Ok(TokenReply::Token(token)) => Ok(Poll::Token(token.access_token)),
        Ok(TokenReply::Error(error)) => match error.error.as_str() {
            "authorization_pending" => Ok(Poll::Pending),
            "slow_down" => Ok(Poll::SlowDown {
                interval: error.interval.unwrap_or(10),
            }),
            "expired_token" | "token_expired" => Ok(Poll::Expired),
            "access_denied" => Ok(Poll::Denied),
            _ => Err(Error::Auth(describe(&error))),
        },
        Err(_) => Err(Error::Auth(format!(
            "Unexpected reply from GitHub ({status}) while signing in"
        ))),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_token_replies() {
        let ok: TokenReply = serde_json::from_str(
            r#"{"access_token":"gho_x","token_type":"bearer","scope":"repo,read:org"}"#,
        )
        .unwrap();
        assert!(matches!(ok, TokenReply::Token(t) if t.access_token == "gho_x"));

        let pending: TokenReply = serde_json::from_str(
            r#"{"error":"authorization_pending","error_description":"waiting","error_uri":"x"}"#,
        )
        .unwrap();
        assert!(matches!(pending, TokenReply::Error(e) if e.error == "authorization_pending"));

        let slow: TokenReply =
            serde_json::from_str(r#"{"error":"slow_down","interval":10}"#).unwrap();
        assert!(matches!(slow, TokenReply::Error(e) if e.interval == Some(10)));
    }

    #[test]
    fn parses_device_code() {
        let code: DeviceCode = serde_json::from_str(
            r#"{"device_code":"dc","user_code":"ABCD-1234","verification_uri":"https://github.com/login/device","expires_in":899,"interval":5}"#,
        )
        .unwrap();
        assert_eq!(code.user_code, "ABCD-1234");
        // Serialized for the frontend in camelCase.
        let json = serde_json::to_value(&code).unwrap();
        assert_eq!(json["userCode"], "ABCD-1234");
        assert_eq!(json["verificationUri"], "https://github.com/login/device");
    }

    #[test]
    fn explains_disabled_device_flow() {
        let error = OAuthError {
            error: "device_flow_disabled".into(),
            error_description: None,
            interval: None,
        };
        assert!(describe(&error).contains("Device flow is not enabled"));
    }
}
