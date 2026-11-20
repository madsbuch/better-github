mod auth;
mod error;
mod github;
#[cfg(test)]
mod ipc_tests;
mod store;

use std::path::PathBuf;
use std::sync::{PoisonError, RwLock, RwLockReadGuard, RwLockWriteGuard};

use serde::Serialize;
use tauri::{Manager, Runtime, State};

use crate::auth::DeviceCode;
use crate::error::{Error, Result};
use crate::github::{
    ArchiveFormat, GraphQlEnvelope, GraphQlVariables, JobLog, RestRequest, RestResponse,
};
use crate::store::{AuthMethod, Config, SessionInfo, Store, StoredSession};

struct AppState {
    http: reqwest::Client,
    /// Doesn't follow redirects: resolves download links.
    downloads: reqwest::Client,
    store: Store,
    session: RwLock<Option<StoredSession>>,
    config: RwLock<Config>,
}

/// Locks are only held for plain reads and assignments, so the data behind a
/// lock poisoned by a panic elsewhere is still whole: carry on with it.
fn read<T>(lock: &RwLock<T>) -> RwLockReadGuard<'_, T> {
    lock.read().unwrap_or_else(PoisonError::into_inner)
}

fn write<T>(lock: &RwLock<T>) -> RwLockWriteGuard<'_, T> {
    lock.write().unwrap_or_else(PoisonError::into_inner)
}

impl AppState {
    fn new(data_dir: PathBuf) -> Result<Self> {
        let store = Store::new(data_dir);
        let session = store.load_session();
        let config = store.load_config();
        Ok(AppState {
            http: github::build_client()?,
            downloads: github::build_no_redirect_client()?,
            store,
            session: RwLock::new(session),
            config: RwLock::new(config),
        })
    }

    fn token(&self) -> Result<String> {
        read(&self.session)
            .as_ref()
            .map(|s| s.token.clone())
            .ok_or(Error::NotAuthenticated)
    }

    /// The token if signed in; `None` in guest mode (public reads only).
    fn optional_token(&self) -> Option<String> {
        read(&self.session).as_ref().map(|s| s.token.clone())
    }

    fn client_id(&self) -> Option<String> {
        read(&self.config)
            .client_id
            .clone()
            .or_else(|| auth::build_time_client_id().map(str::to_owned))
    }

