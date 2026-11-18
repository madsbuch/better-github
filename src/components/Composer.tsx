import { PaperAirplaneIcon } from "@primer/octicons-react";
import { useEffect, useRef, useState } from "react";
import { Spinner } from "./ui";

/** Bottom-pinned comment box that grows with its content. */
export function Composer({
  value,
  onChange,
  onSubmit,
  placeholder = "Leave a comment",
}: {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => Promise<void>;
  placeholder?: string;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, [value]);

  const submit = async () => {
    if (value.trim() === "" || busy) return;
    setBusy(true);
    try {
      await onSubmit();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="composer">
      <textarea ref={ref} rows={1} placeholder={placeholder} value={value} onChange={(e) => onChange(e.target.value)} />
      <button className="icon-btn" style={{ color: "var(--accent)" }} aria-label="Send" disabled={value.trim() === "" || busy} onClick={() => void submit()}>
        {busy ? <Spinner small /> : <PaperAirplaneIcon size={20} />}
      </button>
    </div>
  );
}

/** Lets a parent focus the composer, e.g. after "Quote reply". */
export function focusComposer() {
  window.setTimeout(() => {
    const el = document.querySelector<HTMLTextAreaElement>(".screen:not(.hidden) .composer textarea");
    el?.focus();
    el?.setSelectionRange(el.value.length, el.value.length);
  }, 50);
}
