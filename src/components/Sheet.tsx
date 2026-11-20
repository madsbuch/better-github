import { XIcon } from "@primer/octicons-react";
import { useEffect, useRef, type KeyboardEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useOverlay } from "../lib/nav";
import { hasContent } from "./ui";

interface SheetProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
  /** Use most of the screen height (editors, long lists). */
  full?: boolean | undefined;
}

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Where Tab stops inside `surface`. A group of radio buttons is one stop: the checked one, or the first. */
function tabStops(surface: HTMLElement): HTMLElement[] {
  const items = [...surface.querySelectorAll<HTMLElement>(FOCUSABLE)];
  return items.filter((item) => {
    if (!(item instanceof HTMLInputElement) || item.type !== "radio") return true;
    const group = items.filter((other) => other instanceof HTMLInputElement && other.type === "radio" && other.name === item.name);
    const stop = group.find((other) => other instanceof HTMLInputElement && other.checked) ?? group[0];
    return stop === item || item === document.activeElement;
  });
}

/**
 * Keyboard focus for a modal surface: it moves in when the surface opens
 * (to its first field or menu item, else the surface itself), Tab stays
 * inside, and it returns to where it was on close.
 */
function useModalFocus<T extends HTMLElement>(open: boolean, first: string) {
  const ref = useRef<T>(null);
  useEffect(() => {
    if (!open) return;
    const before = document.activeElement;
    const surface = ref.current;
    // A sheet that focuses a field of its own (autoFocus) keeps that.
    if (surface && !surface.contains(document.activeElement)) {
      // On a touch screen, focusing a field would raise the keyboard over the sheet just opened.
      const field = matchMedia("(hover: hover) and (pointer: fine)").matches ? surface.querySelector<HTMLElement>(first) : null;
      (field ?? surface).focus({ preventScroll: true });
    }
    // Should focus land outside anyway (a click on the page behind, say), bring it back.
    let backwards = false;
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Tab") backwards = event.shiftKey;
    };
    const onFocusIn = (event: FocusEvent) => {
      if (!surface || !(event.target instanceof Node) || surface.contains(event.target)) return;
      // A sheet opened from this one is on top now, and keeps focus itself.
      if (event.target instanceof Element && event.target.closest(".sheet") !== null) return;
      const items = tabStops(surface);
      ((backwards ? items.at(-1) : items[0]) ?? surface).focus({ preventScroll: true });
    };
    document.addEventListener("keydown", onKey, true);
    document.addEventListener("focusin", onFocusIn);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      document.removeEventListener("focusin", onFocusIn);
      if (before instanceof HTMLElement && before.isConnected) before.focus({ preventScroll: true });
    };
  }, [open, first]);

  const onKeyDown = (event: KeyboardEvent<T>) => {
    if (event.key !== "Tab") return;
    const items = tabStops(event.currentTarget);
    const [start, end] = [items[0], items.at(-1)];
    if (start === undefined || end === undefined) return;
    if (event.shiftKey && (document.activeElement === start || document.activeElement === event.currentTarget)) {
      event.preventDefault();
      end.focus();
    } else if (!event.shiftKey && document.activeElement === end) {
      event.preventDefault();
      start.focus();
    }
  };
  return { ref, onKeyDown };
}

/** Bottom sheet on phones, inset dialog on tablets and desktops. Back and Escape close either presentation. */
export function Sheet({ open, onClose, title, children, footer, full = false }: SheetProps) {
  useOverlay(open, onClose);
  const focus = useModalFocus<HTMLDivElement>(open, ".sheet-body input:not([type=checkbox]):not([type=radio]), .sheet-body textarea");
  if (!open) return null;
  return createPortal(
    <>
      <div className="sheet-backdrop" onClick={onClose} />
      <div className={`sheet${full ? " full" : ""}`} role="dialog" aria-modal="true" aria-label={title} tabIndex={-1} ref={focus.ref} onKeyDown={focus.onKeyDown}>
        <div className="sheet-handle" />
        <div className="sheet-header">
          <h2>{title}</h2>
          <button className="icon-btn sm" onClick={onClose} aria-label="Close">
            <XIcon size={18} />
          </button>
        </div>
        <div className="sheet-body">{children}</div>
        {hasContent(footer) && <div className="sheet-footer">{footer}</div>}
      </div>
    </>,
    document.body,
  );
}

export interface MenuAction {
  label: string;
  icon?: ReactNode;
  danger?: boolean | undefined;
  hidden?: boolean | undefined;
  onSelect: () => void;
}

/** A list of actions in a sheet (the app's overflow menu). */
export function ActionSheet({
  open,
  onClose,
  title,
  actions,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  actions: MenuAction[];
}) {
  useOverlay(open, onClose);
  const focus = useModalFocus<HTMLDivElement>(open, "[role=menuitem]");
  // Up and down move through the menu, wrapping at its ends.
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    focus.onKeyDown(event);
    const step = event.key === "ArrowDown" ? 1 : event.key === "ArrowUp" ? -1 : 0;
    if (step === 0) return;
    event.preventDefault();
    const items = [...event.currentTarget.querySelectorAll<HTMLElement>("[role=menuitem]")];
    const at = items.findIndex((item) => item === document.activeElement);
    items[(at + step + items.length) % items.length]?.focus();
  };
  if (!open) return null;
  return createPortal(
    <>
      <div className="sheet-backdrop" onClick={onClose} />
      <div className="sheet" role="menu" aria-label={title} tabIndex={-1} ref={focus.ref} onKeyDown={onKeyDown}>
        <div className="sheet-handle" />
        <div className="sheet-menu">
          {actions
            .filter((a) => a.hidden !== true)
            .map((action) => (
              <button
                key={action.label}
                role="menuitem"
                className={`menu-item${action.danger === true ? " danger" : ""}`}
                onClick={() => {
                  onClose();
                  action.onSelect();
                }}
              >
                {action.icon}
                {action.label}
              </button>
            ))}
        </div>
      </div>
    </>,
    document.body,
  );
}
