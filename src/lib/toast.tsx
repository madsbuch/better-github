import { useEffect, useState } from "react";

type ToastKind = "info" | "success" | "error";

interface Toast {
  id: number;
  message: string;
  kind: ToastKind;
}

interface ToastApi {
  show(message: string, kind?: ToastKind): void;
}

type Listener = (toasts: Toast[]) => void;

let toasts: Toast[] = [];
let nextId = 1;
const listeners = new Set<Listener>();

function publish(next: Toast[]) {
  toasts = next;
  listeners.forEach((listener) => listener(toasts));
}

function dismiss(id: number) {
  publish(toasts.filter((t) => t.id !== id));
}

/** Shows a toast from anywhere, including outside React (e.g. the mutation cache). */
export const toast: ToastApi = {
  show(message, kind = "info") {
    const id = nextId++;
    publish([...toasts.slice(-2), { id, message, kind }]);
    window.setTimeout(() => dismiss(id), kind === "error" ? 5000 : 3000);
  },
};

/** Renders the toasts; mount once near the root. */
export function Toasts() {
  const [current, setCurrent] = useState(toasts);
  useEffect(() => {
    listeners.add(setCurrent);
    return () => void listeners.delete(setCurrent);
  }, []);
  return (
    <div className="toasts" role="status" aria-live="polite">
      {current.map((t) => (
        <div key={t.id} className={`toast toast-${t.kind}`} onClick={() => dismiss(t.id)}>
          {t.message}
        </div>
      ))}
    </div>
  );
}

export function useToast(): ToastApi {
  return toast;
}
