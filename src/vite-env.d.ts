/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** "1" swaps the GitHub backend for local fixtures (development only). */
  readonly VITE_MOCK?: string;
}

interface Window {
  /** Added to the web view by the Android app (BrowserTabs.kt); absent elsewhere. */
  readonly GhCommanderAndroid?: { openBrowserTab(url: string): boolean };
  /** Android's download manager (Downloads.kt); absent elsewhere. */
  readonly GhCommanderDownloads?: { download(url: string, fileName: string, mimeType: string): boolean };
}

/** Identifies the build (the commit in CI); a new build starts with a fresh query cache. */
declare const __BUILD_ID__: string;
