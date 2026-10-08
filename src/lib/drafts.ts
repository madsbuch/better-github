// Pending review comments, kept per pull request until the review is
// submitted. Persisted locally so a half-finished review survives restarts.

import { useCallback, useMemo, useSyncExternalStore } from "react";
import type { Side } from "./diff";

export interface DraftComment {
  id: string;
  path: string;
  line: number;
  side: Side;
  body: string;
  createdAt: number;
}

export interface ReviewDraft {
  body: string;
  comments: DraftComment[];
}

const EMPTY: ReviewDraft = { body: "", comments: [] };
const cache = new Map<string, ReviewDraft>();
const listeners = new Map<string, Set<() => void>>();

function storageKey(key: string) {
  return `ghc.review.${key}`;
}

function read(key: string): ReviewDraft {
  const cached = cache.get(key);
  if (cached) return cached;
  let draft = EMPTY;
  try {
    const raw = window.localStorage.getItem(storageKey(key));
    if (raw) {
      const parsed = JSON.parse(raw) as ReviewDraft;
      draft = { body: parsed.body ?? "", comments: Array.isArray(parsed.comments) ? parsed.comments : [] };
    }
  } catch {
    // Storage unavailable or corrupt: start empty.
  }
  cache.set(key, draft);
  return draft;
}

function write(key: string, draft: ReviewDraft) {
  cache.set(key, draft);
  try {
    if (!draft.body && draft.comments.length === 0) window.localStorage.removeItem(storageKey(key));
    else window.localStorage.setItem(storageKey(key), JSON.stringify(draft));
  } catch {
    // Keep the in-memory copy.
  }
  listeners.get(key)?.forEach((listener) => listener());
}

export function draftKey(owner: string, repo: string, number: number | string) {
  return `${owner}/${repo}#${number}`.toLowerCase();
}

let counter = 0;

export function useReviewDraft(key: string) {
  const subscribe = useCallback(
    (listener: () => void) => {
      let set = listeners.get(key);
      if (!set) listeners.set(key, (set = new Set()));
      set.add(listener);
      return () => set!.delete(listener);
    },
    [key],
  );
  const draft = useSyncExternalStore(subscribe, () => read(key));

  return useMemo(
    () => ({
      draft,
      setBody: (body: string) => write(key, { ...read(key), body }),
      addComment: (comment: Omit<DraftComment, "id" | "createdAt">) =>
        write(key, {
          ...read(key),
          comments: [...read(key).comments, { ...comment, id: `d${Date.now()}-${counter++}`, createdAt: Date.now() }],
        }),
      updateComment: (id: string, body: string) =>
        write(key, { ...read(key), comments: read(key).comments.map((c) => (c.id === id ? { ...c, body } : c)) }),
      removeComment: (id: string) =>
        write(key, { ...read(key), comments: read(key).comments.filter((c) => c.id !== id) }),
      clear: () => write(key, EMPTY),
    }),
    [draft, key],
  );
}
