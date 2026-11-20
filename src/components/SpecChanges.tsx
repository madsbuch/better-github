// What changed in a spec, item by item (src/lib/specDiff.ts). The same cards
// show a comparison of two branches and, in a pull request's Files tab, the
// review of its spec files: there each card is one file, with its viewed
// state, and the comments on the file's lines shown at the requirement or
// field those lines belong to.

import { AlertIcon, CheckIcon, ChevronDownIcon, ChevronRightIcon, CommentIcon, KebabHorizontalIcon, LinkExternalIcon } from "@primer/octicons-react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { anchorKey, wordDiff, type Hunk, type Segment, type Side } from "../lib/diff";
import { to } from "../lib/nav";
import { SPEC_DIR, specTrail, type SpecFigure, type SpecRequirement, type SpecStatus } from "../lib/spec";
import type { ChangeKind, FieldChange, FigureChange, ItemChange, ItemKind, ListChange, RequirementChange, SpecDiff } from "../lib/specDiff";
import { commentLine, jsonLines, requirementSpan, type CommentLine, type LineSpan } from "../lib/specLines";
import { repoQueries } from "../queries/repos";
import { CheckText } from "./ReviewRules";

export interface Sides {
  owner: string;
  repo: string;
  base: string;
  head: string;
}

/** A thread or a pending comment on a line of one side of the item's file. */
export interface PlacedComment {
  key: string;
  side: Side;
  line: number;
  node: ReactNode;
}

/** What a card needs to take part in a pull request's review. */
export interface SpecFileReview {
  /** The file's diff in the pull request: which of its lines take comments. */
  hunks: Hunk[];
  /** The file's JSON on each side; null where it doesn't exist. */
  text: { before: string | null; after: string | null };
  comments: PlacedComment[];
  /** Comments that aren't on a line of this diff any more. */
  outdated: ReactNode;
  /** "SIDE:line" of the line being commented on. */
  selectedKey: string | null;
  onComment: (line: CommentLine) => void;
}

const KIND_LABEL: Record<ItemKind, string> = { added: "Added", removed: "Removed", changed: "Changed", moved: "Moved" };
const KIND_SIGN: Record<ItemKind, string> = { added: "+", removed: "−", changed: "~", moved: "→" };
const plural = (count: number, noun: string) => `${count} ${noun}${count === 1 ? "" : "s"}`;

// ----------------------------------------------------------------- summary

/** How much changed, and what takes something away from the spec: the first thing a reviewer should see. */
export function SpecChangesSummary({ diff, onShow }: { diff: SpecDiff; onShow?: ((id: string) => void) | undefined }) {
  const line = <K extends ItemKind>(counts: Record<K, number>, kinds: readonly K[], noun: string) => {
    const total = kinds.reduce((sum, kind) => sum + counts[kind], 0);
    if (total === 0) return null;
    return (
      <span>
        <span className="bold">{plural(total, noun)}</span>{" "}
        {kinds
          .filter((kind) => counts[kind] > 0)
          .map((kind) => (
            <span key={kind} className="spec-diff-count" data-kind={kind} title={KIND_LABEL[kind]}>
              {KIND_SIGN[kind]}
              {counts[kind]}
            </span>
          ))}
      </span>
    );
  };
  const weakened = diff.items.flatMap((item) => [
    ...(item.weakened !== null ? [{ id: item.id, key: item.id, label: titleOf(item), why: item.weakened }] : []),
    ...item.requirements
      .filter((r) => r.weakened !== null)
      .map((r) => ({ id: item.id, key: `${item.id}#${r.id}`, label: `${titleOf(item)} ${r.id}`, why: r.weakened ?? "" })),
  ]);
  return (
    <>
      <div className="spec-diff-summary">
        {line(diff.counts.items, ["added", "changed", "moved", "removed"] as const, "item")}
        {line(diff.counts.requirements, ["added", "changed", "moved", "removed"] as const, "requirement")}
      </div>
      {weakened.length > 0 && (
        <div className="banner banner-attention spec-weakened">
          <AlertIcon size={16} className="c-attention" />
          <div className="grow" style={{ minWidth: 0 }}>
            <div className="bold">{plural(weakened.length, "change")} take something away from the spec</div>
            <ul>
              {weakened.slice(0, 12).map((entry) => (
                <li key={entry.key}>
                  {onShow ? (
                    <button className="link-btn" onClick={() => onShow(entry.id)}>
                      {entry.label}
                    </button>
                  ) : (
                    <span className="bold">{entry.label}</span>
                  )}{" "}
                  <span className="small">{entry.why}</span>
                </li>
              ))}
            </ul>
            {weakened.length > 12 && <div className="small muted">And {weakened.length - 12} more, marked below.</div>}
          </div>
        </div>
      )}
    </>
  );
}

