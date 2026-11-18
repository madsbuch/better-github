import { schema as githubSchema } from "@octokit/graphql-schema";
import {
  buildSchema,
  getNamedType,
  isAbstractType,
  isEnumType,
  isListType,
  isNonNullType,
  isObjectType,
  Kind,
  parse,
  validate,
  type DocumentNode,
  type FragmentDefinitionNode,
  type GraphQLNamedType,
  type GraphQLObjectType,
  type GraphQLOutputType,
  type SelectionNode,
} from "graphql";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { ALL_DOCUMENTS } from "./queries";
import { byTypename, gql, nodes } from "./schema";

// GitHub's public GraphQL schema, published by Octokit. It trips some of
// graphql-js's stricter schema-shape rules (deprecation inheritance), which
// are irrelevant for validating documents, so skip schema self-validation.
const schema = buildSchema(githubSchema.idl, { assumeValid: true, assumeValidSDL: true });

describe("GraphQL documents", () => {
  for (const [name, document] of Object.entries(ALL_DOCUMENTS)) {
    it(`${name} is valid against GitHub's schema`, () => {
      const errors = validate(schema, parse(document.source)).map((e) => e.message);
      expect(errors).toEqual([]);
    });

    it(`${name}'s result schema fits what the document selects`, () => {
      const problems = checkResultSchema(document.source, document.result);
      if (problems.length > 0) console.log(`PROBLEMS ${name}:\n  ${problems.join("\n  ")}`);
      expect(problems).toEqual([]);
    });
  }
});

describe("the result schema check", () => {
  const source = /* GraphQL */ `
    query Check($owner: String!, $name: String!) {
      repository(owner: $owner, name: $name) { description stargazerCount viewerPermission }
    }
  `;

  it("accepts a schema that matches", () => {
    const ok = z.object({
      repository: z
        .object({
          description: z.string().nullable(),
          stargazerCount: z.number(),
          viewerPermission: z.enum(["ADMIN", "MAINTAIN", "WRITE", "TRIAGE", "READ"]).nullable(),
        })
        .nullable(),
    });
    expect(checkResultSchema(source, ok)).toEqual([]);
  });

  it("catches nullable fields, unselected fields, wrong scalars and missing enum values", () => {
    const wrong = z.object({
      repository: z.object({
        description: z.string(),
        stargazerCount: z.string(),
        viewerPermission: z.enum(["ADMIN", "WRITE"]).nullable(),
        forkCount: z.number(),
      }),
    });
    expect(checkResultSchema(source, wrong)).toEqual([
      "repository: GitHub may return null here",
      "repository.description: GitHub may return null here",
      "repository.stargazerCount: GitHub sends Int, the schema expects ZodString",
      "repository.viewerPermission: the schema is missing enum values MAINTAIN, READ, TRIAGE",
      "repository.forkCount: required by the schema but not selected (on Repository)",
    ]);
  });

  it("checks each __typename variant against its own selections", () => {
    const search = /* GraphQL */ `
      query Check {
        search(query: "x", type: ISSUE, first: 1) {
          nodes { __typename ... on Issue { number } }
        }
      }
    `;
    const issues = byTypename([z.object({ __typename: z.literal("Issue"), number: z.number() })]);
    const pulls = byTypename([z.object({ __typename: z.literal("PullRequest"), number: z.number() })]);
    expect(checkResultSchema(search, z.object({ search: z.object({ nodes: nodes(issues) }) }))).toEqual([]);
    expect(checkResultSchema(search, z.object({ search: z.object({ nodes: nodes(pulls) }) }))).toEqual([
      "search.nodes[].number: required by the schema but not selected (on PullRequest)",
    ]);
    expect(gql(z.object({}), search).source).toBe(search);
  });
});

// ---------------------------------------------------------------------------
// Walks a document's selections alongside its zod schema and GitHub's schema.

function checkResultSchema(source: string, result: z.core.$ZodType): string[] {
  const document = parse(source);
  const fragments = fragmentsOf(document);
  const operation = document.definitions.find((d) => d.kind === Kind.OPERATION_DEFINITION);
  if (operation === undefined) return ["no operation"];
  const root = operation.operation === "mutation" ? schema.getMutationType() : schema.getQueryType();
  if (!root) return ["no root type"];
  const problems: string[] = [];
  checkComposite("", root, [...operation.selectionSet.selections], result, fragments, problems);
  return problems;
}

