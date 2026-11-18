import DOMPurify from "dompurify";
import { memo, useCallback, useMemo, type MouseEvent } from "react";
import { useOpenLink } from "../lib/links";

/** Where relative links in a rendered file (e.g. a README) point to. */
export interface MarkdownBase {
  owner: string;
  repo: string;
  ref: string;
  /** Directory of the rendered file, without leading/trailing slashes. */
  dir: string;
}

let currentBase: MarkdownBase | null = null;

function resolve(url: string, kind: "link" | "image"): string {
  if (/^(?:[a-z][a-z0-9+.-]*:|#|\/\/)/i.test(url)) return url;
  if (url.startsWith("/")) return `https://github.com${url}`;
  if (!currentBase) return url;
  const { owner, repo, ref, dir } = currentBase;
  const root =
    kind === "image"
      ? `https://raw.githubusercontent.com/${owner}/${repo}/${ref}/`
      : `https://github.com/${owner}/${repo}/blob/${ref}/`;
  try {
    return new URL(url, root + (dir !== "" ? `${dir}/` : "")).toString();
  } catch {
    return url;
  }
}

/** An attribute that is present and not empty. */
function isSet(value: string | null): value is string {
  return value !== null && value !== "";
}

DOMPurify.addHook("afterSanitizeAttributes", (node) => {
  if (node.tagName === "A") {
    const href = node.getAttribute("href");
    if (isSet(href)) node.setAttribute("href", resolve(href, "link"));
    node.removeAttribute("target");
  } else if (node.tagName === "IMG") {
    const canonical = node.getAttribute("data-canonical-src");
    const src = isSet(canonical) && !isSet(node.getAttribute("src")) ? canonical : node.getAttribute("src");
    if (isSet(src)) node.setAttribute("src", resolve(src, "image"));
    node.setAttribute("loading", "lazy");
    node.setAttribute("referrerpolicy", "no-referrer");
  } else if (node.tagName === "VIDEO") {
    const src = node.getAttribute("src");
    if (isSet(src)) node.setAttribute("src", resolve(src, "image"));
    node.removeAttribute("autoplay");
  } else if (node.tagName === "INPUT") {
    node.setAttribute("disabled", "");
  }
});

export function sanitizeHtml(html: string, base: MarkdownBase | null = null): string {
  currentBase = base;
  try {
    return DOMPurify.sanitize(html, {
      FORBID_TAGS: ["style", "form", "button", "textarea", "select", "iframe", "object", "embed"],
      FORBID_ATTR: ["style", "id", "name"],
    });
  } finally {
    currentBase = null;
  }
}


export const Markdown = memo(function Markdown({
  html,
  base = null,
  empty,
}: {
  html: string | null | undefined;
  base?: MarkdownBase | null;
  empty?: string | undefined;
}) {
  const clean = useMemo(() => (html !== null && html !== undefined && html !== "" ? sanitizeHtml(html, base) : ""), [html, base]);
  const openLink = useOpenLink();
  // Links open in the app when it has a screen for them, otherwise in a browser tab.
  const onClick = useCallback(
    (event: MouseEvent<HTMLDivElement>) => {
      const target = event.target;
      if (!(target instanceof Element) || target.closest("summary")) return;
      const anchor = target.closest("a");
      if (!anchor) return;
      const href = anchor.getAttribute("href");
      event.preventDefault();
      if (!isSet(href) || href.startsWith("#")) return;
      openLink(href);
    },
    [openLink],
  );
  if (clean.trim() === "") {
    return empty !== undefined && empty !== "" ? <p className="muted small" style={{ margin: 0, fontStyle: "italic" }}>{empty}</p> : null;
  }
  return <div className="markdown" onClick={onClick} dangerouslySetInnerHTML={{ __html: clean }} />;
});
