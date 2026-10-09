import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { clearCache } from "../queries/client";
import { onUnauthorized } from "./api";
import { backend, type SessionInfo } from "./backend";
import { toast } from "./toast";

type SessionState = { status: "signed-out" } | { status: "signed-in"; session: SessionInfo };

interface SessionApi {
  state: SessionState;
  signedIn(session: SessionInfo): void;
  signOut(): Promise<void>;
}

const SessionContext = createContext<SessionApi | null>(null);

/** `initial` is the stored session, read before the first render (see main.tsx). */
export function SessionProvider({ initial, children }: { initial: SessionInfo | null; children: ReactNode }) {
  const [state, setState] = useState<SessionState>(initial ? { status: "signed-in", session: initial } : { status: "signed-out" });

  const signOut = useCallback(async () => {
    try {
      await backend.authLogout();
    } finally {
      // Nothing from this account may outlive the session, on screen or on disk.
      await clearCache().catch(() => undefined);
      setState({ status: "signed-out" });
    }
  }, []);

  useEffect(
    () =>
      onUnauthorized(() => {
        toast.show("GitHub rejected your token. Please sign in again.", "error");
        void signOut();
      }),
    [signOut],
  );

  const api = useMemo<SessionApi>(
    () => ({
      state,
      signedIn: (session) => setState({ status: "signed-in", session }),
      signOut,
    }),
    [state, signOut],
  );

  return <SessionContext.Provider value={api}>{children}</SessionContext.Provider>;
}

export function useSessionApi(): SessionApi {
  const api = useContext(SessionContext);
  if (!api) throw new Error("useSessionApi must be used inside SessionProvider");
  return api;
}

/** The signed-in user. Only use below the signed-in app shell. */
export function useViewer(): SessionInfo {
  const { state } = useSessionApi();
  if (state.status !== "signed-in") throw new Error("Not signed in");
  return state.session;
}