function fragmentsOf(document: DocumentNode): Map<string, FragmentDefinitionNode> {
  const map = new Map<string, FragmentDefinitionNode>();
  for (const definition of document.definitions) {
    if (definition.kind === Kind.FRAGMENT_DEFINITION) map.set(definition.name.value, definition);
  }
  return map;
}

/** Strips transforms (like `nodes()`'s null filter) to the schema that sees GitHub's raw value. */
function inputSide(type: z.core.$ZodType): z.core.$ZodType {
  return type instanceof z.ZodPipe ? inputSide(type.in) : type;
}

function acceptsNull(type: z.core.$ZodType): boolean {
  const t = inputSide(type);
  if (t instanceof z.ZodNullable || t instanceof z.ZodNull) return true;
  if (t instanceof z.ZodOptional) return acceptsNull(t.unwrap());
  if (t instanceof z.ZodUnion) return t.options.some(acceptsNull);
  return false;
}

function acceptsUndefined(type: z.core.$ZodType): boolean {
  const t = inputSide(type);
  if (t instanceof z.ZodOptional) return true;
  if (t instanceof z.ZodNullable) return acceptsUndefined(t.unwrap());
  return false;
}

function core(type: z.core.$ZodType): z.core.$ZodType {
  const t = inputSide(type);
  if (t instanceof z.ZodNullable || t instanceof z.ZodOptional) return core(t.unwrap());
  return t;
}

function checkValue(
  path: string,
  gqlType: GraphQLOutputType,
  selections: SelectionNode[],
  zodType: z.core.$ZodType,
  fragments: Map<string, FragmentDefinitionNode>,
  problems: string[],
): void {
  if (!isNonNullType(gqlType) && !acceptsNull(zodType)) problems.push(`${path}: GitHub may return null here`);
  const inner = isNonNullType(gqlType) ? gqlType.ofType : gqlType;
  const t = core(zodType);
  if (isListType(inner)) {
    if (!(t instanceof z.ZodArray)) {
      problems.push(`${path}: GitHub sends a list, the schema expects ${t.constructor.name}`);
      return;
    }
    checkValue(`${path}[]`, inner.ofType, selections, t.element, fragments, problems);
    return;
  }
  const named = getNamedType(inner);
  if (isObjectType(named) || isAbstractType(named)) {
    checkComposite(path, named, selections, zodType, fragments, problems);
    return;
  }
  checkLeaf(path, named, t, problems);
}

function checkLeaf(path: string, named: GraphQLNamedType, t: z.core.$ZodType, problems: string[]): void {
  if (isEnumType(named)) {
    if (t instanceof z.ZodString) return;
    if (!(t instanceof z.ZodEnum)) {
      problems.push(`${path}: GitHub sends ${named.name}, the schema expects ${t.constructor.name}`);
      return;
    }
    const known = new Set(t.options.map(String));
    const missing = named.getValues().filter((v) => !known.has(v.name)).map((v) => v.name);
    if (missing.length > 0) problems.push(`${path}: the schema is missing enum values ${missing.join(", ")}`);
    return;
  }
  const expected =
    named.name === "Int" || named.name === "Float" ? z.ZodNumber : named.name === "Boolean" ? z.ZodBoolean : z.ZodString;
  if (!(t instanceof expected)) problems.push(`${path}: GitHub sends ${named.name}, the schema expects ${t.constructor.name}`);
}

/** The object variants of a schema, flattening unions (`byTypename`, discriminated unions). */
function variantsOf(type: z.core.$ZodType): z.ZodObject[] {
  const t = core(type);
  if (t instanceof z.ZodObject) return [t];
  if (t instanceof z.ZodUnion) return t.options.flatMap((option) => variantsOf(option));
  return [];
}

function shapeOf(object: z.ZodObject): Map<string, z.core.$ZodType> {
  const shape: z.core.$ZodShape = object.shape;
  return new Map(Object.entries(shape));
}

