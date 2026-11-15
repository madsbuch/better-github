// Transport to the GitHub API.
//
// Inside the app every call goes through Rust commands (src-tauri/src/lib.rs),
// which hold the token and only ever talk to api.github.com. When the UI is
// opened in a plain browser during development (`npm run dev`), a fallback
// calls the API directly with a personal access token kept in localStorage.

import { invoke, isTauri } from "@tauri-apps/api/core";
import { createMockBackend } from "../dev/mock";

export type AuthMethod = "device" | "token";

export interface SessionInfo {
  login: string;
  name: string | null;
  avatarUrl: string;
  method: AuthMethod;
  scopes: string | null;
}

export interface AuthConfig {
  clientId: string | null;
  clientIdSource: "user" | "build" | null;
  scopes: string;
}

export interface DeviceCode {
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  expiresIn: number;
  interval: number;
}

export type PollResult =
  | { status: "pending" }
  | { status: "slow_down"; interval: number }
  | { status: "expired" }
  | { status: "denied" }
  | { status: "complete"; session: SessionInfo };

export type QueryValue = string | number | boolean | null | undefined;

export interface RestRequest {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  path: string;
  query?: Record<string, QueryValue>;
  body?: unknown;
  accept?: string;
}

export interface RestResponse<T> {
  status: number;
  body: T;
  link: string | null;
}

/** Something to download: a release asset, or the source at a ref as a zip or tar.gz. */
export type DownloadTarget =
  | { kind: "asset"; owner: string; repo: string; assetId: number; browserUrl: string }
  | { kind: "archive"; owner: string; repo: string; ref: string; format: "zip" | "tar" };

/** A workflow job's log (see `gh_job_logs` in src-tauri/src/github.rs). */
export interface JobLog {
  text: string;
  /** Only the end of a very long log was kept. */
  truncated: boolean;
}

export interface GraphQLErrorItem {
  message: string;
  type?: string;
  path?: (string | number)[];
}

export interface GraphQLEnvelope<T> {
  data: T;
  errors?: GraphQLErrorItem[];
}

export class ApiError extends Error {
  readonly kind: string;
  readonly status: number | null;
  readonly errors: unknown;

  constructor(message: string, kind = "api", status: number | null = null, errors: unknown = null) {
    super(message);
    this.name = "ApiError";
    this.kind = kind;
    this.status = status;
    this.errors = errors;
  }

  static from(error: unknown): ApiError {
    if (error instanceof ApiError) return error;
    if (error && typeof error === "object" && "message" in error) {
      const e = error as { message: unknown; kind?: unknown; status?: unknown; errors?: unknown };
      return new ApiError(
        String(e.message),
        typeof e.kind === "string" ? e.kind : "unknown",
        typeof e.status === "number" ? e.status : null,
        e.errors ?? null,
      );
    }
    return new ApiError(typeof error === "string" ? error : "Something went wrong", "unknown");
  }
}

export interface Backend {
  readonly native: boolean;
  sessionGet(): Promise<SessionInfo | null>;
  authConfig(): Promise<AuthConfig>;
  authSetClientId(clientId: string | null): Promise<AuthConfig>;
  authDeviceStart(): Promise<DeviceCode>;
  authDevicePoll(deviceCode: string): Promise<PollResult>;
  authWithToken(token: string): Promise<SessionInfo>;
  authLogout(): Promise<void>;
  rest<T>(request: RestRequest): Promise<RestResponse<T>>;
  graphql<T>(query: string, variables?: Record<string, unknown>): Promise<GraphQLEnvelope<T>>;
  /** Downloads a finished workflow job's log (GitHub returns 404 while it runs). */
  jobLogs(owner: string, repo: string, jobId: number): Promise<JobLog>;
  /** A short-lived link that downloads without a token (GitHub's signed redirect). */
  downloadUrl(target: DownloadTarget): Promise<string>;
  openUrl(url: string): Promise<void>;
  copyText(text: string): Promise<void>;
}

async function call<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  try {
    return await invoke<T>(command, args);
  } catch (error) {
    throw ApiError.from(error);
  }
}

const tauriBackend: Backend = {
  native: true,
  sessionGet: () => call("session_get"),
  authConfig: () => call("auth_config"),
  authSetClientId: (clientId) => call("auth_set_client_id", { clientId }),
  authDeviceStart: () => call("auth_device_start"),
  authDevicePoll: (deviceCode) => call("auth_device_poll", { deviceCode }),
  authWithToken: (token) => call("auth_with_token", { token }),
  authLogout: () => call("auth_logout"),
  rest: (request) => call("gh_rest", { request }),
  graphql: (query, variables) => call("gh_graphql", { query, variables: variables ?? {} }),
  jobLogs: (owner, repo, jobId) => call("gh_job_logs", { owner, repo, jobId }),
  downloadUrl: (target) =>
    target.kind === "asset"
      ? call("gh_asset_url", { owner: target.owner, repo: target.repo, assetId: target.assetId })
      : call("gh_archive_url", { owner: target.owner, repo: target.repo, gitRef: target.ref, format: target.format }),
  async openUrl(url) {
    // Android: a browser tab pinned to a browser. The plugin's tab below can be
    // handed to another app that claims the link, e.g. GitHub's own app for
    // github.com, which would take sign-in out of this app.
    if (url.startsWith("https://") && window.GhCommanderAndroid?.openBrowserTab(url)) return;
    const { openUrl } = await import("@tauri-apps/plugin-opener");
    // On Android this opens a Custom Tab, so users stay in the app's context.
    // Desktop builds ignore the hint and use the default browser.
    await openUrl(url, "inAppBrowser");
  },
  async copyText(text) {
    const { writeText } = await import("@tauri-apps/plugin-clipboard-manager");
    await writeText(text);
  },
};

