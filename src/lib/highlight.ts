// Syntax highlighting with highlight.js. Output is converted to plain token
// arrays (text + class) and rendered by React, so code is never injected
// as HTML.

import hljs from "highlight.js/lib/common";

export interface Token {
  text: string;
  cls?: string;
}

export type TokenLine = Token[];

const BY_FILENAME: Record<string, string> = {
  dockerfile: "dockerfile",
  makefile: "makefile",
  gnumakefile: "makefile",
  "cmakelists.txt": "cmake",
  gemfile: "ruby",
  rakefile: "ruby",
  podfile: "ruby",
  "build.gradle": "groovy",
  jenkinsfile: "groovy",
  "cargo.lock": "ini",
  ".gitignore": "bash",
  ".bashrc": "bash",
  ".zshrc": "bash",
  ".env": "bash",
};

const BY_EXTENSION: Record<string, string> = {
  tsx: "typescript",
  mts: "typescript",
  cts: "typescript",
  jsx: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  kts: "kotlin",
  gradle: "groovy",
  vue: "xml",
  svelte: "xml",
  svg: "xml",
  plist: "xml",
  toml: "ini",
  lock: "yaml",
  tf: "ini",
  sbt: "scala",
  h: "c",
  hpp: "cpp",
  cc: "cpp",
  mdx: "markdown",
  jsonc: "json",
  json5: "json",
  gql: "graphql",
  graphql: "graphql",
  proto: "protobuf",
  zsh: "bash",
  fish: "bash",
  ex: "elixir",
  exs: "elixir",
};

/** Guesses a highlight.js language from a file path. */
export function languageForPath(path: string): string | undefined {
  const name = path.split("/").pop()?.toLowerCase() ?? "";
  if (BY_FILENAME[name]) return BY_FILENAME[name];
  if (name.startsWith("dockerfile")) return "dockerfile";
  const ext = name.includes(".") ? name.split(".").pop()! : "";
  const candidate = BY_EXTENSION[ext] ?? ext;
  return candidate && hljs.getLanguage(candidate) ? candidate : undefined;
}

const ENTITIES: Record<string, string> = { "&lt;": "<", "&gt;": ">", "&amp;": "&", "&quot;": '"', "&#x27;": "'", "&#39;": "'" };

function decode(text: string): string {
  return text.replace(/&(?:lt|gt|amp|quot|#x27|#39);/g, (e) => ENTITIES[e] ?? e);
}

/**
 * Converts highlight.js HTML into lines of tokens. Spans may cross newlines
 * (block comments, template strings); the open class stack carries over.
 */
export function htmlToTokenLines(html: string): TokenLine[] {
  const lines: TokenLine[] = [[]];
  const stack: string[] = [];
  const pattern = /<span class="([^"]*)">|<\/span>|([^<]+)/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(html))) {
    if (match[1] !== undefined) {
      stack.push(match[1].replace(/hljs-/g, "hl-"));
    } else if (match[0] === "</span>") {
      stack.pop();
    } else if (match[2] !== undefined) {
      const cls = stack.length ? stack.join(" ") : undefined;
      const parts = decode(match[2]).split("\n");
      parts.forEach((part, index) => {
        if (index > 0) lines.push([]);
        if (part) lines[lines.length - 1].push({ text: part, cls });
      });
    }
  }
  return lines;
}

const MAX_HIGHLIGHT_CHARS = 250_000;

/** Highlights `code` and returns one token array per line. */
export function highlightLines(code: string, language?: string): TokenLine[] {
  if (!language || code.length > MAX_HIGHLIGHT_CHARS) {
    return code.split("\n").map((line) => (line ? [{ text: line }] : []));
  }
  try {
    const { value } = hljs.highlight(code, { language, ignoreIllegals: true });
    return htmlToTokenLines(value);
  } catch {
    return code.split("\n").map((line) => (line ? [{ text: line }] : []));
  }
}

/**
 * Splits tokens so that character ranges marked `changed` (from a word diff)
 * can be emphasised on top of syntax colours.
 */
export function overlaySegments(tokens: TokenLine, segments: { text: string; changed: boolean }[]): (Token & { changed?: boolean })[] {
  const out: (Token & { changed?: boolean })[] = [];
  let segIndex = 0;
  let segOffset = 0;
  for (const token of tokens) {
    let rest = token.text;
    while (rest.length > 0) {
      const segment = segments[segIndex];
      if (!segment) {
        out.push({ ...token, text: rest });
        break;
      }
      const available = segment.text.length - segOffset;
      const take = Math.min(available, rest.length);
      out.push({ text: rest.slice(0, take), cls: token.cls, changed: segment.changed });
      rest = rest.slice(take);
      segOffset += take;
      if (segOffset >= segment.text.length) {
        segIndex++;
        segOffset = 0;
      }
    }
  }
  return out;
}
