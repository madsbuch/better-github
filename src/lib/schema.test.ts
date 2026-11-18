import { describe, expect, it } from "vitest";
import { z } from "zod";
import { byTypename, nodes, parseJson } from "./schema";

describe("nodes", () => {
  const Label = z.object({ name: z.string() });
  const Labels = nodes(Label);

  it("drops null items", () => {
    expect(Labels.parse([null, { name: "bug" }, null, { name: "docs" }])).toEqual([{ name: "bug" }, { name: "docs" }]);
  });

  it("treats a null list as empty", () => {
    expect(Labels.parse(null)).toEqual([]);
  });

  it("still checks the items that are there", () => {
    expect(Labels.safeParse([{ name: 1 }]).success).toBe(false);
    expect(Labels.safeParse(undefined).success).toBe(false);
  });
});

describe("byTypename", () => {
  const Item = byTypename([
    z.object({ __typename: z.literal("IssueComment"), body: z.string() }),
    z.object({ __typename: z.literal("LabeledEvent"), label: z.object({ name: z.string() }) }),
  ]);

  it("parses known variants", () => {
    expect(Item.parse({ __typename: "IssueComment", body: "hi" })).toEqual({ __typename: "IssueComment", body: "hi" });
    expect(Item.parse({ __typename: "LabeledEvent", label: { name: "bug" } })).toEqual({
      __typename: "LabeledEvent",
      label: { name: "bug" },
    });
  });

  it("rejects a known __typename with the wrong fields", () => {
    expect(Item.safeParse({ __typename: "IssueComment" }).success).toBe(false);
    expect(Item.safeParse({ __typename: "IssueComment", body: 3 }).success).toBe(false);
    expect(Item.safeParse({ __typename: "LabeledEvent", body: "hi" }).success).toBe(false);
  });

  it("passes an unknown __typename through", () => {
    const parsed = Item.parse({ __typename: "SomeNewEvent", extra: 1 });
    expect(parsed.__typename).toBe("SomeNewEvent");
  });

  it("rejects values without a __typename", () => {
    expect(Item.safeParse({ body: "hi" }).success).toBe(false);
    expect(Item.safeParse(null).success).toBe(false);
  });
});

describe("parseJson", () => {
  const Session = z.object({ login: z.string() });

  it("parses JSON that matches the schema", () => {
    expect(parseJson(Session, '{"login":"octocat"}')).toEqual({ login: "octocat" });
  });

  it("returns null for missing text", () => {
    expect(parseJson(Session, null)).toBeNull();
    expect(parseJson(Session, undefined)).toBeNull();
    expect(parseJson(Session, "")).toBeNull();
  });

  it("returns null for malformed JSON", () => {
    expect(parseJson(Session, "{login:")).toBeNull();
  });

  it("returns null when the shape doesn't match", () => {
    expect(parseJson(Session, '{"login":42}')).toBeNull();
    expect(parseJson(Session, "[]")).toBeNull();
  });
});