/** The item's title on the side that has it, the newer one first. */
function titleOf(change: ItemChange): string {
  return (change.after ?? change.before)?.title ?? change.id;
}

// -------------------------------------------------------------------- card

interface CardProps {
  change: ItemChange;
  sides: Sides;
  /** Set by a list that manages which cards are open; otherwise the card does. */
  collapsed?: boolean | undefined;
  onToggleCollapsed?: (() => void) | undefined;
  viewed?: boolean | undefined;
  onToggleViewed?: (() => void) | undefined;
  onMenu?: (() => void) | undefined;
  /** Shown next to the kind, e.g. the file's review verdict. */
  badge?: ReactNode;
  /** Rendered above the changes, e.g. what to check in this file. */
  top?: ReactNode;
  review?: SpecFileReview | undefined;
}

export function SpecChangeCard(props: CardProps) {
  const { change, sides, viewed, onToggleViewed, onMenu, badge } = props;
  const [ownCollapsed, setOwnCollapsed] = useState(false);
  const collapsed = props.collapsed ?? ownCollapsed;
  const toggle = props.onToggleCollapsed ?? (() => setOwnCollapsed((value) => !value));
  // The side that has the item: the newer one unless it was removed.
  const node = change.after ?? change.before;
  if (node === null) return null;
  const ref = change.after !== null ? sides.head : sides.base;
  const trail = specTrail(node).slice(0, -1);
  const counts = { added: 0, changed: 0, removed: 0 };
  for (const requirement of change.requirements) counts[requirement.kind]++;
  const weakened = (change.weakened !== null ? 1 : 0) + change.requirements.filter((r) => r.weakened !== null).length;

  return (
    <div className={`diff-file spec-change${viewed === true ? " viewed" : ""}`} data-path={node.file ?? undefined} data-id={change.id} data-kind={change.kind}>
      <div className="diff-file-header">
        <button className="path" onClick={toggle} aria-expanded={!collapsed}>
          {collapsed ? <ChevronRightIcon size={14} /> : <ChevronDownIcon size={14} />}{" "}
          {trail.length > 0 && <span className="dir">{trail.map((n) => n.title).join(" / ")} / </span>}
          <span className="spec-change-title">{node.title}</span>
          <span className="spec-change-meta">
            {badge}
            <span className="spec-diff-kind" data-kind={change.kind}>
              {KIND_LABEL[change.kind]}
            </span>
            {weakened > 0 && (
              <span className="spec-diff-kind" data-kind="weakened">
                <AlertIcon size={12} /> Takes away
              </span>
            )}
            {(["added", "changed", "removed"] as const)
              .filter((kind) => counts[kind] > 0)
              .map((kind) => (
                <span key={kind} className="spec-diff-count" data-kind={kind} title={`${plural(counts[kind], "requirement")} ${kind}`}>
                  {KIND_SIGN[kind]}
                  {counts[kind]}
                </span>
              ))}
          </span>
        </button>
        {onToggleViewed && (
          <button className={`viewed-toggle${viewed === true ? " on" : ""}`} onClick={onToggleViewed} aria-pressed={viewed}>
            {viewed === true && <CheckIcon size={12} />} Viewed
          </button>
        )}
        {onMenu ? (
          <button className="icon-btn sm" aria-label="File actions" onClick={onMenu}>
            <KebabHorizontalIcon size={16} />
          </button>
        ) : (
          <Link {...to.spec(sides.owner, sides.repo, ref, change.id)} className="icon-btn sm" aria-label={`Open ${node.title} in the spec`}>
            <LinkExternalIcon size={16} />
          </Link>
        )}
      </div>
      {!collapsed && (
        <LazyMount>
          {props.top}
          <CardBody {...props} />
        </LazyMount>
      )}
    </div>
  );
}

