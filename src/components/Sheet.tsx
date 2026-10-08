import { XIcon } from "@primer/octicons-react";
import type { ReactNode } from "react";
import { createPortal } from "react-dom";
import { useOverlay } from "../lib/router";

interface SheetProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
  /** Use most of the screen height (editors, long lists). */
  full?: boolean;
}

/** Bottom sheet. Registered with the router so the back button closes it. */
export function Sheet({ open, onClose, title, children, footer, full = false }: SheetProps) {
  useOverlay(open, onClose);
  if (!open) return null;
  return createPortal(
    <>
      <div className="sheet-backdrop" onClick={onClose} />
      <div className={`sheet${full ? " full" : ""}`} role="dialog" aria-modal="true" aria-label={title}>
        <div className="sheet-handle" />
        <div className="sheet-header">
          <h2>{title}</h2>
          <button className="icon-btn sm" onClick={onClose} aria-label="Close">
            <XIcon size={18} />
          </button>
        </div>
        <div className="sheet-body">{children}</div>
        {footer && <div className="sheet-footer">{footer}</div>}
      </div>
    </>,
    document.body,
  );
}

export interface MenuAction {
  label: string;
  icon?: ReactNode;
  danger?: boolean;
  hidden?: boolean;
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
  if (!open) return null;
  return createPortal(
    <>
      <div className="sheet-backdrop" onClick={onClose} />
      <div className="sheet" role="menu" aria-label={title}>
        <div className="sheet-handle" />
        <div style={{ padding: "6px 0 10px" }}>
          {actions
            .filter((a) => !a.hidden)
            .map((action) => (
              <button
                key={action.label}
                role="menuitem"
                className={`menu-item${action.danger ? " danger" : ""}`}
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
