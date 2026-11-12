import { QueryClientProvider } from "@tanstack/react-query";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { backend } from "./lib/backend";
import { SessionProvider } from "./lib/session";
import { initTheme } from "./lib/theme";
import { Toasts } from "./lib/toast";
import { queryClient, restoreCache } from "./queries/client";
import "./styles/theme.css";
import "./styles/app.css";
import "./styles/markdown.css";
import "./styles/code.css";

// Before anything waits, so the first frame already has the right colours.
initTheme();

// Read the stored session and the cached data before the first frame, so the
// app opens on its last screen with content instead of a spinner.
const [session] = await Promise.all([backend.sessionGet().catch(() => null), restoreCache()]);

createRoot(document.getElementById("root")!).render(
  <QueryClientProvider client={queryClient}>
    <SessionProvider initial={session}>
      <App />
    </SessionProvider>
    <Toasts />
  </QueryClientProvider>,
);
