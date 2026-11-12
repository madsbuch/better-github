// Small persisted UI preferences.

import { useSyncExternalStore } from "react";
import type { UpdateBranchMethod } from "./types";

export type ThemePref = "system" | "light" | "dark";

export interface Prefs {
  /** Light or dark; "system" follows the device (see theme.ts). */
  theme: ThemePref;
  wrapDiff: boolean;
  wrapCode: boolean;
  /** How "Update branch" brings in the base branch; the last one picked. */
  updateBranchMethod: UpdateBranchMethod;
}

const KEY = "ghc.prefs";
const DEFAULTS: Prefs = { theme: "system", wrapDiff: true, wrapCode: false, updateBranchMethod: "MERGE" };
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

export function getPref<K extends keyof Prefs>(key: K): Prefs[K] {
  return current[key];
}

export function subscribePrefs(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function usePrefs(): Prefs {
  return useSyncExternalStore(subscribePrefs, () => current);
}
