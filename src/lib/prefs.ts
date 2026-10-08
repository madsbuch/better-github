// Small persisted UI preferences.

import { useSyncExternalStore } from "react";

export interface Prefs {
  wrapDiff: boolean;
  wrapCode: boolean;
}

const KEY = "ghc.prefs";
const DEFAULTS: Prefs = { wrapDiff: true, wrapCode: false };
const listeners = new Set<() => void>();

let current: Prefs = load();

function load(): Prefs {
  try {
    const raw = window.localStorage.getItem(KEY);
    return raw ? { ...DEFAULTS, ...(JSON.parse(raw) as Partial<Prefs>) } : DEFAULTS;
  } catch {
    return DEFAULTS;
  }
}

export function setPref<K extends keyof Prefs>(key: K, value: Prefs[K]) {
  current = { ...current, [key]: value };
  try {
    window.localStorage.setItem(KEY, JSON.stringify(current));
  } catch {
    // In-memory only.
  }
  listeners.forEach((l) => l());
}

export function usePrefs(): Prefs {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => current,
  );
}
