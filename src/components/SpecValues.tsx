// Named values of a spec (src/lib/spec.ts): how each kind is shown (a swatch
// for a color, a bar for a size) and the input that fits it (a color picker, a
// number with its unit).
// Spec: S29, RW15

import { createContext, useContext, type ReactNode } from "react";
import { DIMENSION_UNITS, DURATION_UNITS, valueText, type SpecValue } from "../lib/spec";
import { pickerColor, type ValueDraft } from "../lib/specValues";
import { CodeContext } from "./ReviewRules";

/** A color, as a square of it. `label` says which mode it is for, when there are two. */
function Swatch({ color, label }: { color: string; label?: string }) {
  return (
    <span className="spec-swatch" title={label !== undefined ? `${label}: ${color}` : color}>
      <span className="spec-swatch-fill" style={{ background: color }} />
    </span>
  );
}

/** The longest a size is drawn; beyond it the bar stops and the number speaks. */
const BAR_MAX = 160;

/** A size in pixels, where its unit allows saying so; null where it depends on the surroundings. */
function pixels(value: string): number | null {
  const match = /^(-?\d+(?:\.\d+)?)(px|rem|em|pt|dp)$/.exec(value);
  if (match === null) return null;
  const amount = Number(match[1]);
  return match[2] === "rem" || match[2] === "em" ? amount * 16 : match[2] === "pt" ? (amount * 4) / 3 : amount;
}

/** What a value looks like, where it looks like something. */
export function ValuePreview({ value }: { value: Pick<SpecValue, "type" | "value"> & { dark?: string | undefined } }) {
  if (value.type === "color" && typeof value.value === "string") {
    return (
      <span className="spec-value-preview">
        <Swatch color={value.value} {...(value.dark !== undefined ? { label: "Light" } : {})} />
        {value.dark !== undefined && <Swatch color={value.dark} label="Dark" />}
      </span>
    );
  }
  if (value.type === "dimension" && typeof value.value === "string") {
    const width = pixels(value.value);
    if (width === null || width <= 0) return null;
    return (
      <span className="spec-value-preview">
        <span className="spec-size-bar" style={{ width: Math.min(width, BAR_MAX) }} data-capped={width > BAR_MAX} />
      </span>
    );
  }
  if (value.type === "font" && typeof value.value === "string") {
    return (
      <span className="spec-value-preview spec-font-sample" style={{ fontFamily: value.value }}>
        Ag
      </span>
    );
  }
  return null;
}

/** A value as it is read, with its preview: "■ #0969da", "5 times". */
export function ValueText({ value }: { value: SpecValue }) {
  if (value.type === "list") {
    return (
      <span className="spec-value-list">
        {value.value.map((entry) => (
          <span key={entry} className="spec-value-entry">
            {entry}
          </span>
        ))}
      </span>
    );
  }
  return (
    <span className="spec-value-text">
      <ValuePreview value={value} />
      <span className={value.type === "text" ? undefined : "mono"}>
        {value.type === "text" ? `“${value.value}”` : valueText(value)}
        {value.type === "color" && value.dark !== undefined && <span className="muted"> · dark {value.dark}</span>}
      </span>
    </span>
  );
}

/**
 * The named values of the spec being read, by id: text that names one in
 * backticks shows what it is next to the name.
 */
export const SpecValuesContext = createContext<ReadonlyMap<string, { value: SpecValue }> | null>(null);

/** `code` in a spec's text: when it is the id of a named value, the value comes with it. */
export function ValueCode({ code }: { code: string }): ReactNode {
  const value = useContext(SpecValuesContext)?.get(code)?.value;
  if (value === undefined) return <code>{code}</code>;
  return (
    <span className="spec-value-ref" data-value={code}>
      <code>{code}</code>
      <span className="spec-value-ref-is">
        <ValuePreview value={value} />
        {value.type === "text" ? `“${value.value}”` : valueText(value)}
      </span>
    </span>
  );
}

