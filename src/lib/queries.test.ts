import { schema as githubSchema } from "@octokit/graphql-schema";
import { buildClientSchema, parse, validate } from "graphql";
import { describe, expect, it } from "vitest";
import { ALL_DOCUMENTS } from "./queries";

describe("GraphQL documents", () => {
  // GitHub's public GraphQL schema, published by Octokit. It trips some of
  // graphql-js's stricter schema-shape rules (deprecation inheritance), which
  // are irrelevant for validating documents, so skip schema self-validation.
  const introspection = githubSchema.json;
  const schema = buildClientSchema(introspection.data ?? introspection, { assumeValid: true });

  for (const [name, source] of Object.entries(ALL_DOCUMENTS)) {
    it(`${name} is valid against GitHub's schema`, () => {
      const errors = validate(schema, parse(source)).map((e) => e.message);
      expect(errors).toEqual([]);
    });
  }
});
