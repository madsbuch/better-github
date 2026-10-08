/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** "1" swaps the GitHub backend for local fixtures (development only). */
  readonly VITE_MOCK?: string;
}