    /// Validates a token against `/user` and persists the resulting session.
    async fn sign_in(&self, token: String, method: AuthMethod) -> Result<SessionInfo> {
        let (user, scopes) = github::current_user(&self.http, &token).await?;
        let session = StoredSession {
            token,
            method,
            login: user.login,
            name: user.name,
            avatar_url: user.avatar_url,
            scopes,
        };
        self.store.save_session(&session)?;
        let info = SessionInfo::from(&session);
        *write(&self.session) = Some(session);
        Ok(info)
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct AuthConfig {
    client_id: Option<String>,
    /// "user" when entered in the app, "build" when baked into the binary.
    client_id_source: Option<&'static str>,
    scopes: &'static str,
}

#[derive(Serialize)]
#[serde(tag = "status", rename_all = "snake_case")]
enum PollResult {
    Pending,
    SlowDown { interval: u64 },
    Expired,
    Denied,
    Complete { session: SessionInfo },
}

#[tauri::command]
fn session_get(state: State<'_, AppState>) -> Option<SessionInfo> {
    read(&state.session).as_ref().map(SessionInfo::from)
}

#[tauri::command]
fn auth_config(state: State<'_, AppState>) -> AuthConfig {
    let user = read(&state.config).client_id.clone();
    let (client_id, source) = match user {
        Some(id) => (Some(id), Some("user")),
        None => match auth::build_time_client_id() {
            Some(id) => (Some(id.to_owned()), Some("build")),
            None => (None, None),
        },
    };
    AuthConfig {
        client_id,
        client_id_source: source,
        scopes: auth::SCOPES,
    }
}

#[tauri::command]
fn auth_set_client_id(state: State<'_, AppState>, client_id: Option<String>) -> Result<AuthConfig> {
    let client_id = client_id
        .map(|s| s.trim().to_owned())
        .filter(|s| !s.is_empty());
    if let Some(id) = &client_id {
        if !id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '.' || c == '_' || c == '-')
        {
            return Err(Error::Invalid(
                "That does not look like an OAuth client id".into(),
            ));
        }
    }
    {
        let mut config = write(&state.config);
        config.client_id = client_id;
        state.store.save_config(&config)?;
    }
    Ok(auth_config(state))
}

#[tauri::command]
async fn auth_device_start(state: State<'_, AppState>) -> Result<DeviceCode> {
    let client_id = state.client_id().ok_or_else(|| {
        Error::Auth("No OAuth client id is configured. Add one under \"OAuth app\" or sign in with a token.".into())
    })?;
    auth::start(&state.http, &client_id).await
}

#[tauri::command]
async fn auth_device_poll(state: State<'_, AppState>, device_code: String) -> Result<PollResult> {
    let client_id = state
        .client_id()
        .ok_or_else(|| Error::Auth("No OAuth client id is configured".into()))?;
    Ok(
        match auth::poll(&state.http, &client_id, &device_code).await? {
            auth::Poll::Pending => PollResult::Pending,
            auth::Poll::SlowDown { interval } => PollResult::SlowDown { interval },
            auth::Poll::Expired => PollResult::Expired,
            auth::Poll::Denied => PollResult::Denied,
            auth::Poll::Token(token) => PollResult::Complete {
                session: state.sign_in(token, AuthMethod::Device).await?,
            },
        },
    )
}

#[tauri::command]
async fn auth_with_token(state: State<'_, AppState>, token: String) -> Result<SessionInfo> {
    let token = token.trim().to_owned();
    if token.is_empty() || token.chars().any(|c| c.is_whitespace() || c.is_control()) {
        return Err(Error::Invalid("Paste a valid personal access token".into()));
    }
    state.sign_in(token, AuthMethod::Token).await
}

#[tauri::command]
fn auth_logout(state: State<'_, AppState>) -> Result<()> {
    *write(&state.session) = None;
    state.store.clear_session()
}

#[tauri::command]
async fn gh_rest(state: State<'_, AppState>, request: RestRequest) -> Result<RestResponse> {
    let token = state.optional_token();
    github::rest(&state.http, token.as_deref(), request).await
}

#[tauri::command]
async fn gh_graphql(
    state: State<'_, AppState>,
    query: String,
    variables: Option<GraphQlVariables>,
) -> Result<GraphQlEnvelope> {
    let token = state.token()?;
    github::graphql(&state.http, &token, &query, variables).await
}

#[tauri::command]
async fn gh_job_logs(
    state: State<'_, AppState>,
    owner: String,
    repo: String,
    job_id: u64,
) -> Result<JobLog> {
    let token = state.token()?;
    github::job_logs(&state.http, &token, &owner, &repo, job_id).await
}

/// A short-lived link to a release asset, for the device's download manager.
#[tauri::command]
async fn gh_asset_url(
    state: State<'_, AppState>,
    owner: String,
    repo: String,
    asset_id: u64,
) -> Result<String> {
    let token = state.optional_token();
    github::asset_url(&state.downloads, token.as_deref(), &owner, &repo, asset_id).await
}

/// A short-lived link to a zip or tar.gz of the source at a ref.
#[tauri::command]
async fn gh_archive_url(
    state: State<'_, AppState>,
    owner: String,
    repo: String,
    git_ref: String,
    format: ArchiveFormat,
) -> Result<String> {
    let token = state.optional_token();
    github::archive_url(
        &state.downloads,
        token.as_deref(),
        &owner,
        &repo,
        &git_ref,
        format,
    )
    .await
}

/// Registers the app's commands; shared with the IPC tests.
fn with_commands<R: Runtime>(builder: tauri::Builder<R>) -> tauri::Builder<R> {
    builder.invoke_handler(tauri::generate_handler![
        session_get,
        auth_config,
        auth_set_client_id,
        auth_device_start,
        auth_device_poll,
        auth_with_token,
        auth_logout,
        gh_rest,
        gh_graphql,
        gh_job_logs,
        gh_asset_url,
        gh_archive_url,
    ])
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = with_commands(tauri::Builder::default())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .setup(|app| {
            app.manage(AppState::new(app.path().app_data_dir()?)?);
            Ok(())
        });
    // Desktop windows reopen at the size and position they were closed at.
    #[cfg(desktop)]
    let app = app.plugin(tauri_plugin_window_state::Builder::default().build());
    if let Err(error) = app.run(tauri::generate_context!()) {
        eprintln!("error while running Better GitHub: {error}");
        std::process::exit(1);
    }
}