// ---------------------------------------------------------------------------
// Browser fallback (development only)

const TOKEN_KEY = "ghc.dev.token";
const SESSION_KEY = "ghc.dev.session";
const API = "https://api.github.com";

function storage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

async function browserFetch(
  url: string,
  init: RequestInit & { accept?: string },
): Promise<Response> {
  const token = storage()?.getItem(TOKEN_KEY);
  // Like the app: without a token (guest mode), only reads.
  if (!token && (init.method ?? "GET") !== "GET") throw new ApiError("You are not signed in", "not_authenticated", 401);
  let response: Response;
  try {
    response = await fetch(url, {
      ...init,
      headers: {
        Accept: init.accept ?? "application/vnd.github+json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        "X-GitHub-Api-Version": "2022-11-28",
        ...(init.body ? { "Content-Type": "application/json" } : {}),
      },
    });
  } catch (error) {
    throw new ApiError(`Network error: ${String(error)}`, "network");
  }
  if (!response.ok) {
    let message = response.statusText || "Request failed";
    let errors: unknown = null;
    try {
      const body = await response.json();
      message = body.message ?? message;
      errors = body.errors ?? null;
    } catch {
      // not JSON
    }
    throw new ApiError(message, "api", response.status, errors);
  }
  return response;
}

function buildUrl(path: string, query?: Record<string, QueryValue>): string {
  const url = new URL(path.startsWith("https://") ? path : `${API}${path}`);
  if (url.origin !== API) throw new ApiError("Requests may only target https://api.github.com", "invalid");
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value !== null && value !== undefined) url.searchParams.append(key, String(value));
  }
  return url.toString();
}

const browserBackend: Backend = {
  native: false,
  async sessionGet() {
    const raw = storage()?.getItem(SESSION_KEY);
    return raw ? (JSON.parse(raw) as SessionInfo) : null;
  },
  async authConfig() {
    return { clientId: null, clientIdSource: null, scopes: "repo read:org notifications read:user" };
  },
  async authSetClientId() {
    throw new ApiError("OAuth settings are only available in the app", "invalid");
  },
  async authDeviceStart() {
    throw new ApiError(
      "Browser sign-in is not supported because github.com blocks cross-origin requests. Use a personal access token in the browser.",
      "auth",
    );
  },
  async authDevicePoll() {
    return { status: "expired" };
  },
  async authWithToken(token) {
    storage()?.setItem(TOKEN_KEY, token.trim());
    try {
      const response = await browserFetch(`${API}/user`, {});
      const user = await response.json();
      const session: SessionInfo = {
        login: user.login,
        name: user.name ?? null,
        avatarUrl: user.avatar_url,
        method: "token",
        scopes: response.headers.get("x-oauth-scopes"),
      };
      storage()?.setItem(SESSION_KEY, JSON.stringify(session));
      return session;
    } catch (error) {
      storage()?.removeItem(TOKEN_KEY);
      throw error;
    }
  },
  async authLogout() {
    storage()?.removeItem(TOKEN_KEY);
    storage()?.removeItem(SESSION_KEY);
  },
  async rest<T>(request: RestRequest): Promise<RestResponse<T>> {
    const response = await browserFetch(buildUrl(request.path, request.query), {
      method: request.method ?? "GET",
      body: request.body === undefined ? undefined : JSON.stringify(request.body),
      accept: request.accept,
    });
    const text = await response.text();
    const isJson = (response.headers.get("content-type") ?? "").includes("json");
    let body: unknown = null;
    if (text) {
      try {
        body = isJson ? JSON.parse(text) : text;
      } catch {
        body = text;
      }
    }
    return { status: response.status, body: body as T, link: response.headers.get("link") };
  },
  async graphql<T>(query: string, variables?: Record<string, unknown>) {
    const response = await browserFetch(`${API}/graphql`, {
      method: "POST",
      body: JSON.stringify({ query, variables: variables ?? {} }),
      accept: "application/json",
    });
    const envelope = (await response.json()) as GraphQLEnvelope<T>;
    if (!envelope.data) {
      throw new ApiError(envelope.errors?.[0]?.message ?? "GraphQL request failed", "api", 200, envelope.errors);
    }
    return envelope;
  },
  async jobLogs(owner, repo, jobId) {
    // The redirect to log storage may fail CORS in a browser; the app fetches it in Rust.
    const response = await browserFetch(`${API}/repos/${owner}/${repo}/actions/jobs/${jobId}/logs`, {});
    return { text: await response.text(), truncated: false };
  },
  async downloadUrl(target) {
    // A browser can't read GitHub's redirect (CORS); the public links work when signed in on github.com.
    if (target.kind === "asset") return target.browserUrl;
    return `https://github.com/${target.owner}/${target.repo}/archive/${target.ref}.${target.format === "zip" ? "zip" : "tar.gz"}`;
  },
  async openUrl(url) {
    window.open(url, "_blank", "noopener,noreferrer");
  },
  async copyText(text) {
    await navigator.clipboard.writeText(text);
  },
};

export const backend: Backend =
  import.meta.env.VITE_MOCK === "1" ? createMockBackend() : isTauri() ? tauriBackend : browserBackend;
