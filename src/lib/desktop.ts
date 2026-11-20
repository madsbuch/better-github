// Mouse and keyboard. The app was built for touch; this is what a desktop
// (the macOS app, or a tablet with a keyboard) needs on top: shortcuts for
// what phones do with gestures and the system back button, the mouse's back
// and forward buttons, and names on icon buttons when the pointer rests on
// them. Hover styles are in app.css, under `@media (hover: hover)`.

import { useEffect } from "react";
import { to, useNav } from "./nav";

/** Asks the screen on top to reload its data. A screen that does cancels the event. */
export const REFRESH_EVENT = "ghc:refresh";

/** macOS (and iPadOS with a keyboard) use ⌘ where others use Ctrl. */
export function isApple(): boolean {
  return /Mac|iPhone|iPad/.test(navigator.platform);
}

export interface Shortcut {
  label: string;
  /** The keys as shown in Settings. */
  keys: (apple: boolean) => string[];
}

const mod = (apple: boolean) => (apple ? "⌘" : "Ctrl");

/** Every shortcut `useDesktopInput` handles, for the list in Settings. */
export const SHORTCUTS: Shortcut[] = [
  { label: "Search", keys: (apple) => ["/", `${mod(apple)} K`] },
  { label: "Back", keys: (apple) => (apple ? ["⌘ [", "⌥ ←"] : ["Alt ←"]) },
  { label: "Forward", keys: (apple) => (apple ? ["⌘ ]", "⌥ →"] : ["Alt →"]) },
  { label: "Refresh", keys: (apple) => [`${mod(apple)} R`] },
  { label: "Repositories", keys: (apple) => [`${mod(apple)} 1`] },
  { label: "Organizations", keys: (apple) => [`${mod(apple)} 2`] },
  { label: "Your profile", keys: (apple) => [`${mod(apple)} 3`] },
  { label: "Settings", keys: (apple) => [`${mod(apple)} ,`, `${mod(apple)} 4`] },
  { label: "Close a dialog or menu", keys: () => ["Esc"] },
  { label: "Move through a menu", keys: () => ["↑", "↓"] },
];

/** Typing somewhere: single-key shortcuts must not fire. */
function isTyping(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName));
}

/** Installs the shortcuts and mouse behavior for the whole app. Mounted once, in the shell. */
export function useDesktopInput() {
  const nav = useNav();
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing) return;
      const command = isApple() ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey;
      const plain = !event.metaKey && !event.ctrlKey && !event.altKey;
      const run = (action: () => void) => {
        event.preventDefault();
        action();
      };

      if (event.key === "Escape" && plain) {
        // A field inside a sheet gives up focus first only when there's no sheet to close.
        if (nav.closeTopSheet()) event.preventDefault();
        else if (isTyping(event.target) && event.target instanceof HTMLElement) event.target.blur();
        return;
      }
      if (command && !event.altKey && !event.shiftKey) {
        if (event.key === "k") return run(() => nav.navigate(to.search()));
        if (event.key === "[") return run(nav.back);
        if (event.key === "]") return run(nav.forward);
        if (event.key === "1") return run(() => nav.resetTo(to.repos()));
        if (event.key === "2") return run(() => nav.resetTo(to.orgs()));
        if (event.key === "3") return run(() => nav.resetTo(to.profile()));
        if (event.key === "4" || event.key === ",") return run(() => nav.resetTo(to.settings()));
        if (event.key === "r") {
          // Reloading the web view would throw away what's on screen; refresh its data instead.
          const taken = !window.dispatchEvent(new CustomEvent(REFRESH_EVENT, { cancelable: true }));
          if (taken) event.preventDefault();
          return;
        }
      }
      if (event.altKey && !event.metaKey && !event.ctrlKey && !event.shiftKey && !isTyping(event.target)) {
        if (event.key === "ArrowLeft") return run(nav.back);
        if (event.key === "ArrowRight") return run(nav.forward);
      }
      if (event.key === "/" && plain && !isTyping(event.target)) return run(() => nav.navigate(to.search()));
    };

    // The mouse's back and forward buttons.
    const onMouseUp = (event: MouseEvent) => {
      if (event.button !== 3 && event.button !== 4) return;
      event.preventDefault();
      if (event.button === 3) nav.back();
      else nav.forward();
    };

    // Icon buttons only have an accessible name; show it when the pointer rests on one.
    const onMouseOver = (event: MouseEvent) => {
      const button = event.target instanceof Element ? event.target.closest(".icon-btn[aria-label]:not([title])") : null;
      const label = button?.getAttribute("aria-label") ?? null;
      if (button && label !== null) button.setAttribute("title", label);
    };

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("mouseup", onMouseUp);
    window.addEventListener("mouseover", onMouseOver);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("mouseup", onMouseUp);
      window.removeEventListener("mouseover", onMouseOver);
    };
  }, [nav]);
}
