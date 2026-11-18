import { useMemo, useState } from "react";
import { highlightLines, languageForPath } from "../lib/highlight";

const PAGE = 2000;

/** Read-only source view with line numbers and syntax highlighting. */
export function CodeView({ text, path, wrap }: { text: string; path: string; wrap: boolean }) {
  const lines = useMemo(() => highlightLines(text.replace(/\n$/, ""), languageForPath(path)), [text, path]);
  const [limit, setLimit] = useState(PAGE);
  const shown = lines.slice(0, limit);

  return (
    <div className={`code-view${wrap ? " wrap" : ""}`}>
      {shown.map((tokens, i) => (
        <div className="cl" key={i}>
          <span className="cl-num">{i + 1}</span>
          <span className="cl-code">
            {tokens.length === 0
              ? "​"
              : tokens.map((token, j) =>
                  token.cls !== undefined && token.cls !== "" ? (
                    <span key={j} className={token.cls}>
                      {token.text}
                    </span>
                  ) : (
                    token.text
                  ),
                )}
          </span>
        </div>
      ))}
      {lines.length > limit && (
        <div className="load-more">
          <button className="btn btn-sm" onClick={() => setLimit(limit + PAGE)}>
            Show {Math.min(PAGE, lines.length - limit).toLocaleString()} more lines
          </button>
        </div>
      )}
    </div>
  );
}
