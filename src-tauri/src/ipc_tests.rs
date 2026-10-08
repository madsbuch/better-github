//! Exercises the commands through Tauri's IPC layer with the same argument
//! shapes the frontend sends (see src/lib/backend.ts), so renames on either
//! side are caught.

use serde_json::{json, Value};
use tauri::ipc::{CallbackFn, InvokeBody};
use tauri::test::{
    get_ipc_response, mock_builder, mock_context, noop_assets, MockRuntime, INVOKE_KEY,
};
use tauri::webview::InvokeRequest;
use tauri::{Manager, WebviewWindow, WebviewWindowBuilder};

use crate::store::{AuthMethod, StoredSession};
use crate::{with_commands, AppState};

struct Harness {
    _app: tauri::App<MockRuntime>,
    window: WebviewWindow<MockRuntime>,
}

fn harness(name: &str) -> Harness {
    let dir = std::env::temp_dir().join(format!("ghc-ipc-{name}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    let app = with_commands(mock_builder())
        .manage(AppState::new(dir))
        .build(mock_context(noop_assets()))
        .expect("failed to build app");
    let window = WebviewWindowBuilder::new(&app, "main", Default::default())
        .build()
        .expect("failed to build window");
    Harness { _app: app, window }
}

impl Harness {
    fn invoke(&self, cmd: &str, args: Value) -> Result<Value, Value> {
        get_ipc_response(
            &self.window,
            InvokeRequest {
                cmd: cmd.into(),
                callback: CallbackFn(0),
                error: CallbackFn(1),
                url: "tauri://localhost".parse().unwrap(),
                body: InvokeBody::Json(args),
                headers: Default::default(),
                invoke_key: INVOKE_KEY.to_string(),
            },
        )
        .map(|body| body.deserialize::<Value>().unwrap())
    }

    fn sign_in_offline(&self) {
        let state = self.window.state::<AppState>();
        *state.session.write().unwrap() = Some(StoredSession {
            token: "gho_test".into(),
            method: AuthMethod::Token,
            login: "octocat".into(),
            name: None,
            avatar_url: String::new(),
            scopes: None,
        });
    }
}

#[test]
fn session_starts_empty() {
    let h = harness("session");
    assert_eq!(h.invoke("session_get", json!({})), Ok(Value::Null));
}

#[test]
fn session_info_never_contains_the_token() {
    let h = harness("token-hidden");
    h.sign_in_offline();
    let session = h.invoke("session_get", json!({})).unwrap();
    assert_eq!(session["login"], "octocat");
    assert_eq!(session["method"], "token");
    assert!(session.get("avatarUrl").is_some(), "camelCase field names");
    assert!(!session.to_string().contains("gho_test"));
}

#[test]
fn client_id_can_be_set_and_cleared() {
    let h = harness("client-id");
    let config = h
        .invoke(
            "auth_set_client_id",
            json!({ "clientId": "  Ov23liAbC123  " }),
        )
        .unwrap();
    assert_eq!(config["clientId"], "Ov23liAbC123");
    assert_eq!(config["clientIdSource"], "user");
    assert_eq!(
        h.invoke("auth_config", json!({})).unwrap()["clientId"],
        "Ov23liAbC123"
    );

    let cleared = h
        .invoke("auth_set_client_id", json!({ "clientId": null }))
        .unwrap();
    assert_ne!(cleared["clientIdSource"], "user");
}

#[test]
fn rejects_malformed_client_ids() {
    let h = harness("bad-client-id");
    let err = h
        .invoke(
            "auth_set_client_id",
            json!({ "clientId": "not a client id" }),
        )
        .unwrap_err();
    assert_eq!(err["kind"], "invalid");
}

#[test]
fn api_calls_require_a_session() {
    let h = harness("unauthenticated");
    let err = h
        .invoke("gh_rest", json!({ "request": { "path": "/user" } }))
        .unwrap_err();
    assert_eq!(err["kind"], "not_authenticated");
    assert_eq!(err["status"], 401);

    let err = h
        .invoke(
            "gh_graphql",
            json!({ "query": "{ viewer { login } }", "variables": {} }),
        )
        .unwrap_err();
    assert_eq!(err["kind"], "not_authenticated");
}

#[test]
fn api_calls_cannot_leave_api_github_com() {
    let h = harness("host-check");
    h.sign_in_offline();
    let err = h
        .invoke(
            "gh_rest",
            json!({ "request": { "method": "GET", "path": "https://example.com/steal" } }),
        )
        .unwrap_err();
    assert_eq!(err["kind"], "invalid");
}

#[test]
fn token_sign_in_validates_input_before_any_request() {
    let h = harness("token-input");
    let err = h
        .invoke("auth_with_token", json!({ "token": "   " }))
        .unwrap_err();
    assert_eq!(err["kind"], "invalid");
}

#[test]
fn device_flow_needs_a_client_id() {
    let h = harness("device");
    if crate::auth::build_time_client_id().is_some() {
        return; // A client id is baked into this build.
    }
    let err = h.invoke("auth_device_start", json!({})).unwrap_err();
    assert_eq!(err["kind"], "auth");
    let err = h
        .invoke("auth_device_poll", json!({ "deviceCode": "abc" }))
        .unwrap_err();
    assert_eq!(err["kind"], "auth");
}

#[test]
fn logout_clears_the_session() {
    let h = harness("logout");
    h.sign_in_offline();
    assert_eq!(h.invoke("auth_logout", json!({})), Ok(Value::Null));
    assert_eq!(h.invoke("session_get", json!({})), Ok(Value::Null));
}
