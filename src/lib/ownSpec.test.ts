// This repository's own spec (.spec): that the product follows the values it decides.

import { describe, expect, it } from "vitest";
import { buildSpec, type SpecFile, type SpecValue } from "./spec";

// Vite reads these at build time, as text.
const sources = import.meta.glob<string>(
  ["../styles/theme.css", "../styles/app.css", "../components/DiffView.tsx", "../components/SpecChanges.tsx", "../queries/spec.ts", "../screens/SpecScreen.tsx", "../screens/SpecDiffScreen.tsx", "./theme.ts"],
  { query: "?raw", import: "default", eager: true },
);
const source = (path: string) => sources[path] ?? "";
const [themeCss, appCss, diffView, specChanges] = [source("../styles/theme.css"), source("../styles/app.css"), source("../components/DiffView.tsx"), source("../components/SpecChanges.tsx")];
const [specQueries, specScreen, specDiffScreen, themeCode] = [source("../queries/spec.ts"), source("../screens/SpecScreen.tsx"), source("../screens/SpecDiffScreen.tsx"), source("./theme.ts")];

const items = import.meta.glob<string>("../../.spec/**/*.json", { query: "?raw", import: "default", eager: true });
const all = import.meta.glob("../../.spec/**/*");
const inSpec = (path: string) => path.replace("../../.spec/", "");

const spec = buildSpec(
  Object.keys(all).map((path): SpecFile => {
    const text = items[path];
    return text !== undefined ? { path: inSpec(path), text, truncated: false } : { path: inSpec(path), text: null, truncated: false, oid: "asset" };
  }),
);

/** A CSS color as the hex the spec holds: "#fff8c5", or with transparency "#388bfd26". */
function hex(css: string): string {
  const rgba = /^rgba\((\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\)$/.exec(css);
  if (rgba === null) return css.toLowerCase();
  const byte = (value: number) => value.toString(16).padStart(2, "0");
  return `#${byte(Number(rgba[1]))}${byte(Number(rgba[2]))}${byte(Number(rgba[3]))}${byte(Math.round(Number(rgba[4]) * 255))}`;
}

/** The custom properties a block of the stylesheet sets. */
function properties(block: string): Map<string, string> {
  return new Map([...block.matchAll(/--([a-z-]+):\s*([^;]+);/g)].map((match) => [match[1] ?? "", (match[2] ?? "").replace(/\s+/g, " ").trim()]));
}

const theme = themeCss;
const split = theme.indexOf(':root[data-theme="dark"]');
const [light, dark] = [properties(theme.slice(0, split)), properties(theme.slice(split))];
const value = (id: string): SpecValue | undefined => spec.values.get(id)?.value;

describe("this repository's spec", () => {
  it("decides the colors: the stylesheet has each one, for light and for dark", () => {
    const colors = [...spec.values.values()].map((entry) => entry.value).filter((entry) => entry.type === "color");
    expect(colors.length).toBeGreaterThan(30);
    for (const color of colors) {
      const name = color.id.replace(/^color\./, "");
      expect([color.id, hex(light.get(name) ?? "missing")]).toEqual([color.id, color.value]);
      expect([color.id, hex(dark.get(name) ?? light.get(name) ?? "missing")]).toEqual([color.id, color.dark ?? color.value]);
    }
  });

  it("decides fonts, corners and bar heights", () => {
    const pairs = [
      ["font.body", "font"],
      ["font.mono", "mono"],
      ["shape.radius", "radius"],
      ["shape.radius-large", "radius-lg"],
      ["bar.top-height", "appbar-h"],
      ["bar.tabs-height", "tabbar-h"],
    ] as const;
    for (const [id, property] of pairs) expect([id, light.get(property)]).toEqual([id, value(id)?.value]);
  });

  it("decides the widths at which the layout changes, and the limits requirements name", () => {
    const has = (where: string, source: string, text: string) => expect([where, text, source.includes(text)]).toEqual([where, text, true]);
    has("DiffView", diffView, `(min-width: ${String(value("layout.diff-split-from")?.value)})`);
    has("SpecChanges", specChanges, `(min-width: ${String(value("layout.spec-split-from")?.value)})`);
    has("app.css", appCss, `(min-width: ${String(value("layout.sidebar-from")?.value)})`);
    has("app.css", appCss, `(min-width: ${String(value("layout.sidebar-names-from")?.value)})`);
    has("queries/spec", specQueries, `SPEC_READ_WHOLE = ${String(value("spec.read-whole")?.value)};`);
    has("SpecScreen", specScreen, `PAGE = ${String(value("spec.list-page")?.value)};`);
    has("SpecDiffScreen", specDiffScreen, `PAGE = ${String(value("spec-diff.page")?.value)};`);
    has("SpecChanges", specChanges, `WHOLE_SHOWN = ${String(value("spec-review.whole-shown")?.value)};`);
    has("theme", themeCode, `THEME_FADE_MS = ${String(value("theme.fade")?.value).replace("ms", "")};`);
  });
});
