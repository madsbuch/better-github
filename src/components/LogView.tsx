import { memo, useMemo, useState } from "react";
import { ansiSpans, groupLines, type LogLine, type LogNode } from "../lib/logs";

/** Lines rendered at first; the end of a log is where failures are. */
const TAIL = 1500;

/** Renders log lines: ANSI colors, `##[group]` sections as collapsibles, errors highlighted. */
export const LogView = memo(function LogView({ lines }: { lines: LogLine[] }) {
  const [shown, setShown] = useState(TAIL);
  const hidden = Math.max(0, lines.length - shown);
  const nodes = useMemo(() => groupLines(hidden > 0 ? lines.slice(hidden) : lines), [lines, hidden]);
  if (lines.length === 0) return <div className="log-empty muted small">No output</div>;
  return (
    <div className="log">
      {hidden > 0 && (
        <button className="log-more" onClick={() => setShown((n) => n + TAIL * 2)}>
          Show {Math.min(hidden, TAIL * 2).toLocaleString()} earlier lines
        </button>
      )}
      <Nodes nodes={nodes} />
    </div>
  );
});

function Nodes({ nodes }: { nodes: LogNode[] }) {
  return (
    <>
      {nodes.map((node, i) =>
        node.type === "line" ? (
          <Line key={i} line={node.line} />
        ) : (
          <details key={i} className="log-group">
            <summary className="log-line">
              <Text text={node.title.text} />
            </summary>
            <Nodes nodes={node.children} />
          </details>
        ),
      )}
    </>
  );
}

function Line({ line }: { line: LogLine }) {
  const label = line.kind === "error" ? "Error: " : line.kind === "warning" ? "Warning: " : line.kind === "notice" ? "Notice: " : "";
  return (
    <div className={`log-line log-${line.kind}`}>
      {label !== "" && <span className="log-label">{label}</span>}
      <Text text={line.text} />
    </div>
  );
}

function Text({ text }: { text: string }) {
  const spans = ansiSpans(text);
  if (spans.length === 1 && spans[0]?.className === "") return <>{text !== "" ? text : " "}</>;
  return (
    <>
      {spans.map((span, i) => (
        <span key={i} className={span.className !== "" ? span.className : undefined}>
          {span.text}
        </span>
      ))}
    </>
  );
}