/** Mounts its children once it is near the viewport: a pull request can change hundreds of items. */
function LazyMount({ children }: { children: ReactNode }) {
  const [visible, setVisible] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const element = ref.current;
    if (visible || !element) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) setVisible(true);
      },
      { rootMargin: "1200px 0px" },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [visible]);
  return visible ? <>{children}</> : <div ref={ref} style={{ height: 160 }} />;
}

const inSpan = (span: LineSpan | null | undefined, line: number) => span !== null && span !== undefined && line >= span.start && line <= span.end;

interface Spans {
  before: LineSpan | null;
  after: LineSpan | null;
}

function CardBody({ change, sides, review }: CardProps) {
  // Where each part of the item is in its file, on each side.
  const lines = useMemo(() => {
    const [before, after] = [review?.text.before ?? null, review?.text.after ?? null];
    const [old, current] = [before === null ? null : jsonLines(before), after === null ? null : jsonLines(after)];
    return {
      field: (name: string): Spans => ({ before: old?.get(name) ?? null, after: current?.get(name) ?? null }),
      requirement: (id: string): Spans => ({
        before: before !== null && old !== null ? requirementSpan(before, old, id) : null,
        after: after !== null && current !== null ? requirementSpan(after, current, id) : null,
      }),
    };
  }, [review?.text.before, review?.text.after]);

  // Each comment goes to the first part whose lines it is on; the rest follow the changes.
  const placed = useMemo(() => {
    const parts: { key: string; spans: Spans }[] = [
      ...change.fields.map((field) => ({ key: `field:${field.field}`, spans: lines.field(field.field) })),
      ...[...change.requirements.map((r) => r.id), ...change.unchanged.map((r) => r.id)].map((id) => ({ key: `requirement:${id}`, spans: lines.requirement(id) })),
      { key: "figures", spans: lines.field("figures") },
      ...change.lists.map((list) => ({ key: `list:${list.field}`, spans: lines.field(list.field) })),
    ];
    const byPart = new Map<string, ReactNode[]>();
    const rest: ReactNode[] = [];
    for (const comment of review?.comments ?? []) {
      const part = parts.find(({ spans }) => inSpan(comment.side === "LEFT" ? spans.before : spans.after, comment.line));
      if (part) byPart.set(part.key, [...(byPart.get(part.key) ?? []), comment.node]);
      else rest.push(comment.node);
    }
    return { byPart, rest };
  }, [change, lines, review?.comments]);

  /** The comments on a part, and a way to add one where the pull request's diff reaches it. */
  const discuss = (key: string, spans: Spans, label: string): { button: ReactNode; comments: ReactNode; selected: boolean } => {
    const comments = placed.byPart.get(key);
    const target = review ? (commentLine(review.hunks, "RIGHT", spans.after) ?? commentLine(review.hunks, "LEFT", spans.before)) : null;
    return {
      button:
        review && target ? (
          <button className="icon-btn sm spec-comment-btn" aria-label={`Comment on ${label}`} onClick={() => review.onComment(target)}>
            <CommentIcon size={16} />
          </button>
        ) : null,
      comments: comments ? <div className="spec-comments">{comments}</div> : null,
      selected: review !== undefined && target !== null && review.selectedKey === anchorKey(target.side, target.number),
    };
  };

  if (change.pending) return <div className="spec-diff-note muted">Reading what changed…</div>;
  const fields = change.fields.filter((field) => field.field !== "title" || (change.before !== null && change.after !== null));
  const whole = change.kind === "added" || change.kind === "removed";
  const figures = discuss("figures", lines.field("figures"), "the figures");

  return (
    <div className="spec-change-body">
      {change.movedFrom !== null && (
        <p className="spec-diff-note">
          Moved from <span className="mono small">{change.movedFrom}</span>
          {change.fields.length + change.requirements.length + change.figures.length + change.lists.length === 0 && ", otherwise unchanged"}.
        </p>
      )}
      {change.weakened !== null && (
        <p className="spec-diff-note spec-weakened-note">
          <AlertIcon size={14} /> {change.weakened}
        </p>
      )}
      {change.unreadable !== null ? (
        <p className="spec-diff-note">
          {change.unreadable.side === "after" ? `Can't be read on ${sides.head} any more` : `Couldn't be read on ${sides.base}; it can now`}:{" "}
          <span className="small">{change.unreadable.error}</span>
        </p>
      ) : (
        <>
          {fields.map((field) => {
            const talk = discuss(`field:${field.field}`, lines.field(field.field), `the ${FIELD_LABEL[field.field].toLowerCase()}`);
            return (
              <div key={field.field} className="spec-part" data-selected={talk.selected}>
                <Field change={field} whole={whole} action={talk.button} />
                {talk.comments}
              </div>
            );
          })}
          {(change.requirements.length > 0 || change.unchanged.length > 0) && (
            <Section title="Requirements">
              {change.requirements.map((requirement) => {
                const talk = discuss(`requirement:${requirement.id}`, lines.requirement(requirement.id), requirement.id);
                return <Requirement key={requirement.id} change={requirement} action={talk.button} comments={talk.comments} selected={talk.selected} />;
              })}
              <Unchanged requirements={change.unchanged} comments={(id) => placed.byPart.get(`requirement:${id}`)} />
            </Section>
          )}
          {change.figures.length > 0 && (
            <Section title="Figures" action={figures.button}>
              {change.figures.map((figure) => (
                <Figure key={figure.src} change={figure} sides={sides} />
              ))}
              {figures.comments}
            </Section>
          )}
          {change.lists.map((list) => {
            const talk = discuss(`list:${list.field}`, lines.field(list.field), LIST_LABEL[list.field].toLowerCase());
            return (
              <div key={list.field} className="spec-part" data-selected={talk.selected}>
                <List change={list} action={talk.button} />
                {talk.comments}
              </div>
            );
          })}
        </>
      )}
      {(placed.rest.length > 0 || review?.outdated !== undefined) && (
        <div className="spec-comments spec-comments-rest">
          {placed.rest}
          {review?.outdated}
        </div>
      )}
    </div>
  );
}

