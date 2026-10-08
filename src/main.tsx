import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { ApiError } from "./lib/api";
import { SessionProvider } from "./lib/session";
import { ToastProvider } from "./lib/toast";
import "./styles/theme.css";
import "./styles/app.css";
import "./styles/markdown.css";
import "./styles/code.css";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      gcTime: 30 * 60_000,
      refetchOnWindowFocus: true,
      retry: (failureCount, error) => {
        const status = ApiError.from(error).status;
        // Client errors (404, 403, 422...) won't fix themselves.
        if (status !== null && status >= 400 && status < 500) return false;
        return failureCount < 2;
      },
    },
    mutations: { retry: false },
  },
});

createRoot(document.getElementById("root")!).render(
  <QueryClientProvider client={queryClient}>
    <ToastProvider>
      <SessionProvider>
        <App />
      </SessionProvider>
    </ToastProvider>
  </QueryClientProvider>,
);
