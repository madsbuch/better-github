import { ChecklistIcon, ChevronRightIcon } from "@primer/octicons-react";
import type { ReactNode } from "react";
import { checksByRule, type FileReview, type Risk, type RuleMatch } from "../lib/reviewRules";
import { Sheet } from "./Sheet";

const LABEL: Record<Risk, string> = { high: "High", medium: "Medium", low: "Low" };
const PILL: Record<Risk, string> = { high: "pill pill-danger", medium: "pill pill-attention", low: "pill" };

/** A file's review verdict from .review-rules. */
export function RiskBadge({ risk, count }: { risk: Risk; count?: number }) {
  return (
    <span className={`${PILL[risk]} risk`} title={`${LABEL[risk]} risk`}>
      {LABEL[risk]}
      {count !== undefined && ` ${count}`}
    </span>
  );
}

/** An instruction, with `code` in backticks shown as code. */
export function CheckText({ text }: { text: string }) {
  const parts = text.split("`");
  // An unmatched backtick stays as typed.
  if (parts.length % 2 === 0) return <>{text}</>;
  return <>{parts.map((part, i) => (i % 2 === 1 ? <code key={i}>{part}</code> : part))}</>;
}

/** One line between a file's name and its diff; the checks open in a sheet. */
export function ReviewStrip({ review, onOpen }: { review: FileReview; onOpen: () => void }) {
  const count = new Set(review.instructions.map((i) => i.text)).size;
  return (
    <button className="review-strip" data-risk={review.risk} onClick={onOpen}>
      <ChecklistIcon size={16} />
      <span className="grow ellipsis">
        <span className="bold">
          {count} check{count === 1 ? "" : "s"}
        </span>
        <span className="muted"> · {review.unmatched ? "no rule matches" : review.rules.map((r) => r.label).join(", ")}</span>
      </span>
      <ChevronRightIcon size={16} />
    </button>
  );
}

/** A rule's checks under a heading saying which rule they come from. */
function RuleChecks({ rule, heading, children }: { rule: RuleMatch; heading: ReactNode; children?: ReactNode }) {
  return (
    <section className="rule-checks" data-risk={rule.risk}>
      <div className="rule-checks-heading">
        <RiskBadge risk={rule.risk} />
        <span className="mono small">{heading}</span>
      </div>
      {rule.instructions.length > 0 ? (
        <ul>
          {rule.instructions.map((text) => (
            <li key={text}>
              <CheckText text={text} />
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted small">Nothing more to check from this rule.</p>
      )}
      {children}
    </section>
  );
}

const ruleHeading = (rule: RuleMatch, labels = [rule.label]) =>
  rule.id === "unmatched" ? "No rule matches" : rule.id === "rules-file" ? ".review-rules (always high)" : labels.join(" · ");

/** Everything to check in one file, by the rule it comes from. */
export function FileReviewSheet({ path, review, onClose }: { path: string | null; review: FileReview | undefined; onClose: () => void }) {
  return (
    <Sheet open={path !== null && path !== "" && review !== undefined} onClose={onClose} title={path?.split("/").pop() ?? "File"} full>
      {path !== null && path !== "" && review && (
        <>
          <p className="mono small muted" style={{ margin: "0 0 12px", overflowWrap: "anywhere" }}>
            {path}
          </p>
          {checksByRule(review).map((rule) => (
            <RuleChecks key={rule.id} rule={rule} heading={ruleHeading(rule)} />
          ))}
        </>
      )}
    </Sheet>
  );
}

/**
 * Everything to check in a pull request: each rule once, riskiest first,
 * with the files it covers (tap one to go to it).
 */
export function ReviewGuideSheet({
  open,
  onClose,
  guide,
  onShowFile,
  footer,
}: {
  open: boolean;
  onClose: () => void;
  guide: { rule: RuleMatch; labels: string[]; files: string[] }[];
  onShowFile: (path: string) => void;
  footer?: ReactNode;
}) {
  return (
    <Sheet open={open} onClose={onClose} title="Review guide" full>
      {guide.map(({ rule, labels, files }) => (
        <RuleChecks key={rule.id} rule={rule} heading={ruleHeading(rule, labels)}>
          <div className="rule-checks-files">
            {files.map((path) => (
              <button key={path} className="link-btn mono small" onClick={() => onShowFile(path)}>
                {path.split("/").pop()}
              </button>
            ))}
          </div>
        </RuleChecks>
      ))}
      {footer}
    </Sheet>
  );
}
