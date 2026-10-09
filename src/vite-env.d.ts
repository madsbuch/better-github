/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** "1" swaps the GitHub backend for local fixtures (development only). */
  readonly VITE_MOCK?: string;
}

interface Window {
  /** Added to the web view by the Android app (BrowserTabs.kt); absent elsewhere. */
  readonly GhCommanderAndroid?: { openBrowserTab(url: string): boolean };
}
