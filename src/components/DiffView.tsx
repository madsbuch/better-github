import { CheckIcon, ChevronDownIcon, ChevronRightIcon, ColumnsIcon, KebabHorizontalIcon, RowsIcon, UnwrapIcon, WrapIcon } from "@primer/octicons-react";
import { memo, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { anchorKey, anchorOf, hunkSides, intralineDiffs, parsePatch, splitRows, type DiffLine, type Hunk, type Side } from "../lib/diff";
import { highlightLines, languageForPath, overlaySegments, type Token } from "../lib/highlight";
import { setPref, useMediaQuery, usePrefs } from "../lib/prefs";

/** From this window width, a diff has room for the old and the new file next to each other. */
export const SPLIT_DIFF_QUERY = "(min-width: 1100px)";

/** Whether diffs are shown side by side right now: the preference, in a window wide enough for it. */
function useSplitDiff(): boolean {
  const wide = useMediaQuery(SPLIT_DIFF_QUERY);
  return usePrefs().splitDiff && wide;
}

/**
 * App bar buttons for how diffs are laid out: side by side or one column
 * (only where there's room for the choice), and line wrapping for one column.
 * Side by side always wraps, each side within its half.
 */
export function DiffLayoutButtons() {
  const prefs = usePrefs();
  const wide = useMediaQuery(SPLIT_DIFF_QUERY);
  const split = prefs.splitDiff && wide;
  return (
    <>
      {wide && (
        <button className="icon-btn" aria-label={split ? "Show in one column" : "Show side by side"} onClick={() => setPref("splitDiff", !prefs.splitDiff)}>
          {split ? <RowsIcon size={18} /> : <ColumnsIcon size={18} />}
        </button>
      )}
      {!split && (
        <button className="icon-btn" aria-label="Toggle line wrap" onClick={() => setPref("wrapDiff", !prefs.wrapDiff)}>
          {prefs.wrapDiff ? <UnwrapIcon size={18} /> : <WrapIcon size={18} />}
        </button>
      )}
    </>
  );
}

export interface DiffFileData {
  filename: string;
  previousFilename?: string | null | undefined;
  status: string;
  additions: number;
  deletions: number;
  patch?: string | null | undefined;
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
    <div className={`diff-file${viewed === true ? " viewed" : ""}`} data-path={file.filename}>
      <div className="diff-file-header">
        <button className="path" onClick={onToggleCollapsed} aria-expanded={!collapsed}>
          {collapsed ? <ChevronRightIcon size={14} /> : <ChevronDownIcon size={14} />}{" "}
          {(file.previousFilename ?? "") !== "" && file.previousFilename !== file.filename && (
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
            {status !== undefined && status !== "" && <span className="muted tiny">{status}</span>}
          </span>
        </button>
        {onToggleViewed && (
          <button className={`viewed-toggle${viewed === true ? " on" : ""}`} onClick={onToggleViewed} aria-pressed={viewed}>
            {viewed === true && <CheckIcon size={12} />} Viewed
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
  const patch = props.file.patch ?? "";
  const lines = patch !== "" ? patch.split("\n").length : 0;
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
  if (token.changed === true) return token.cls !== undefined && token.cls !== "" ? `${token.cls} changed` : "changed";
  return token.cls;
}

function DiffBody({ file, wrap, inline, selectedKey, onLineSelect }: DiffFileProps) {
  const hunks = useMemo(() => parsePatch(file.patch), [file.patch]);
  const language = languageForPath(file.filename);
  const split = useSplitDiff();

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

  if ((file.patch ?? "") === "") {
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
    const inlineAt = (key: string | null) => (key === null ? undefined : inline?.get(key));
    const below = inlineAt(lineKey) ?? inlineAt(leftKey) ?? null;
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
                  return cls !== undefined && cls !== "" ? (
                    <span key={i} className={cls}>
                      {token.text}
                    </span>
                  ) : (
                    token.text
                  );
                })}
          </span>
        </div>
        {below !== null && <div className="diff-inline">{below}</div>}
      </div>
    );
  };

  const renderTokens = (tokens: (Token & { changed?: boolean })[]) =>
    tokens.length === 0
      ? "​"
      : tokens.map((token, i) => {
          const cls = tokenClass(token);
          return cls !== undefined && cls !== "" ? (
            <span key={i} className={cls}>
              {token.text}
            </span>
          ) : (
            token.text
          );
        });

  /** One side of a side-by-side row: that side's line number and code, or a blank where the other side has more lines. */
  const renderHalf = (hunk: Hunk, h: number, index: number | null, side: Side) => {
    const line = index === null ? undefined : hunk.lines[index];
    if (index === null || line === undefined) return <div className="dl empty" aria-hidden />;
    const anchor = anchorOf(line);
    const selected = anchor !== null && anchorKey(anchor.side, anchor.line) === selectedKey;
    return (
      <div
        className={`dl ${line.kind}${selected ? " selected" : ""}`}
        onClick={anchor && onLineSelect ? () => onLineSelect({ path: file.filename, line, side: anchor.side, number: anchor.line }) : undefined}
        data-hunk={hunk.header}
      >
        <span className={`dl-num ${side === "LEFT" ? "old" : "new"}`}>{(side === "LEFT" ? line.oldNo : line.newNo) ?? ""}</span>
        <span className="dl-code">{renderTokens(tokenized[h]?.[index] ?? [])}</span>
      </div>
    );
  };

  /** What hangs below a row: threads and drafts of the line on either side. */
  const below = (hunk: Hunk, index: number | null): ReactNode => {
    const line = index === null ? undefined : hunk.lines[index];
    if (line === undefined) return null;
    const anchor = anchorOf(line);
    const own = anchor ? inline?.get(anchorKey(anchor.side, anchor.line)) : undefined;
    const old = line.kind === "ctx" && line.oldNo !== null ? inline?.get(anchorKey("LEFT", line.oldNo)) : undefined;
    return own ?? old ?? null;
  };

  if (split) {
    return (
      <div className="diff-body split">
        {hunks.map((hunk, h) => (
          <div key={`${hunk.header}${h}`}>
            <div className="diff-hunk-header">
              <span className="dl-code">
                @@ -{hunk.oldStart},{hunk.oldCount} +{hunk.newStart},{hunk.newCount} @@ {hunk.section}
              </span>
            </div>
            {splitRows(hunk).map((row, r) => {
              const left = below(hunk, row.left);
              // An unchanged line is one line: its comments show once.
              const right = row.right === row.left ? null : below(hunk, row.right);
              return (
                <div key={r}>
                  <div className="dl-row">
                    {renderHalf(hunk, h, row.left, "LEFT")}
                    {renderHalf(hunk, h, row.right, "RIGHT")}
                  </div>
                  {left !== null && <div className="diff-inline">{left}</div>}
                  {right !== null && <div className="diff-inline">{right}</div>}
                </div>
              );
            })}
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className={`diff-body${wrap ? " wrap" : ""}`}>
      {hunks.map((hunk, h) => (
        <div key={`${hunk.header}${h}`}>
          <div className="diff-hunk-header">
            <span className="dl-code">
              @@ -{hunk.oldStart},{hunk.oldCount} +{hunk.newStart},{hunk.newCount} @@ {hunk.section}
            </span>
          </div>
          {hunk.lines.map((line, i) => renderLine(hunk, line, tokenized[h]?.[i] ?? [], `${h}:${i}`))}
        </div>
      ))}
    </div>
  );
}
