// Transport to the GitHub API.
//
// Inside the app every call goes through Rust commands (src-tauri/src/lib.rs),
// which hold the token and only ever talk to api.github.com. When the UI is
// opened in a plain browser during development (`npm run dev`), a fallback
// calls the API directly with a personal access token kept in localStorage.

import { invoke, isTauri } from "@tauri-apps/api/core";
import { z } from "zod";
import { createMockBackend } from "../dev/mock";
import { parseJson } from "./schema";

// What the Rust commands return (src-tauri/src), parsed on arrival.

export const AuthMethod = z.enum(["device", "token"]);
export type AuthMethod = z.infer<typeof AuthMethod>;

export const SessionInfo = z.object({
  login: z.string(),
  name: z.string().nullable(),
  avatarUrl: z.string(),
  method: AuthMethod,
  scopes: z.string().nullable(),
});
export type SessionInfo = z.infer<typeof SessionInfo>;

export const AuthConfig = z.object({
  clientId: z.string().nullable(),
  clientIdSource: z.enum(["user", "build"]).nullable(),
  scopes: z.string(),
});
export type AuthConfig = z.infer<typeof AuthConfig>;

export const DeviceCode = z.object({
  deviceCode: z.string(),
  userCode: z.string(),
  verificationUri: z.string(),
  expiresIn: z.number(),
  interval: z.number(),
});
export type DeviceCode = z.infer<typeof DeviceCode>;

export const PollResult = z.discriminatedUnion("status", [
  z.object({ status: z.literal("pending") }),
  z.object({ status: z.literal("slow_down"), interval: z.number() }),
  z.object({ status: z.literal("expired") }),
  z.object({ status: z.literal("denied") }),
  z.object({ status: z.literal("complete"), session: SessionInfo }),
]);
export type PollResult = z.infer<typeof PollResult>;

export type QueryValue = string | number | boolean | null | undefined;

export interface RestRequest {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  path: string;
  query?: Record<string, QueryValue>;
  body?: unknown;
  accept?: string;
}

/** A REST response as it crosses into the web view; `body` is parsed by the caller (src/lib/api.ts). */
export const RestResponse = z.object({ status: z.number(), body: z.unknown(), link: z.string().nullable() });
export type RestResponse = z.infer<typeof RestResponse>;

/** Something to download: a release asset, or the source at a ref as a zip or tar.gz. */
export type DownloadTarget =
  | { kind: "asset"; owner: string; repo: string; assetId: number; browserUrl: string }
  | { kind: "archive"; owner: string; repo: string; ref: string; format: "zip" | "tar" };

/** A workflow job's log (see `gh_job_logs` in src-tauri/src/github.rs). */
export const JobLog = z.object({
  text: z.string(),
  /** Only the end of a very long log was kept. */
  truncated: z.boolean(),
});
export type JobLog = z.infer<typeof JobLog>;

export const GraphQLErrorItem = z.object({
  message: z.string(),
  type: z.string().optional(),
  path: z.array(z.union([z.string(), z.number()])).optional(),
});
export type GraphQLErrorItem = z.infer<typeof GraphQLErrorItem>;

/** `data` is parsed by the caller against the document's own schema (src/lib/api.ts). */
export const GraphQLEnvelope = z.object({ data: z.unknown(), errors: z.array(GraphQLErrorItem).optional() });
export type GraphQLEnvelope = z.infer<typeof GraphQLEnvelope>;

/** The error shape Rust commands reject with (src-tauri/src/error.rs). */
const CommandError = z.object({
  message: z.string(),
  kind: z.string().optional(),
  status: z.number().nullable().optional(),
  errors: z.unknown().optional(),
});

/** GitHub's REST error body. */
const RestErrorBody = z.object({ message: z.string().optional(), errors: z.unknown().optional() });

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
    if (error instanceof Error) return new ApiError(error.message, "unknown");
    const parsed = CommandError.safeParse(error);
    if (parsed.success) {
      const e = parsed.data;
      return new ApiError(e.message, e.kind ?? "unknown", e.status ?? null, e.errors ?? null);
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
  rest(request: RestRequest): Promise<RestResponse>;
  graphql(query: string, variables?: Record<string, unknown>): Promise<GraphQLEnvelope>;
  /** Downloads a finished workflow job's log (GitHub returns 404 while it runs). */
  jobLogs(owner: string, repo: string, jobId: number): Promise<JobLog>;
  /** A short-lived link that downloads without a token (GitHub's signed redirect). */
  downloadUrl(target: DownloadTarget): Promise<string>;
  openUrl(url: string): Promise<void>;
  copyText(text: string): Promise<void>;
}

