import type { FileReview, Risk } from "../lib/reviewRules";

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

/** What to check in a file, between its name and its diff. */
export function ReviewNotes({ review }: { review: FileReview }) {
  return (
    <div className="review-notes" data-risk={review.risk}>
      {review.instructions.length > 0 && (
        <ul>
          {review.instructions.map((instruction) => (
            <li key={`${instruction.risk}\n${instruction.text}`}>{instruction.text}</li>
          ))}
        </ul>
      )}
      <div className="review-notes-why">
        {review.unmatched ? `No rule matches this file, so it's ${review.risk}.` : `Matched ${review.matched.join(", ")}`}
      </div>
    </div>
  );
}
