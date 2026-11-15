import { CopyIcon, KeyIcon, LinkExternalIcon, MarkGithubIcon } from "@primer/octicons-react";
import { useEffect, useRef, useState } from "react";
import { errorMessage } from "../lib/api";
import { backend, type AuthConfig, type DeviceCode } from "../lib/backend";
import { useSessionApi } from "../lib/session";
import { useToast } from "../lib/toast";
import { Spinner } from "../components/ui";

const TOKEN_URL =
  "https://github.com/settings/tokens/new?description=Better%20GitHub&scopes=repo,read:org,notifications,read:user";
const NEW_OAUTH_APP_URL = "https://github.com/settings/applications/new";

type DeviceState =
  | { step: "idle" }
  | { step: "starting" }
  | { step: "waiting"; code: DeviceCode; expiresAt: number }
  | { step: "finishing" };

export function LoginScreen() {
  const { signedIn } = useSessionApi();
  const toast = useToast();
  const [config, setConfig] = useState<AuthConfig | null>(null);
  const [device, setDevice] = useState<DeviceState>({ step: "idle" });
  const [error, setError] = useState<string | null>(null);
  const [showToken, setShowToken] = useState(false);
  const [token, setToken] = useState("");
  const [tokenBusy, setTokenBusy] = useState(false);
  const [clientIdDraft, setClientIdDraft] = useState("");
  const [showClientId, setShowClientId] = useState(false);

  useEffect(() => {
    backend
      .authConfig()
      .then((c) => {
        setConfig(c);
        setClientIdDraft(c.clientId ?? "");
      })
      .catch(() => setConfig({ clientId: null, clientIdSource: null, scopes: "" }));
  }, []);

  const deviceAvailable = backend.native && !!config?.clientId;

  // ---- device flow -------------------------------------------------------

  const pollTimer = useRef<number | null>(null);
  const polling = useRef(false);
  const interval = useRef(5);
  const lastPoll = useRef(0);

  const stopPolling = () => {
    if (pollTimer.current !== null) window.clearTimeout(pollTimer.current);
    pollTimer.current = null;
  };

  useEffect(() => stopPolling, []);

  const poll = async (code: DeviceCode, expiresAt: number) => {
    if (polling.current) return;
    if (Date.now() > expiresAt) {
      setDevice({ step: "idle" });
      setError("The code expired. Start again to get a new one.");
      return;
    }
    polling.current = true;
    lastPoll.current = Date.now();
    try {
      const result = await backend.authDevicePoll(code.deviceCode);
      switch (result.status) {
        case "complete":
          stopPolling();
          setDevice({ step: "finishing" });
          signedIn(result.session);
          return;
        case "denied":
          stopPolling();
          setDevice({ step: "idle" });
          setError("Authorization was cancelled on GitHub.");
          return;
        case "expired":
          stopPolling();
          setDevice({ step: "idle" });
          setError("The code expired. Start again to get a new one.");
          return;
        case "slow_down":
          interval.current = result.interval + 1;
          break;
        case "pending":
          break;
      }
    } catch (e) {
      // Network hiccups while the user is in the browser are expected; keep polling.
      if ((e as { kind?: string }).kind !== "network") {
        stopPolling();
        setDevice({ step: "idle" });
        setError(errorMessage(e));
        return;
      }
    } finally {
      polling.current = false;
    }
    schedule(code, expiresAt);
  };

  const schedule = (code: DeviceCode, expiresAt: number) => {
    stopPolling();
    pollTimer.current = window.setTimeout(() => void poll(code, expiresAt), interval.current * 1000);
  };

  // Poll right away when the user switches back from the browser, unless
  // that would be sooner than GitHub's polling interval allows.
  useEffect(() => {
    if (device.step !== "waiting") return;
    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      if (Date.now() - lastPoll.current < interval.current * 1000) return;
      void poll(device.code, device.expiresAt);
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
    };
  }, [device]);

  const startDeviceFlow = async () => {
    setError(null);
    setDevice({ step: "starting" });
    try {
      const code = await backend.authDeviceStart();
      const expiresAt = Date.now() + code.expiresIn * 1000;
      interval.current = Math.max(code.interval, 5);
      setDevice({ step: "waiting", code, expiresAt });
      schedule(code, expiresAt);
    } catch (e) {
      setDevice({ step: "idle" });
      setError(errorMessage(e));
    }
  };

  const copyAndOpen = async (code: DeviceCode) => {
    try {
      await backend.copyText(code.userCode);
      toast.show("Code copied. Paste it on GitHub.", "success");
    } catch {
      // Clipboard can fail; the code is on screen anyway.
    }
    await backend.openUrl(code.verificationUri);
  };

  const cancelDevice = () => {
    stopPolling();
    setDevice({ step: "idle" });
  };

  // ---- token ---------------------------------------------------------------

  const signInWithToken = async () => {
    setError(null);
    setTokenBusy(true);
    try {
      signedIn(await backend.authWithToken(token));
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setTokenBusy(false);
    }
  };

  const saveClientId = async () => {
    setError(null);
    try {
      const next = await backend.authSetClientId(clientIdDraft.trim() || null);
      setConfig(next);
      setShowClientId(false);
      toast.show(next.clientId ? "OAuth app saved" : "OAuth app cleared", "success");
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  // ---- render --------------------------------------------------------------

  if (device.step === "waiting" || device.step === "finishing") {
    const code = device.step === "waiting" ? device.code : null;
    return (
      <div className="login">
        <div>
          <h1>Confirm on GitHub</h1>
          <p style={{ marginTop: 8 }}>
            Enter this code at <span className="mono">github.com/login/device</span> to let Better GitHub access your
            account.
          </p>
        </div>
        {code && (
          <>
            <div className="device-code" aria-label="Your one-time code">
              {code.userCode}
            </div>
            <button className="btn btn-primary btn-block" onClick={() => void copyAndOpen(code)}>
              <CopyIcon size={16} /> Copy code &amp; open GitHub
            </button>
          </>
        )}
        <div className="row-flex muted small" style={{ justifyContent: "center" }}>
          <Spinner small /> {device.step === "finishing" ? "Signing in…" : "Waiting for you to authorize…"}
        </div>
        {device.step === "waiting" && (
          <button className="btn btn-ghost" onClick={cancelDevice}>
            Cancel
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="login">
      <img className="login-logo" src="/icon.svg" alt="" />
      <div>
        <h1>Better GitHub</h1>
        <p style={{ marginTop: 8 }}>Review pull requests, triage your inbox and browse code on your phone or tablet.</p>
      </div>

      {error && <div className="banner banner-danger" style={{ margin: 0 }}>{error}</div>}

      {backend.native && (
        <button
          className="btn btn-primary btn-block"
          style={{ minHeight: 48, fontSize: 16 }}
          disabled={device.step === "starting" || !config}
          onClick={() => (deviceAvailable ? void startDeviceFlow() : setShowClientId(true))}
        >
          {device.step === "starting" ? <Spinner small /> : <MarkGithubIcon size={20} />}
          Sign in with GitHub
        </button>
      )}

      {backend.native && config && !config.clientId && !showClientId && (
        <p className="small">
          Sign-in with GitHub needs an OAuth app client id.{" "}
          <button className="link-btn" onClick={() => setShowClientId(true)}>
            Set it up
          </button>{" "}
          or use a personal access token below.
        </p>
      )}

      {showClientId && (
        <div className="card pad stack-v">
          <div>
            <label className="field-label" htmlFor="client-id">
              OAuth app client id
            </label>
            <input
              id="client-id"
              className="input mono"
              placeholder="Ov23li…"
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              value={clientIdDraft}
              onChange={(e) => setClientIdDraft(e.target.value)}
            />
          </div>
          <p className="small">
            Create an OAuth app on GitHub (any homepage and callback URL will do), tick <strong>Enable Device Flow</strong>,
            and paste its client id here. No client secret is needed.
          </p>
          <div className="row-flex">
            <button className="btn" onClick={() => void backend.openUrl(NEW_OAUTH_APP_URL)}>
              <LinkExternalIcon size={14} /> Create app
            </button>
            <span className="grow" />
            <button className="btn btn-ghost" onClick={() => setShowClientId(false)}>
              Cancel
            </button>
            <button className="btn btn-primary" onClick={() => void saveClientId()}>
              Save
            </button>
          </div>
        </div>
      )}

      {backend.native && <div className="divider">or</div>}

      {!showToken && backend.native ? (
        <button className="btn btn-block" onClick={() => setShowToken(true)}>
          <KeyIcon size={16} /> Use a personal access token
        </button>
      ) : (
        <div className="stack-v">
          <div>
            <label className="field-label" htmlFor="token">
              Personal access token
            </label>
            <input
              id="token"
              className="input mono"
              type="password"
              placeholder="ghp_… or github_pat_…"
              autoCapitalize="off"
              autoCorrect="off"
              autoComplete="off"
              spellCheck={false}
              value={token}
              onChange={(e) => setToken(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && token.trim()) void signInWithToken();
              }}
            />
          </div>
          <p className="small">
            Classic tokens need the <span className="mono">repo</span>, <span className="mono">read:org</span>,{" "}
            <span className="mono">notifications</span> and <span className="mono">read:user</span> scopes.{" "}
            <button className="link-btn" onClick={() => void backend.openUrl(TOKEN_URL)}>
              Create one
            </button>
          </p>
          <button className="btn btn-primary btn-block" disabled={!token.trim() || tokenBusy} onClick={() => void signInWithToken()}>
            {tokenBusy ? <Spinner small /> : null} Sign in with token
          </button>
        </div>
      )}

      {backend.native && config?.clientId && !showClientId && (
        <button className="link-btn small" style={{ alignSelf: "center" }} onClick={() => setShowClientId(true)}>
          OAuth app settings
        </button>
      )}
    </div>
  );
}