/** Calls a Rust command and parses what it returns with `schema`. */
async function call<S extends z.ZodType>(command: string, schema: S, args?: Record<string, unknown>): Promise<z.infer<S>> {
  let value: unknown;
  try {
    value = await invoke<unknown>(command, args);
  } catch (error) {
    throw ApiError.from(error);
  }
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new ApiError(`Unexpected reply from ${command}: ${z.prettifyError(parsed.error)}`, "invalid_response");
  return parsed.data;
}

const tauriBackend: Backend = {
  native: true,
  sessionGet: () => call("session_get", SessionInfo.nullable()),
  authConfig: () => call("auth_config", AuthConfig),
  authSetClientId: (clientId) => call("auth_set_client_id", AuthConfig, { clientId }),
  authDeviceStart: () => call("auth_device_start", DeviceCode),
  authDevicePoll: (deviceCode) => call("auth_device_poll", PollResult, { deviceCode }),
  authWithToken: (token) => call("auth_with_token", SessionInfo, { token }),
  authLogout: async () => {
    await call("auth_logout", z.null());
  },
  rest: (request) => call("gh_rest", RestResponse, { request }),
  graphql: (query, variables) => call("gh_graphql", GraphQLEnvelope, { query, variables: variables ?? {} }),
  jobLogs: (owner, repo, jobId) => call("gh_job_logs", JobLog, { owner, repo, jobId }),
  downloadUrl: (target) =>
    target.kind === "asset"
      ? call("gh_asset_url", z.string(), { owner: target.owner, repo: target.repo, assetId: target.assetId })
      : call("gh_archive_url", z.string(), { owner: target.owner, repo: target.repo, gitRef: target.ref, format: target.format }),
  async openUrl(url) {
    // Android: a browser tab pinned to a browser. The plugin's tab below can be
    // handed to another app that claims the link, e.g. GitHub's own app for
    // github.com, which would take sign-in out of this app.
    if (url.startsWith("https://") && window.GhCommanderAndroid?.openBrowserTab(url) === true) return;
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
  const token = storage()?.getItem(TOKEN_KEY) ?? null;
  // Like the app: without a token (guest mode), only reads.
  if (token === null && (init.method ?? "GET") !== "GET") throw new ApiError("You are not signed in", "not_authenticated", 401);
  let response: Response;
  try {
    response = await fetch(url, {
      ...init,
      headers: {
        Accept: init.accept ?? "application/vnd.github+json",
        ...(token !== null ? { Authorization: `Bearer ${token}` } : {}),
        "X-GitHub-Api-Version": "2022-11-28",
        ...(init.body !== undefined && init.body !== null ? { "Content-Type": "application/json" } : {}),
      },
    });
  } catch (error) {
    throw new ApiError(`Network error: ${String(error)}`, "network");
  }
  if (!response.ok) {
    const body = parseJson(RestErrorBody, await response.text());
    const message = body?.message ?? (response.statusText !== "" ? response.statusText : "Request failed");
    throw new ApiError(message, "api", response.status, body?.errors ?? null);
  }
  return response;
}

function buildUrl(path: string, query?: Record<string, QueryValue>): string {
  const url = new URL(path.startsWith("https://") ? path : `${API}${path}`);
  if (url.origin !== API) throw new ApiError("Requests may only target https://api.github.com", "invalid");
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value !== null && value !== undefined) url.searchParams.append(key, typeof value === "string" ? value : value.toString());
  }
  return url.toString();
}

const browserBackend: Backend = {
  native: false,
  async sessionGet() {
    return parseJson(SessionInfo, storage()?.getItem(SESSION_KEY));
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
      const user = z
        .object({ login: z.string(), name: z.string().nullable(), avatar_url: z.string() })
        .parse(await response.json());
      const session: SessionInfo = {
        login: user.login,
        name: user.name,
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
  async rest(request: RestRequest): Promise<RestResponse> {
    const response = await browserFetch(buildUrl(request.path, request.query), {
      method: request.method ?? "GET",
      ...(request.body === undefined ? {} : { body: JSON.stringify(request.body) }),
      ...(request.accept === undefined ? {} : { accept: request.accept }),
    });
    const text = await response.text();
    const isJson = (response.headers.get("content-type") ?? "").includes("json");
    let body: unknown = null;
    if (text !== "") {
      try {
        body = isJson ? JSON.parse(text) : text;
      } catch {
        body = text;
      }
    }
    return { status: response.status, body, link: response.headers.get("link") };
  },
  async graphql(query, variables) {
    const response = await browserFetch(`${API}/graphql`, {
      method: "POST",
      body: JSON.stringify({ query, variables: variables ?? {} }),
      accept: "application/json",
    });
    const envelope = GraphQLEnvelope.parse(await response.json());
    if (envelope.data === null || envelope.data === undefined) {
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
