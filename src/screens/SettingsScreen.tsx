import { getVersion } from "@tauri-apps/api/app";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { errorMessage } from "../lib/api";
import { backend, type AuthConfig } from "../lib/backend";
import { fullDate } from "../lib/format";
import { setPref, usePrefs } from "../lib/prefs";
import { useIsGuest, useSessionApi, useViewer } from "../lib/session";
import { useToast } from "../lib/toast";
import { guestQueries } from "../queries/guest";
import { viewerQueries } from "../queries/viewer";
import { Screen } from "../components/Screen";

export function SettingsScreen() {
  const guest = useIsGuest();
  return (
    <Screen title="Settings">
      {guest ? <GuestAccount /> : <Account />}
      <AppSettings />
    </Screen>
  );
}

function GuestAccount() {
  const sessionApi = useSessionApi();
  const rate = useQuery(guestQueries.rateLimit());
  return (
    <>
      <h3 className="section-title">Account</h3>
      <div className="kv">
        <span className="grow">
          Browsing without signing in
          <span className="muted small" style={{ display: "block" }}>
            Public profiles and repositories only
          </span>
        </span>
      </div>
      {rate.data && (
        <div className="kv">
          <span className="grow">
            API rate limit
            <span className="muted small" style={{ display: "block" }}>
              {rate.data.remaining.toLocaleString()} of {rate.data.limit.toLocaleString()} requests left · resets {fullDate(rate.data.resetAt)}
            </span>
          </span>
        </div>
      )}
      <div className="pad">
        <button className="btn btn-block btn-primary" onClick={() => void sessionApi.leaveGuest()}>
          Sign in to GitHub
        </button>
      </div>
    </>
  );
}

function Account() {
  const session = useViewer();
  const sessionApi = useSessionApi();
  const rate = useQuery(viewerQueries.rateLimit());

  return (
    <>
      <h3 className="section-title">Account</h3>
      <div className="kv">
        <span className="grow">
          Signed in as <strong>{session.login}</strong>
          <span className="muted small" style={{ display: "block" }}>
            {session.method === "device" ? "via GitHub sign-in" : "with a personal access token"}
            {session.scopes !== null && session.scopes !== "" ? ` · scopes: ${session.scopes}` : ""}
          </span>
        </span>
      </div>
      {rate.data && (
        <div className="kv">
          <span className="grow">
            API rate limit
            <span className="muted small" style={{ display: "block" }}>
              {rate.data.rateLimit.remaining.toLocaleString()} of {rate.data.rateLimit.limit.toLocaleString()} points left ·
              resets {fullDate(rate.data.rateLimit.resetAt)}
            </span>
          </span>
        </div>
      )}
      <div className="pad">
        <button className="btn btn-block btn-danger" onClick={() => void sessionApi.signOut()}>
          Sign out
        </button>
        <p className="muted small" style={{ marginBottom: 0 }}>
          Signing out removes the token from this device. To revoke it everywhere, visit GitHub →
          Settings → Applications.
        </p>
      </div>

    </>
  );
}

function AppSettings() {
  const prefs = usePrefs();
  const toast = useToast();
  const [config, setConfig] = useState<AuthConfig | null>(null);
  const [clientId, setClientId] = useState("");
  const [version, setVersion] = useState<string | null>(null);

  useEffect(() => {
    void backend.authConfig().then((c) => {
      setConfig(c);
      setClientId(c.clientId ?? "");
    });
    if (backend.native) getVersion().then(setVersion).catch(() => setVersion(null));
  }, []);

  const saveClientId = async () => {
    try {
      const trimmed = clientId.trim();
      const next = await backend.authSetClientId(trimmed === "" ? null : trimmed);
      setConfig(next);
      setClientId(next.clientId ?? "");
      toast.show("Saved", "success");
    } catch (e) {
      toast.show(errorMessage(e), "error");
    }
  };

  return (
    <>
      <h3 className="section-title">Appearance</h3>
      <div className="chips" role="radiogroup" aria-label="Theme" style={{ borderBottom: 0 }}>
        {(["system", "light", "dark"] as const).map((t) => (
          <button
            key={t}
            role="radio"
            aria-checked={prefs.theme === t}
            className={prefs.theme === t ? "chip active" : "chip"}
            onClick={() => setPref("theme", t)}
          >
            {t === "system" ? "System" : t === "light" ? "Light" : "Dark"}
          </button>
        ))}
      </div>

      <h3 className="section-title">Code</h3>
      <label className="kv checkbox-row">
        <input type="checkbox" checked={prefs.wrapDiff} onChange={(e) => setPref("wrapDiff", e.target.checked)} />
        <span className="grow">Wrap long lines in diffs</span>
      </label>
      <label className="kv checkbox-row">
        <input type="checkbox" checked={prefs.wrapCode} onChange={(e) => setPref("wrapCode", e.target.checked)} />
        <span className="grow">Wrap long lines in files</span>
      </label>

      {backend.native && config && (
        <>
          <h3 className="section-title">GitHub sign-in</h3>
          <div className="pad stack-v">
            <div>
              <label className="field-label" htmlFor="settings-client-id">
                OAuth app client id
              </label>
              <input
                id="settings-client-id"
                className="input mono"
                value={clientId}
                placeholder={config.clientIdSource === "build" ? "Using the built-in app" : "Not set"}
                autoCapitalize="off"
                autoCorrect="off"
                spellCheck={false}
                onChange={(e) => setClientId(e.target.value)}
              />
              <p className="muted small" style={{ marginBottom: 0 }}>
                {config.clientIdSource === "build"
                  ? "This build ships with an OAuth app. Enter another client id to override it."
                  : "Used for “Sign in with GitHub”. The OAuth app must have Device Flow enabled."}
              </p>
            </div>
            <button className="btn" onClick={() => void saveClientId()}>
              Save client id
            </button>
          </div>
        </>
      )}

      <h3 className="section-title">About</h3>
      <div className="kv">
        <span className="grow">Better GitHub{version !== null && version !== "" ? ` ${version}` : ""}</span>
      </div>
      <button
        className="kv"
        style={{ width: "100%", border: 0, borderBottom: "1px solid var(--border-muted)", background: "none", textAlign: "left", color: "var(--accent)" }}
        onClick={() => void backend.openUrl("https://github.com/madsbuch/better-github")}
      >
        Source code on GitHub
      </button>
    </>
  );
}
