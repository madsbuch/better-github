import DOMPurify from "dompurify";
import { memo, useMemo, type MouseEvent } from "react";
import { backend } from "../lib/backend";
import { appPathForUrl } from "../lib/links";
import { nav } from "../lib/router";

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
    return new URL(url, root + (dir ? `${dir}/` : "")).toString();
  } catch {
    return url;
  }
}

DOMPurify.addHook("afterSanitizeAttributes", (node) => {
  if (node.tagName === "A") {
    const href = node.getAttribute("href");
    if (href) node.setAttribute("href", resolve(href, "link"));
    node.removeAttribute("target");
  } else if (node.tagName === "IMG") {
    const src = node.getAttribute("data-canonical-src") && !node.getAttribute("src")
      ? node.getAttribute("data-canonical-src")
      : node.getAttribute("src");
    if (src) node.setAttribute("src", resolve(src, "image"));
    node.setAttribute("loading", "lazy");
    node.setAttribute("referrerpolicy", "no-referrer");
  } else if (node.tagName === "VIDEO") {
    const src = node.getAttribute("src");
    if (src) node.setAttribute("src", resolve(src, "image"));
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

/** Opens a URL in-app when we have a screen for it, otherwise externally. */
export function openLink(url: string) {
  const path = appPathForUrl(url);
  if (path) nav.navigate(path);
  else void backend.openUrl(url);
}

function onClick(event: MouseEvent<HTMLDivElement>) {
  const target = event.target as Element;
  if (target.closest("summary")) return;
  const anchor = target.closest("a");
  if (!anchor) return;
  const href = anchor.getAttribute("href");
  event.preventDefault();
  if (!href || href.startsWith("#")) return;
  openLink(href);
}

export const Markdown = memo(function Markdown({
  html,
  base = null,
  empty,
}: {
  html: string | null | undefined;
  base?: MarkdownBase | null;
  empty?: string;
}) {
  const clean = useMemo(() => (html ? sanitizeHtml(html, base) : ""), [html, base]);
  if (!clean.trim()) {
    return empty ? <p className="muted small" style={{ margin: 0, fontStyle: "italic" }}>{empty}</p> : null;
  }
  return <div className="markdown" onClick={onClick} dangerouslySetInnerHTML={{ __html: clean }} />;
});