const asValueCode = (code: string) => <ValueCode code={code} />;

/** Around text of a spec: backticked ids of its named values show what they are. */
export function SpecValuesProvider({ values, children }: { values: ReadonlyMap<string, { value: SpecValue }>; children: ReactNode }) {
  return (
    <SpecValuesContext.Provider value={values}>
      <CodeContext.Provider value={asValueCode}>{children}</CodeContext.Provider>
    </SpecValuesContext.Provider>
  );
}

// ------------------------------------------------------------------ inputs

/** The input that fits a value's type. */
export function ValueInput({ draft, onChange }: { draft: ValueDraft; onChange: (draft: ValueDraft) => void }) {
  const set = (patch: Partial<ValueDraft>) => onChange({ ...draft, ...patch });
  switch (draft.type) {
    case "color":
      return (
        <div className="spec-value-input">
          <ColorInput label="Color" value={draft.text} onChange={(text) => set({ text })} />
          <label className="spec-value-check">
            <input type="checkbox" checked={draft.dark !== ""} onChange={(e) => set({ dark: e.target.checked ? draft.text : "" })} /> Different in dark mode
          </label>
          {draft.dark !== "" && <ColorInput label="Color in dark mode" value={draft.dark} onChange={(dark) => set({ dark })} />}
        </div>
      );
    case "dimension":
    case "duration":
      return (
        <div className="spec-value-input spec-value-row">
          <input
            className="input"
            type="number"
            inputMode="decimal"
            step="any"
            {...(draft.type === "duration" ? { min: 0 } : {})}
            aria-label={draft.type === "dimension" ? "Size" : "Time"}
            value={draft.text}
            onChange={(e) => set({ text: e.target.value })}
          />
          <select className="select" aria-label="Unit" value={draft.unit} onChange={(e) => set({ unit: e.target.value })}>
            {(draft.type === "dimension" ? DIMENSION_UNITS : DURATION_UNITS).map((unit) => (
              <option key={unit} value={unit}>
                {unit}
              </option>
            ))}
          </select>
        </div>
      );
    case "number":
      return (
        <div className="spec-value-input spec-value-row">
          <input className="input" type="number" inputMode="decimal" step="any" aria-label="Number" value={draft.text} onChange={(e) => set({ text: e.target.value })} />
          <input className="input" aria-label="What it counts (optional)" placeholder="times, MB, items…" value={draft.unit} onChange={(e) => set({ unit: e.target.value })} />
        </div>
      );
    case "list":
      return (
        <div className="spec-value-input">
          <textarea className="textarea" aria-label="Names, one per line" placeholder="One per line" value={draft.text} onChange={(e) => set({ text: e.target.value })} style={{ minHeight: 96 }} />
        </div>
      );
    case "font":
      return (
        <div className="spec-value-input">
          <input className="input" aria-label="Font family" placeholder="Inter, system-ui, sans-serif" value={draft.text} onChange={(e) => set({ text: e.target.value })} />
          {draft.text.trim() !== "" && (
            <p className="spec-font-try" style={{ fontFamily: draft.text }}>
              The quick brown fox jumps over the lazy dog. 0123456789
            </p>
          )}
        </div>
      );
    case "text":
      return (
        <div className="spec-value-input">
          <input className="input" aria-label="Wording" value={draft.text} onChange={(e) => set({ text: e.target.value })} />
        </div>
      );
  }
}

/** A color: the system's picker, and the hex next to it for typing or pasting one (and for transparency). */
function ColorInput({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <div className="spec-value-row spec-color-input">
      <input type="color" aria-label={`${label}: pick`} value={pickerColor(value)} onChange={(e) => onChange(e.target.value)} />
      <input className="input mono" aria-label={`${label}: hex`} value={value} onChange={(e) => onChange(e.target.value)} autoCapitalize="off" autoCorrect="off" spellCheck={false} maxLength={9} />
    </div>
  );
}
