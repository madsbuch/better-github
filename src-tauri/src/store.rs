//! Small JSON persistence for the session and user settings.
//!
//! Files live in the app's private data directory. On Android that is the
//! app sandbox (`/data/data/<package>/...`), which other apps cannot read.

use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};

use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};

use crate::error::Result;

const SESSION_FILE: &str = "session.json";
const CONFIG_FILE: &str = "config.json";

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum AuthMethod {
    Device,
    Token,
}

/// The persisted session. Never sent to the frontend as-is: see `SessionInfo`.
#[derive(Clone, Serialize, Deserialize)]
pub struct StoredSession {
    pub token: String,
    pub method: AuthMethod,
    pub login: String,
    pub name: Option<String>,
    pub avatar_url: String,
    pub scopes: Option<String>,
}

impl std::fmt::Debug for StoredSession {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("StoredSession")
            .field("token", &"<redacted>")
            .field("method", &self.method)
            .field("login", &self.login)
            .finish_non_exhaustive()
    }
}

/// What the frontend gets to know about the session (no token).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionInfo {
    pub login: String,
    pub name: Option<String>,
    pub avatar_url: String,
    pub method: AuthMethod,
    pub scopes: Option<String>,
}

impl From<&StoredSession> for SessionInfo {
    fn from(s: &StoredSession) -> Self {
        SessionInfo {
            login: s.login.clone(),
            name: s.name.clone(),
            avatar_url: s.avatar_url.clone(),
            method: s.method,
            scopes: s.scopes.clone(),
        }
    }
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct Config {
    /// OAuth app client id entered in the app. Overrides the build-time one.
    #[serde(default)]
    pub client_id: Option<String>,
}

pub struct Store {
    dir: PathBuf,
}

impl Store {
    pub fn new(dir: PathBuf) -> Self {
        Store { dir }
    }

    pub fn load_session(&self) -> Option<StoredSession> {
        read_json(&self.dir.join(SESSION_FILE))
    }

    pub fn save_session(&self, session: &StoredSession) -> Result<()> {
        write_json(&self.dir, SESSION_FILE, session)
    }

    pub fn clear_session(&self) -> Result<()> {
        match fs::remove_file(self.dir.join(SESSION_FILE)) {
            Err(e) if e.kind() != std::io::ErrorKind::NotFound => Err(e.into()),
            _ => Ok(()),
        }
    }

    pub fn load_config(&self) -> Config {
        read_json(&self.dir.join(CONFIG_FILE)).unwrap_or_default()
    }

    pub fn save_config(&self, config: &Config) -> Result<()> {
        write_json(&self.dir, CONFIG_FILE, config)
    }
}

fn read_json<T: DeserializeOwned>(path: &Path) -> Option<T> {
    let bytes = fs::read(path).ok()?;
    serde_json::from_slice(&bytes).ok()
}

/// Writes atomically (temp file + rename) with owner-only permissions on unix.
fn write_json<T: Serialize>(dir: &Path, name: &str, value: &T) -> Result<()> {
    fs::create_dir_all(dir)?;
    let tmp = dir.join(format!("{name}.tmp"));
    let bytes = serde_json::to_vec_pretty(value)?;
    {
        let mut options = fs::OpenOptions::new();
        options.write(true).create(true).truncate(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        let mut file = options.open(&tmp)?;
        file.write_all(&bytes)?;
        file.sync_all()?;
    }
    fs::rename(&tmp, dir.join(name))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("ghc-store-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        dir
    }

    #[test]
    fn session_roundtrip_and_clear() {
        let store = Store::new(temp_dir("session"));
        assert!(store.load_session().is_none());
        let session = StoredSession {
            token: "gho_secret".into(),
            method: AuthMethod::Device,
            login: "octocat".into(),
            name: Some("The Octocat".into()),
            avatar_url: "https://avatars.githubusercontent.com/u/583231".into(),
            scopes: Some("repo".into()),
        };
        store.save_session(&session).unwrap();
        let loaded = store.load_session().unwrap();
        assert_eq!(loaded.token, "gho_secret");
        assert_eq!(loaded.login, "octocat");
        assert_eq!(loaded.method, AuthMethod::Device);
        store.clear_session().unwrap();
        assert!(store.load_session().is_none());
        // Clearing twice is fine.
        store.clear_session().unwrap();
    }

    #[test]
    fn debug_redacts_token() {
        let session = StoredSession {
            token: "gho_secret".into(),
            method: AuthMethod::Token,
            login: "octocat".into(),
            name: None,
            avatar_url: String::new(),
            scopes: None,
        };
        assert!(!format!("{session:?}").contains("gho_secret"));
    }

    #[test]
    fn config_defaults_when_missing() {
        let store = Store::new(temp_dir("config"));
        assert!(store.load_config().client_id.is_none());
        store
            .save_config(&Config {
                client_id: Some("Iv1.abc".into()),
            })
            .unwrap();
        assert_eq!(store.load_config().client_id.as_deref(), Some("Iv1.abc"));
    }
}
