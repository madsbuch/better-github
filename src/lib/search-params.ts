// Validators for routes' `validateSearch`. TanStack Router JSON-parses search
// values, so `?ref=123` arrives as a number; these normalize and drop junk.

export function oneOf<T extends string>(value: unknown, allowed: readonly T[]): T | undefined {
  return allowed.includes(value as T) ? (value as T) : undefined;
}

export function optionalString(value: unknown): string | undefined {
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return typeof value === "string" && value !== "" ? value : undefined;
}

export function optionalInt(value: unknown): number | undefined {
  const n = typeof value === "string" ? Number(value) : value;
  return typeof n === "number" && Number.isSafeInteger(n) && n > 0 ? n : undefined;
}

/** For `params.parse`: a positive integer path segment, or `false` (no match). */
export function intParam(value: string): number | false {
  return /^\d{1,15}$/.test(value) && Number(value) > 0 ? Number(value) : false;
}
