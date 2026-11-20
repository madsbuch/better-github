// Small persisted UI preferences.

import { useSyncExternalStore } from "react";
import { z } from "zod";
import { parseJson } from "./schema";
import { UpdateBranchMethod } from "./types";

export const ThemePref = z.enum(["system", "light", "dark"]);
export type ThemePref = z.infer<typeof ThemePref>;

export interface Prefs {
  /** Light or dark; "system" follows the device (see theme.ts). */
  theme: ThemePref;
  wrapDiff: boolean;
  wrapCode: boolean;
  /** Old and new side by side, where the window is wide enough for two columns of code. */
  splitDiff: boolean;
  /** How "Update branch" brings in the base branch; the last one picked. */
  updateBranchMethod: UpdateBranchMethod;
}

const KEY = "ghc.prefs";
const DEFAULTS: Prefs = { theme: "system", wrapDiff: true, wrapCode: false, splitDiff: true, updateBranchMethod: "MERGE" };
const listeners = new Set<() => void>();

/**
 * Stored prefs. A pref saved by an older version that didn't have it takes its
 * default; a value of the wrong type makes the whole entry invalid, so all prefs reset.
 */
const StoredPrefs = z.object({
  theme: ThemePref.default(DEFAULTS.theme),
  wrapDiff: z.boolean().default(DEFAULTS.wrapDiff),
  wrapCode: z.boolean().default(DEFAULTS.wrapCode),
  splitDiff: z.boolean().default(DEFAULTS.splitDiff),
  updateBranchMethod: UpdateBranchMethod.default(DEFAULTS.updateBranchMethod),
});

let current: Prefs = load();

function load(): Prefs {
  try {
    return parseJson(StoredPrefs, window.localStorage.getItem(KEY)) ?? DEFAULTS;
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

/** Whether the window currently matches a media query, e.g. "(min-width: 1100px)". */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (listener) => {
      const media = matchMedia(query);
      media.addEventListener("change", listener);
      return () => media.removeEventListener("change", listener);
    },
    () => matchMedia(query).matches,
  );
}
