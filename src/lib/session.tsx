import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { clearCache } from "../queries/client";
import { onUnauthorized } from "./api";
import { backend, type SessionInfo } from "./backend";
import { toast } from "./toast";
import { clearDownloads } from "./downloads";
import { endGuest, isGuest, startGuest } from "./guest";

type SessionState = { status: "signed-out" } | { status: "guest" } | { status: "signed-in"; session: SessionInfo };

interface SessionApi {
  state: SessionState;
  signedIn(session: SessionInfo): void;
  signOut(): Promise<void>;
  /** Browse public profiles and repositories without a token. */
  browseAsGuest(): void;
  /** Leaves guest mode for the sign-in screen. */
  leaveGuest(): Promise<void>;
}

function initialState(session: SessionInfo | null): SessionState {
  if (session) {
    endGuest();
    return { status: "signed-in", session };
  }
  return isGuest() ? { status: "guest" } : { status: "signed-out" };
}

const SessionContext = createContext<SessionApi | null>(null);

/** `initial` is the stored session, read before the first render (see main.tsx). */
export function SessionProvider({ initial, children }: { initial: SessionInfo | null; children: ReactNode }) {
  const [state, setState] = useState<SessionState>(() => initialState(initial));

  const signOut = useCallback(async () => {
    try {
      await backend.authLogout();
    } finally {
      // Nothing from this account may outlive the session, on screen or on disk.
      await clearCache().catch(() => undefined);
      clearDownloads();
      setState({ status: "signed-out" });
    }
  }, []);

  const leaveGuest = useCallback(async () => {
    // Guest data was fetched without a token (no "starred" state etc.); don't mix it with an account's.
    await clearCache().catch(() => undefined);
    endGuest();
    setState({ status: "signed-out" });
  }, []);

  const browseAsGuest = useCallback(() => {
    startGuest();
    setState({ status: "guest" });
  }, []);

  useEffect(
    () =>
      onUnauthorized(() => {
        // Guests have no token to reject; screens explain that signing in is needed.
        if (isGuest()) return;
        toast.show("GitHub rejected your token. Please sign in again.", "error");
        void signOut();
      }),
    [signOut],
  );

  const api = useMemo<SessionApi>(
    () => ({
      state,
      signedIn: (session) => {
        endGuest();
        setState({ status: "signed-in", session });
      },
      signOut,
      browseAsGuest,
      leaveGuest,
    }),
    [state, signOut, browseAsGuest, leaveGuest],
  );

  return <SessionContext.Provider value={api}>{children}</SessionContext.Provider>;
}

export function useSessionApi(): SessionApi {
  const api = useContext(SessionContext);
  if (!api) throw new Error("useSessionApi must be used inside SessionProvider");
  return api;
}

/** True in guest mode. */
export function useIsGuest(): boolean {
  return useSessionApi().state.status === "guest";
}

/** The signed-in user. Only use below the signed-in app shell, never in guest mode. */
export function useViewer(): SessionInfo {
  const { state } = useSessionApi();
  if (state.status !== "signed-in") throw new Error("Not signed in");
  return state.session;
}
