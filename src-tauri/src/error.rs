use serde::ser::SerializeStruct;
use serde::Serialize;

use crate::github::{GraphQlError, RestErrorItem};

pub type Result<T> = std::result::Result<T, Error>;

/// Errors surfaced to the frontend. They are serialized as
/// `{ kind, message, status?, errors? }` so the UI can react to e.g. a 401.
#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("You are not signed in")]
    NotAuthenticated,
    #[error("{message}")]
    Api {
        status: u16,
        message: String,
        errors: Option<ApiErrors>,
    },
    #[error("{0}")]
    Auth(String),
    #[error("{0}")]
    Invalid(String),
    #[error("Network error: {0}")]
    Network(#[from] reqwest::Error),
    #[error("Storage error: {0}")]
    Io(#[from] std::io::Error),
    #[error("Unexpected response: {0}")]
    Json(#[from] serde_json::Error),
}

/// The details GitHub sent with a failure, passed on to the frontend.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(untagged)]
pub enum ApiErrors {
    /// REST validation errors (`errors` in a 4xx body).
    Rest(Vec<RestErrorItem>),
    /// GraphQL errors from a response without data.
    GraphQl(Vec<GraphQlError>),
}

impl Error {
    fn kind(&self) -> &'static str {
        match self {
            Error::NotAuthenticated => "not_authenticated",
            Error::Api { .. } => "api",
            Error::Auth(_) => "auth",
            Error::Invalid(_) => "invalid",
            Error::Network(_) => "network",
            Error::Io(_) => "io",
            Error::Json(_) => "json",
        }
    }
}

impl Serialize for Error {
    fn serialize<S: serde::Serializer>(
        &self,
        serializer: S,
    ) -> std::result::Result<S::Ok, S::Error> {
        let mut s = serializer.serialize_struct("Error", 4)?;
        s.serialize_field("kind", self.kind())?;
        s.serialize_field("message", &self.to_string())?;
        match self {
            Error::Api { status, errors, .. } => {
                s.serialize_field("status", status)?;
                s.serialize_field("errors", errors)?;
            }
            Error::NotAuthenticated => {
                s.serialize_field("status", &401)?;
                s.serialize_field("errors", &None::<()>)?;
            }
            _ => {
                s.serialize_field("status", &None::<u16>)?;
                s.serialize_field("errors", &None::<()>)?;
            }
        }
        s.end()
    }
}