/** The `__typename`s a variant claims; `null` for a catch-all (`__typename: z.string()`). */
function typenamesOf(variant: z.ZodObject): string[] | null {
  const typename = shapeOf(variant).get("__typename");
  if (typename === undefined) return null;
  const t = core(typename);
  if (t instanceof z.ZodLiteral) return [...t.values].map(String);
  if (t instanceof z.ZodEnum) return t.options.map(String);
  return null;
}

function checkComposite(
  path: string,
  named: GraphQLObjectType | GraphQLNamedType,
  selections: SelectionNode[],
  zodType: z.core.$ZodType,
  fragments: Map<string, FragmentDefinitionNode>,
  problems: string[],
): void {
  const possible: readonly GraphQLObjectType[] = isAbstractType(named)
    ? schema.getPossibleTypes(named)
    : isObjectType(named)
      ? [named]
      : [];
  const variants = variantsOf(zodType);
  if (variants.length === 0) {
    problems.push(`${path}: GitHub sends ${named.name}, the schema expects ${core(zodType).constructor.name}`);
    return;
  }
  const claimed = new Set<string>();
  for (const variant of variants) {
    const names = variants.length > 1 ? typenamesOf(variant) : null;
    if (names === null) continue;
    for (const name of names) {
      const type = possible.find((p) => p.name === name);
      if (!type) problems.push(`${path}: the schema has a variant for ${name}, which can't appear here`);
      else {
        claimed.add(name);
        checkFields(path, type, selections, variant, fragments, problems);
      }
    }
  }
  // A single object (no variants) or a catch-all variant: its fields must hold for every remaining type.
  const rest = possible.filter((p) => !claimed.has(p.name));
  for (const variant of variants) {
    if (variants.length > 1 && typenamesOf(variant) !== null) continue;
    for (const type of rest) checkFields(path, type, selections, variant, fragments, problems);
  }
}

function checkFields(
  path: string,
  type: GraphQLObjectType,
  selections: SelectionNode[],
  variant: z.ZodObject,
  fragments: Map<string, FragmentDefinitionNode>,
  problems: string[],
): void {
  const fields = collectFields(type, selections, fragments);
  for (const [key, zodField] of shapeOf(variant)) {
    const fieldPath = path === "" ? key : `${path}.${key}`;
    const selected = fields.get(key);
    if (!selected) {
      if (!acceptsUndefined(zodField)) problems.push(`${fieldPath}: required by the schema but not selected (on ${type.name})`);
      continue;
    }
    if (selected.name === "__typename") {
      const names = typenamesOf(z.object({ __typename: zodField }));
      if (names !== null && !names.includes(type.name)) problems.push(`${fieldPath}: the schema doesn't allow ${type.name}`);
      continue;
    }
    const definition = type.getFields()[selected.name];
    if (!definition) {
      problems.push(`${fieldPath}: ${type.name} has no field ${selected.name}`);
      continue;
    }
    checkValue(fieldPath, definition.type, selected.selections, zodField, fragments, problems);
  }
}

/** The fields a selection set yields for one concrete type, keyed by response key (alias or name). */
function collectFields(
  type: GraphQLObjectType,
  selections: readonly SelectionNode[],
  fragments: Map<string, FragmentDefinitionNode>,
  into = new Map<string, { name: string; selections: SelectionNode[] }>(),
): Map<string, { name: string; selections: SelectionNode[] }> {
  for (const selection of selections) {
    if (selection.kind === Kind.FIELD) {
      const key = selection.alias?.value ?? selection.name.value;
      const entry = into.get(key) ?? { name: selection.name.value, selections: [] };
      entry.selections.push(...(selection.selectionSet?.selections ?? []));
      into.set(key, entry);
    } else if (selection.kind === Kind.INLINE_FRAGMENT) {
      if (appliesTo(selection.typeCondition?.name.value, type)) collectFields(type, selection.selectionSet.selections, fragments, into);
    } else {
      const fragment = fragments.get(selection.name.value);
      if (fragment && appliesTo(fragment.typeCondition.name.value, type)) {
        collectFields(type, fragment.selectionSet.selections, fragments, into);
      }
    }
  }
  return into;
}

function appliesTo(condition: string | undefined, type: GraphQLObjectType): boolean {
  if (condition === undefined || condition === type.name) return true;
  const conditionType = schema.getType(condition);
  return conditionType !== undefined && isAbstractType(conditionType) && schema.isSubType(conditionType, type);
}