function Section({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section aria-label={title}>
      <h3>
        <span className="grow">{title}</span>
        {action}
      </h3>
      {children}
    </section>
  );
}

/** The requirements a change left alone, folded away: context for the ones it didn't. */
function Unchanged({ requirements, comments }: { requirements: SpecRequirement[]; comments: (id: string) => ReactNode[] | undefined }) {
  const discussed = requirements.some((r) => comments(r.id) !== undefined);
  const [open, setOpen] = useState(false);
  if (requirements.length === 0) return null;
  return (
    <>
      <button className="spec-unchanged-toggle" onClick={() => setOpen(!open)} aria-expanded={open || discussed}>
        {open || discussed ? <ChevronDownIcon size={14} /> : <ChevronRightIcon size={14} />} {plural(requirements.length, "unchanged requirement")}
      </button>
      {(open || discussed) &&
        requirements.map((requirement) => {
          const own = comments(requirement.id);
          // Folded, only the ones under discussion show.
          if (!open && own === undefined) return null;
          return (
            <div key={requirement.id} className="spec-diff-req" data-kind="unchanged" data-req={requirement.id}>
              <div className="spec-req-head">
                <span className="spec-req-id">{requirement.id}</span>
                <span className="spec-level" data-level={levelOf(requirement)}>
                  {levelOf(requirement)}
                </span>
              </div>
              <div className="spec-diff-same">
                <CheckText text={requirement.text} />
              </div>
              {own !== undefined && <div className="spec-comments">{own}</div>}
            </div>
          );
        })}
    </>
  );
}

/** A removed or added line of text; `segments` marks the words that differ from the other side. */
function Line({ kind, text, segments }: { kind: "added" | "removed"; text: string; segments?: Segment[] | undefined }) {
  return (
    <div className="spec-diff-line" data-kind={kind}>
      <span className="spec-diff-sign" aria-hidden>
        {KIND_SIGN[kind]}
      </span>
      <span className="spec-diff-text">
        {segments !== undefined ? (
          segments.map((segment, i) => (segment.changed ? <mark key={i}>{segment.text}</mark> : <span key={i}>{segment.text}</span>))
        ) : (
          <CheckText text={text} />
        )}
      </span>
    </div>
  );
}

