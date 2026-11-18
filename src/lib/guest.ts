// Guest mode: browsing public data without signing in.
//
// Guests pick the GitHub profiles (users or organizations) they follow; the
// app lists those profiles' public repositories. Everything goes through
// REST, which GitHub serves without a token (GraphQL needs one), at 60
// requests an hour, so guest screens load only what they show.

import { useSyncExternalStore } from "react";
import { z } from "zod";
import { parseJson } from "./schema";

interface GuestState {
  /** Logins, in the order they were added. */
  profiles: string[];
}

/** What's stored; anything else reads as not a guest. */
const StoredGuest = z.object({ profiles: z.array(z.string()) });

const KEY = "ghc.guest";
const listeners = new Set<() => void>();

let current: GuestState | null = load();

function load(): GuestState | null {
  try {
    return parseJson(StoredGuest, window.localStorage.getItem(KEY));
  } catch {
    return null;
  }
}

function save(next: GuestState | null) {
  current = next;
  try {
    if (next !== null) window.localStorage.setItem(KEY, JSON.stringify(next));
    else window.localStorage.removeItem(KEY);
  } catch {
    // In-memory only.
  }
  listeners.forEach((l) => l());
}

/** True while the app runs without a token. Query functions read it to pick REST over GraphQL. */
export function isGuest(): boolean {
  return current !== null;
}

export function guestProfiles(): string[] {
  return current?.profiles ?? [];
}

export function startGuest() {
  if (current === null) save({ profiles: [] });
}

export function endGuest() {
  save(null);
}

/** GitHub's rules for user and organization names. */
export function isValidLogin(login: string): boolean {
  return /^[a-z\d](?:[a-z\d]|-(?=[a-z\d])){0,38}$/i.test(login);
}

/** Adds a profile (case-insensitively unique); returns false if it was already there. */
export function addProfile(login: string): boolean {
  const state = current ?? { profiles: [] };
  if (state.profiles.some((p) => p.toLowerCase() === login.toLowerCase())) return false;
  save({ profiles: [...state.profiles, login] });
  return true;
}

export function removeProfile(login: string) {
  if (current === null) return;
  save({ profiles: current.profiles.filter((p) => p.toLowerCase() !== login.toLowerCase()) });
}

const EMPTY: string[] = [];

export function useGuestProfiles(): string[] {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => current?.profiles ?? EMPTY,
  );
}
