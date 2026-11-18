// Helpers for the zod schemas that every response from GitHub (and every value
// read back from storage) is parsed with before the app touches it.

import { z } from "zod";

/**
 * A GraphQL connection's `nodes`. GitHub puts `null` into `nodes` for items
 * the viewer can't see (e.g. from SAML-protected organizations) and reports
 * them as partial errors; they're dropped so lists hold only real items. The
 * schema also allows `nodes` itself to be null, which means no items.
 */
export function nodes<T extends z.ZodType>(item: T) {
  return z
    .array(item.nullable())
    .nullable()
    .transform((list) => (list ?? []).filter((node): node is NonNullable<typeof node> => node !== null));
}

type Variant = z.ZodObject<{ __typename: z.ZodLiteral<string> | z.ZodEnum }>;

function typenamesOf(variant: Variant): readonly string[] {
  const typename = variant.shape.__typename;
  return typename instanceof z.ZodLiteral ? [...typename.values].map(String) : typename.options.map(String);
}

/**
 * A GraphQL union or interface value. Known `__typename`s must match their
 * variant exactly; any other type parses as `{ __typename }` so a new kind of
 * item (say, a new timeline event) shows up as "unknown" instead of failing.
 */
export function byTypename<const V extends readonly [Variant, ...Variant[]]>(variants: V) {
  const known = new Set(variants.flatMap(typenamesOf));
  const other = z.object({ __typename: z.string().refine((name) => !known.has(name), "known __typename did not match its variant") });
  return z.union([z.discriminatedUnion("__typename", variants), other]);
}

/** Parses JSON text (from storage or a bridge) with `schema`; `null` when it is missing or doesn't match. */
export function parseJson<T extends z.ZodType>(schema: T, text: string | null | undefined): z.infer<T> | null {
  if (text === null || text === undefined || text === "") return null;
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  const result = schema.safeParse(value);
  return result.success ? result.data : null;
}

/** A GraphQL document and the schema its result is parsed with (see queries.ts). */
export interface GraphQLDocument<S extends z.ZodType> {
  readonly source: string;
  readonly result: S;
}

export function gql<S extends z.ZodType>(result: S, source: string): GraphQLDocument<S> {
  return { source, result };
}
