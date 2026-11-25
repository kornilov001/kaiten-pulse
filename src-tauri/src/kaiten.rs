//! Kaiten API access. The token lives in the OS keychain (macOS Keychain /
//! Windows Credential Manager) and never reaches the webview: the UI calls
//! `kaiten_request` and Rust attaches the Authorization header.

use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::sync::Mutex;
use tauri::State;

const KEYRING_SERVICE: &str = "ru.kaitenpulse.app";
const KEYRING_USER: &str = "kaiten-credentials";

#[derive(Clone, Serialize, Deserialize)]
pub struct Credentials {
    pub domain: String,
    pub token: String,
}

#[derive(Default)]
pub struct KaitenState {
    creds: Mutex<Option<Credentials>>,
    client: reqwest::Client,
}

#[derive(Debug, thiserror::Error)]
pub enum ApiError {
    #[error("not_configured")]
    NotConfigured,
    #[error("bad_request: {0}")]
    BadInput(String),
    #[error("http_{status}: {message}")]
    Http { status: u16, message: String },
    #[error("network: {0}")]
    Network(String),
    #[error("keychain: {0}")]
    Keychain(String),
}

impl Serialize for ApiError {
    fn serialize<S: serde::Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        s.serialize_str(&self.to_string())
    }
}

/// "acme", "acme.kaiten.ru", "https://acme.kaiten.ru/space/1" -> "acme.kaiten.ru"
pub fn normalize_domain(input: &str) -> Result<String, ApiError> {
    let mut d = input.trim().to_lowercase();
    for p in ["https://", "http://"] {
        if let Some(rest) = d.strip_prefix(p) {
            d = rest.to_string();
        }
    }
    let d = d.split('/').next().unwrap_or("").to_string();
    if d.is_empty() || !d.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '.') {
        return Err(ApiError::BadInput("domain".into()));
    }
    Ok(if d.contains('.') { d } else { format!("{d}.kaiten.ru") })
}

fn entry() -> Result<keyring::Entry, ApiError> {
    keyring::Entry::new(KEYRING_SERVICE, KEYRING_USER).map_err(|e| ApiError::Keychain(e.to_string()))
}

fn load_from_keychain() -> Option<Credentials> {
    let raw = entry().ok()?.get_password().ok()?;
    serde_json::from_str(&raw).ok()
}

/// Dev convenience: KAITEN_DOMAIN / KAITEN_TOKEN env vars in debug builds.
fn load_from_env() -> Option<Credentials> {
    if !cfg!(debug_assertions) {
        return None;
    }
    let domain = normalize_domain(&std::env::var("KAITEN_DOMAIN").ok()?).ok()?;
    let token = std::env::var("KAITEN_TOKEN").ok()?;
    Some(Credentials { domain, token })
}

impl KaitenState {
    fn current(&self) -> Result<Credentials, ApiError> {
        let mut guard = self.creds.lock().unwrap();
        if guard.is_none() {
            *guard = load_from_env().or_else(load_from_keychain);
        }
        guard.clone().ok_or(ApiError::NotConfigured)
    }

    async fn send(
        &self,
        creds: &Credentials,
        method: &str,
        path: &str,
        query: Option<Vec<(String, String)>>,
        body: Option<Value>,
    ) -> Result<Value, ApiError> {
        if !path.starts_with('/') || path.contains("..") || path.contains("://") {
            return Err(ApiError::BadInput("path".into()));
        }
        let method = match method.to_uppercase().as_str() {
            "GET" => reqwest::Method::GET,
            "POST" => reqwest::Method::POST,
            "PATCH" => reqwest::Method::PATCH,
            "PUT" => reqwest::Method::PUT,
            "DELETE" => reqwest::Method::DELETE,
            _ => return Err(ApiError::BadInput("method".into())),
        };
        let url = format!("https://{}/api/latest{}", creds.domain, path);
        let mut req = self
            .client
            .request(method, url)
            .bearer_auth(&creds.token)
            .header("Accept", "application/json");
        if let Some(q) = query {
            req = req.query(&q);
        }
        if let Some(b) = body {
            req = req.json(&b);
        }
        let resp = req.send().await.map_err(|e| ApiError::Network(e.to_string()))?;
        let status = resp.status();
        let text = resp.text().await.map_err(|e| ApiError::Network(e.to_string()))?;
        if !status.is_success() {
            let message = serde_json::from_str::<Value>(&text)
                .ok()
                .and_then(|v| v.get("message").and_then(|m| m.as_str()).map(String::from))
                .unwrap_or_else(|| text.chars().take(300).collect());
            return Err(ApiError::Http { status: status.as_u16(), message });
        }
        if text.trim().is_empty() {
            return Ok(Value::Null);
        }
        serde_json::from_str(&text).map_err(|e| ApiError::Network(format!("invalid json: {e}")))
    }
}

#[derive(Serialize)]
pub struct ConnectionInfo {
    domain: String,
}

#[tauri::command]
pub fn connection_info(state: State<'_, KaitenState>) -> Option<ConnectionInfo> {
    state.current().ok().map(|c| ConnectionInfo { domain: c.domain })
}

/// Validates the token against /users/current, then saves it. Returns the user.
#[tauri::command]
pub async fn connect(
    state: State<'_, KaitenState>,
    domain: String,
    token: String,
) -> Result<Value, ApiError> {
    let creds = Credentials { domain: normalize_domain(&domain)?, token: token.trim().to_string() };
    if creds.token.is_empty() {
        return Err(ApiError::BadInput("token".into()));
    }
    let user = state.send(&creds, "GET", "/users/current", None, None).await?;
    let raw = serde_json::to_string(&creds).unwrap();
    entry()?.set_password(&raw).map_err(|e| ApiError::Keychain(e.to_string()))?;
    *state.creds.lock().unwrap() = Some(creds);
    Ok(user)
}

#[tauri::command]
pub fn disconnect(state: State<'_, KaitenState>) -> Result<(), ApiError> {
    *state.creds.lock().unwrap() = None;
    match entry()?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(ApiError::Keychain(e.to_string())),
    }
}

#[tauri::command]
pub async fn kaiten_request(
    state: State<'_, KaitenState>,
    method: String,
    path: String,
    query: Option<Vec<(String, String)>>,
    body: Option<Value>,
) -> Result<Value, ApiError> {
    let creds = state.current()?;
    state.send(&creds, &method, &path, query, body).await
}

#[cfg(test)]
mod tests {
    use super::normalize_domain;

    #[test]
    fn domains() {
        assert_eq!(normalize_domain("acme").unwrap(), "acme.kaiten.ru");
        assert_eq!(normalize_domain(" https://Acme.kaiten.ru/space/1 ").unwrap(), "acme.kaiten.ru");
        assert_eq!(normalize_domain("kaiten.corp.local").unwrap(), "kaiten.corp.local");
        assert!(normalize_domain("").is_err());
        assert!(normalize_domain("evil.com@x").is_err());
    }
}