/** Text that changed: the old line and the new one, with the words that differ marked. */
function TextChange({ before, after }: { before: string | undefined; after: string | undefined }) {
  const words = before !== undefined && after !== undefined ? wordDiff(before, after) : null;
  return (
    <>
      {before !== undefined && <Line kind="removed" text={before} segments={words?.[0]} />}
      {after !== undefined && <Line kind="added" text={after} segments={words?.[1]} />}
    </>
  );
}

const FIELD_LABEL: Record<FieldChange["field"], string> = {
  title: "Title",
  summary: "Summary",
  status: "Status",
  description: "Description",
  order: "Position",
  deprecation: "Why it is deprecated",
};

const STATUS_LABEL: Record<SpecStatus, string> = { draft: "Draft", accepted: "Accepted", implemented: "Implemented", deprecated: "Deprecated" };
const isStatus = (value: string): value is SpecStatus => value in STATUS_LABEL;
const statusLabel = (value: string | undefined) => (value === undefined ? "none" : isStatus(value) ? STATUS_LABEL[value] : value);

/** A short value that changed, as "old → new". */
function Move({ label, before, after, action }: { label: string; before: string; after: string; action?: ReactNode }) {
  return (
    <div className="spec-diff-move">
      <span className="grow">
        <span className="muted">{label}</span> <del>{before}</del> <span aria-hidden>→</span> <ins>{after}</ins>
      </span>
      {action}
    </div>
  );
}

/** `whole`: the item itself was added or removed, so every field is on one side only. */
function Field({ change, whole, action }: { change: FieldChange; whole: boolean; action: ReactNode }) {
  const label = FIELD_LABEL[change.field];
  // A new or removed item has one status, not a move from or to nothing.
  if (change.field === "status" && (change.before === undefined || change.after === undefined) && whole) {
    return (
      <div className="spec-diff-move">
        <span className="grow">
          <span className="muted">{label}</span> {statusLabel(change.after ?? change.before)}
        </span>
        {action}
      </div>
    );
  }
  if (change.field === "status") return <Move label={label} before={statusLabel(change.before)} after={statusLabel(change.after)} action={action} />;
  if (change.field === "order") return <Move label={label} before={change.before ?? "by title"} after={change.after ?? "by title"} action={action} />;
  return (
    <Section title={label} action={action}>
      <TextChange before={change.before} after={change.after} />
    </Section>
  );
}

const levelOf = (requirement: SpecRequirement) => requirement.level ?? "must";
const REQUIREMENT_KIND: Record<ChangeKind, string> = { added: "Added", removed: "Removed", changed: "Changed" };

function Requirement({ change, action, comments, selected }: { change: RequirementChange; action: ReactNode; comments: ReactNode; selected: boolean }) {
  const { before, after } = change;
  const shown = after ?? before;
  if (shown === null) return null;
  return (
    <div className="spec-diff-req" data-kind={change.kind} data-req={change.id} data-selected={selected}>
      <div className="spec-req-head">
        <span className="spec-req-id">{change.id}</span>
        <span className="spec-level" data-level={levelOf(shown)}>
          {levelOf(shown)}
        </span>
        <span className="grow" />
        {change.weakened !== null && (
          <span className="spec-diff-kind" data-kind="weakened" title={change.weakened}>
            <AlertIcon size={12} /> Takes away
          </span>
        )}
        <span className="spec-diff-kind" data-kind={change.moved !== null ? "moved" : change.kind}>
          {change.moved !== null ? "Moved" : REQUIREMENT_KIND[change.kind]}
        </span>
        {action}
      </div>
      {change.moved !== null && (
        <div className="spec-diff-same small">
          {"from" in change.moved ? "From " : "Now in "}
          <span className="mono">{"from" in change.moved ? change.moved.from : change.moved.to}</span>
        </div>
      )}
      {change.moved !== null && "to" in change.moved ? (
        // It isn't gone: what it says now is shown where it went.
        <div className="spec-diff-same">
          <CheckText text={shown.text} />
        </div>
      ) : before !== null && after !== null ? (
        before.text !== after.text ? (
          <TextChange before={before.text} after={after.text} />
        ) : (
          // Only its level or status moved: the text is there to say which requirement this is.
          <div className="spec-diff-same">
            <CheckText text={after.text} />
          </div>
        )
      ) : (
        <Line kind={after !== null ? "added" : "removed"} text={shown.text} />
      )}
      {change.version?.kind === "bumped" && (
        <div className="spec-diff-version">
          <Move label="Version" before={change.version.from.toString()} after={change.version.to.toString()} />
          {change.version.reason !== null && (
            <div className="spec-diff-same small">
              <span className="bold">Why it changed</span> <CheckText text={change.version.reason} />
            </div>
          )}
        </div>
      )}
      {change.version?.kind === "same" && (
        <div className="spec-diff-same small spec-same-version">
          Still version {change.version.at}: right for a wording fix. If what it means changed, it needs a new version that says why.
        </div>
      )}
      {before !== null && after !== null && (
        <>
          {levelOf(before) !== levelOf(after) && <Move label="Level" before={levelOf(before)} after={levelOf(after)} />}
          {before.status !== after.status && <Move label="Status" before={statusLabel(before.status)} after={statusLabel(after.status)} />}
        </>
      )}
      {after?.deprecation !== undefined && (
        <div className="spec-diff-same small">
          <span className="bold">Why it is deprecated</span> <CheckText text={after.deprecation.reason} />
          {(after.deprecation.replacedBy ?? []).length > 0 && (
            <>
              {" "}
              Replaced by <span className="mono">{(after.deprecation.replacedBy ?? []).join(", ")}</span>.
            </>
          )}
        </div>
      )}
      {/* The reason is right above; no need to say it twice. */}
      {change.weakened !== null && !(after?.deprecation !== undefined && change.weakened.startsWith("Deprecated: ")) && (
        <div className="spec-weakened-note small">{change.weakened}</div>
      )}
      {comments}
    </div>
  );
}

