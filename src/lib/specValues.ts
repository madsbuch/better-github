// Editing a named value of a spec (src/lib/spec.ts): what the form holds while
// it is being typed, and the value that makes, if it is one.

import { DIMENSION_UNITS, DURATION_UNITS, SpecValue, type SpecValueType } from "./spec.ts";

/** A value as a form holds it: everything is text until it is saved. */
export interface ValueDraft {
  type: SpecValueType;
  /** The value itself; for a dimension or a duration, the number without its unit; for a list, one entry per line. */
  text: string;
  /** The unit of a dimension or a duration, or what a number counts. */
  unit: string;
  /** A color's dark-mode value; empty when it is the same in both. */
  dark: string;
}

export const VALUE_TYPE_LABEL: Record<SpecValueType, string> = {
  color: "Color",
  dimension: "Size",
  duration: "Time",
  number: "Number",
  text: "Wording",
  font: "Font",
  list: "List of names",
};

/** What a new value of a type starts as. */
export function emptyDraft(type: SpecValueType): ValueDraft {
  return { type, text: type === "color" ? "#0969da" : "", unit: type === "dimension" ? "px" : type === "duration" ? "ms" : "", dark: "" };
}

const splitUnit = (value: string, units: readonly string[]): { text: string; unit: string } => {
  // Longest first: "min" before "m", "ms" before "s".
  const unit = [...units].sort((a, b) => b.length - a.length).find((candidate) => value.endsWith(candidate)) ?? "";
  return { text: value.slice(0, value.length - unit.length), unit };
};

export function draftOf(value: SpecValue): ValueDraft {
  switch (value.type) {
    case "color":
      return { type: value.type, text: value.value, unit: "", dark: value.dark ?? "" };
    case "dimension":
      return { type: value.type, ...splitUnit(value.value, DIMENSION_UNITS), dark: "" };
    case "duration":
      return { type: value.type, ...splitUnit(value.value, DURATION_UNITS), dark: "" };
    case "number":
      return { type: value.type, text: value.value.toString(), unit: value.unit ?? "", dark: "" };
    case "list":
      return { type: value.type, text: value.value.join("\n"), unit: "", dark: "" };
    case "text":
    case "font":
      return { type: value.type, text: value.value, unit: "", dark: "" };
  }
}

/** The value a draft makes, with `rest` (its id, description and record); null while it isn't one yet. */
export function valueOf(draft: ValueDraft, rest: { id: string; description?: string | undefined }): SpecValue | null {
  const text = draft.text.trim();
  const common = { id: rest.id, ...(rest.description !== undefined && rest.description.trim() !== "" ? { description: rest.description.trim() } : {}) };
  const made = ((): unknown => {
    switch (draft.type) {
      case "color":
        return { ...common, type: draft.type, value: text.toLowerCase(), ...(draft.dark.trim() !== "" ? { dark: draft.dark.trim().toLowerCase() } : {}) };
      case "dimension":
      case "duration":
        return { ...common, type: draft.type, value: `${text}${draft.unit}` };
      case "number":
        return { ...common, type: draft.type, value: text === "" ? null : Number(text), ...(draft.unit.trim() !== "" ? { unit: draft.unit.trim() } : {}) };
      case "list":
        return {
          ...common,
          type: draft.type,
          value: draft.text
            .split("\n")
            .map((entry) => entry.trim())
            .filter((entry) => entry !== ""),
        };
      case "text":
      case "font":
        return { ...common, type: draft.type, value: draft.type === "text" ? draft.text : text };
    }
  })();
  const parsed = SpecValue.safeParse(made);
  if (!parsed.success) return null;
  // A list of nothing, and wording of nothing, say nothing.
  if (Array.isArray(parsed.data.value) ? parsed.data.value.length === 0 : parsed.data.value === "") return null;
  return parsed.data;
}

/** A color as the six-digit hex a color picker takes; transparency is left to the text field. */
export const pickerColor = (hex: string) => (/^#[0-9a-fA-F]{6}/.test(hex) ? hex.slice(0, 7).toLowerCase() : "#000000");
