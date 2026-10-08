import { useQueryClient } from "@tanstack/react-query";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { onUnauthorized } from "./api";
import { backend, type SessionInfo } from "./backend";
import { useToast } from "./toast";

type SessionState =
  | { status: "loading" }
  | { status: "signed-out" }
  | { status: "signed-in"; session: SessionInfo };

interface SessionApi {
  state: SessionState;
  signedIn(session: SessionInfo): void;
  signOut(): Promise<void>;
}

const SessionContext = createContext<SessionApi | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<SessionState>({ status: "loading" });
  const queryClient = useQueryClient();
  const toast = useToast();

  useEffect(() => {
    backend
      .sessionGet()
      .then((session) => setState(session ? { status: "signed-in", session } : { status: "signed-out" }))
      .catch(() => setState({ status: "signed-out" }));
  }, []);

  const signOut = useCallback(async () => {
    try {
      await backend.authLogout();
    } finally {
      queryClient.clear();
      setState({ status: "signed-out" });
    }
  }, [queryClient]);

  useEffect(
    () =>
      onUnauthorized(() => {
        toast.show("GitHub rejected your token. Please sign in again.", "error");
        void signOut();
      }),
    [signOut, toast],
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