function Picture({ figure, owner, repo, gitRef, label }: { figure: SpecFigure; owner: string; repo: string; gitRef: string; label: string }) {
  const path = `${SPEC_DIR}/${figure.src}`;
  const file = useQuery(repoQueries.blob(owner, repo, gitRef, path));
  const url = file.data?.kind === "image" ? file.data.meta.download_url : null;
  return (
    <figure className="spec-diff-picture">
      <figcaption className="muted small">{label}</figcaption>
      {url !== null && url !== "" ? (
        <img src={url} alt={`${figure.alt ?? figure.caption ?? figure.src} (${label})`} loading="lazy" />
      ) : (
        <div className="spec-figure-missing muted small">{file.isPending ? "Loading picture…" : `Couldn't show ${figure.src}`}</div>
      )}
    </figure>
  );
}

function Figure({ change, sides }: { change: FigureChange; sides: Sides }) {
  const { before, after } = change;
  return (
    <div className="spec-diff-figure" data-kind={change.kind}>
      <div className="spec-req-head">
        <span className="mono small grow" style={{ overflowWrap: "anywhere" }}>
          {change.src}
        </span>
        <span className="spec-diff-kind" data-kind={change.kind}>
          {change.kind === "changed" && change.picture ? "Picture changed" : REQUIREMENT_KIND[change.kind]}
        </span>
      </div>
      {change.picture && (
        <div className="spec-diff-pictures">
          {before !== null && <Picture figure={before} owner={sides.owner} repo={sides.repo} gitRef={sides.base} label="Before" />}
          {after !== null && <Picture figure={after} owner={sides.owner} repo={sides.repo} gitRef={sides.head} label="After" />}
        </div>
      )}
      {before !== null && after !== null && before.caption !== after.caption && <TextChange before={before.caption} after={after.caption} />}
      {before !== null && after !== null && before.alt !== after.alt && <TextChange before={before.alt} after={after.alt} />}
    </div>
  );
}

const LIST_LABEL: Record<ListChange["field"], string> = { questions: "Open questions", code: "Code", related: "Related" };

function List({ change, action }: { change: ListChange; action: ReactNode }) {
  const mono = change.field !== "questions";
  return (
    <Section title={LIST_LABEL[change.field]} action={action}>
      <div className={mono ? "mono small" : undefined}>
        {change.removed.map((entry) => (
          <Line key={`-${entry}`} kind="removed" text={entry} />
        ))}
        {change.added.map((entry) => (
          <Line key={`+${entry}`} kind="added" text={entry} />
        ))}
      </div>
    </Section>
  );
}
