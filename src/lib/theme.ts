// Light or dark: picks the theme and puts it on <html> as data-theme, which the
// stylesheets key off (src/styles/theme.css).
//
// "System" follows the device. On Android that comes from the app itself
// (Theme.kt) rather than the web view's prefers-color-scheme, which isn't
// reliable there and doesn't change while the app is open; the app also fires
// SYSTEM_THEME_EVENT when the device switches. Elsewhere it's the media query.
// Spec: SET-7, SET-8, DS-C2

import { getPref, subscribePrefs, type ThemePref } from "./prefs";

/** Fired on window by the Android app when the device's dark theme setting changes. */
export const SYSTEM_THEME_EVENT = "ghc:systemtheme";

const media = typeof matchMedia === "function" ? matchMedia("(prefers-color-scheme: dark)") : null;

function systemDark(): boolean {
  const android = window.GhCommanderTheme;
  if (android) {
    try {
      return android.systemDark();
    } catch {
      // Fall back to the web view's opinion.
    }
  }
  return media?.matches ?? false;
}

export function resolveTheme(pref: ThemePref, systemIsDark: boolean): "light" | "dark" {
  if (pref === "system") return systemIsDark ? "dark" : "light";
  return pref;
}

let applied: "light" | "dark" | null = null;

/**
 * Puts the theme on the page. A switch (not the first paint) cross-fades from
 * the old colors to the new ones, unless the device asks for less motion.
 */
function paint(theme: "light" | "dark", animate: boolean) {
  const set = () => {
    document.documentElement.dataset.theme = theme;
  };
  const calm = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (!animate || calm) return set();
  // The browser takes a picture of the page, changes it, and fades between the two.
  if (typeof document.startViewTransition === "function") {
    document.startViewTransition(set);
    return;
  }
  // Older web views: let every color ease to its new value instead.
  const root = document.documentElement;
  root.classList.add("theme-switching");
  set();
  window.setTimeout(() => root.classList.remove("theme-switching"), THEME_FADE_MS + 50);
}

/** How long a theme switch takes; app.css uses the same. */
const THEME_FADE_MS = 280;

function apply() {
  const theme = resolveTheme(getPref("theme"), systemDark());
  if (theme === applied) return;
  const first = applied === null;
  applied = theme;
  paint(theme, !first);
  // Colours the status and navigation bar areas to match.
  try {
    window.GhCommanderTheme?.apply(theme === "dark");
  } catch {
    // Cosmetic only.
  }
}

/** Applies the theme now (before the first render) and keeps it up to date. */
export function initTheme() {
  apply();
  media?.addEventListener("change", apply);
  window.addEventListener(SYSTEM_THEME_EVENT, apply);
  subscribePrefs(apply);
}
