import { CheckIcon, ChevronDownIcon, ChevronRightIcon, KebabHorizontalIcon } from "@primer/octicons-react";
import { memo, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { anchorKey, anchorOf, hunkSides, intralineDiffs, parsePatch, type DiffLine, type Hunk, type Side } from "../lib/diff";
import { highlightLines, languageForPath, overlaySegments, type Token } from "../lib/highlight";

export interface DiffFileData {
  filename: string;
  previousFilename?: string | null;
  status: string;
  additions: number;
  deletions: number;
  patch?: string | null;
}

export interface LineTarget {
  path: string;
  line: DiffLine;
  side: Side;
  number: number;
}

interface DiffFileProps {
  file: DiffFileData;
  wrap: boolean;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  viewed?: boolean;
  onToggleViewed?: () => void;
  onMenu?: () => void;
  /** Rendered under the line with the matching "SIDE:line" key. */
  inline?: Map<string, ReactNode>;
  /** Rendered above the diff, e.g. outdated review threads. */
  top?: ReactNode;
  /** Shown before the line counts, e.g. the file's review verdict. */
  badge?: ReactNode;
  selectedKey?: string | null;
  onLineSelect?: (target: LineTarget) => void;
}

const STATUS_LABEL: Record<string, string> = {
  added: "Added",
  removed: "Deleted",
  renamed: "Renamed",
  copied: "Copied",
};

export const DiffFile = memo(function DiffFile(props: DiffFileProps) {
  const { file, collapsed, onToggleCollapsed, viewed, onToggleViewed, onMenu, top, badge } = props;
  const slash = file.filename.lastIndexOf("/");
  const dir = slash >= 0 ? file.filename.slice(0, slash + 1) : "";
  const base = file.filename.slice(slash + 1);
  const status = STATUS_LABEL[file.status];

  return (
    <div className={`diff-file${viewed ? " viewed" : ""}`} data-path={file.filename}>
      <div className="diff-file-header">
        <button className="path" onClick={onToggleCollapsed} aria-expanded={!collapsed}>
          {collapsed ? <ChevronRightIcon size={14} /> : <ChevronDownIcon size={14} />}{" "}
          {file.previousFilename && file.previousFilename !== file.filename && (
            <span className="dir">{file.previousFilename} → </span>
          )}
          <span className="dir">{dir}</span>
          {base}
          <span style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 2, fontWeight: 400 }}>
            {badge}
            <span className="diffstat">
              <span className="add">+{file.additions}</span>
              <span className="del">−{file.deletions}</span>
            </span>
            {status && <span className="muted tiny">{status}</span>}
          </span>
        </button>
        {onToggleViewed && (
          <button className={`viewed-toggle${viewed ? " on" : ""}`} onClick={onToggleViewed} aria-pressed={viewed}>
            {viewed && <CheckIcon size={12} />} Viewed
          </button>
        )}
        {onMenu && (
          <button className="icon-btn sm" aria-label="File actions" onClick={onMenu}>
            <KebabHorizontalIcon size={16} />
          </button>
        )}
      </div>
      {!collapsed && (
        <>
          {top}
          <LazyBody {...props} />
        </>
      )}
    </div>
  );
});

/** Defers rendering big diffs until they scroll near the viewport. */
function LazyBody(props: DiffFileProps) {
  const lines = props.file.patch ? props.file.patch.split("\n").length : 0;
  const [visible, setVisible] = useState(lines < 80);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (visible) return;
    const element = ref.current;
    if (!element) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: "1200px 0px" },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [visible]);

  if (!visible) return <div ref={ref} style={{ height: Math.min(lines, 2000) * 20 }} />;
  return <DiffBody {...props} />;
}

function tokenClass(token: Token & { changed?: boolean }): string | undefined {
  if (token.changed) return token.cls ? `${token.cls} changed` : "changed";
  return token.cls;
}

function DiffBody({ file, wrap, inline, selectedKey, onLineSelect }: DiffFileProps) {
  const hunks = useMemo(() => parsePatch(file.patch), [file.patch]);
  const language = languageForPath(file.filename);

  const tokenized = useMemo(
    () =>
      hunks.map((hunk) => {
        const { oldText, newText } = hunkSides(hunk);
        const oldLines = highlightLines(oldText, language);
        const newLines = highlightLines(newText, language);
        const intraline = intralineDiffs(hunk);
        let oldIndex = 0;
        let newIndex = 0;
        return hunk.lines.map((line, index) => {
          let tokens: Token[];
          if (line.kind === "ctx") {
            tokens = newLines[newIndex] ?? [];
            oldIndex++;
            newIndex++;
          } else if (line.kind === "del") {
            tokens = oldLines[oldIndex++] ?? [];
          } else if (line.kind === "add") {
            tokens = newLines[newIndex++] ?? [];
          } else {
            tokens = [{ text: line.text }];
          }
          const segments = intraline.get(index);
          return segments ? overlaySegments(tokens, segments) : tokens;
        });
      }),
    [hunks, language],
  );

  if (!file.patch) {
    let note = "No changes to show.";
    if (file.status === "renamed" && file.additions + file.deletions === 0) note = "File renamed without changes.";
    else if (file.additions + file.deletions === 0) note = "Binary file or empty change — no diff to show.";
    else note = "This diff is too large to display here.";
    return <div className="diff-note">{note}</div>;
  }

  const renderLine = (hunk: Hunk, line: DiffLine, tokens: (Token & { changed?: boolean })[], key: string) => {
    const anchor = anchorOf(line);
    const lineKey = anchor ? anchorKey(anchor.side, anchor.line) : null;
    const leftKey = line.kind === "ctx" && line.oldNo !== null ? anchorKey("LEFT", line.oldNo) : null;
    const below = (lineKey && inline?.get(lineKey)) || (leftKey && inline?.get(leftKey)) || null;
    const selected = lineKey !== null && lineKey === selectedKey;
    const marker = line.kind === "add" ? "+" : line.kind === "del" ? "-" : " ";
    return (
      <div key={key}>
        <div
          className={`dl ${line.kind}${selected ? " selected" : ""}`}
          onClick={
            anchor && onLineSelect
              ? () => onLineSelect({ path: file.filename, line, side: anchor.side, number: anchor.line })
              : undefined
          }
          data-hunk={hunk.header}
        >
          <span className="dl-num old">{line.oldNo ?? ""}</span>
          <span className="dl-num new">{line.newNo ?? ""}</span>
          <span className="dl-code">
            <span className="dl-marker">{line.kind === "meta" ? "" : marker}</span>
            {tokens.length === 0
              ? "​"
              : tokens.map((token, i) => {
                  const cls = tokenClass(token);
                  return cls ? (
                    <span key={i} className={cls}>
                      {token.text}
                    </span>
                  ) : (
                    token.text
                  );
                })}
          </span>
        </div>
        {below && <div className="diff-inline">{below}</div>}
      </div>
    );
  };

  return (
    <div className={`diff-body${wrap ? " wrap" : ""}`}>
      {hunks.map((hunk, h) => (
        <div key={hunk.header + h}>
          <div className="diff-hunk-header">
            <span className="dl-code">
              @@ -{hunk.oldStart},{hunk.oldCount} +{hunk.newStart},{hunk.newCount} @@ {hunk.section}
            </span>
          </div>
          {hunk.lines.map((line, i) => renderLine(hunk, line, tokenized[h][i], `${h}:${i}`))}
        </div>
      ))}
    </div>
  );
}
