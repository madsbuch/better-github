// What changed in a spec, item by item (src/lib/specDiff.ts). The same cards
// show a comparison of two branches and, in a pull request's Files tab, the
// review of its spec files: there each card is one file, with its viewed
// state, and the comments on the file's lines shown at the requirement or
// field those lines belong to.
// Spec: SR1, SR3, SR5, SR11, SR13, SR15, SR17, D12

import { AlertIcon, CheckIcon, ChevronDownIcon, ChevronRightIcon, ArrowRightIcon, ColumnsIcon, CommentIcon, KebabHorizontalIcon, LinkExternalIcon, RowsIcon } from "@primer/octicons-react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { anchorKey, type Hunk, type Segment, type Side } from "../lib/diff";
import { to } from "../lib/nav";
import { setPref, useMediaQuery, usePrefs } from "../lib/prefs";
import { SPEC_DIR, specTrail, storySentence, type SpecFigure, type SpecRequirement, type SpecStatus, type SpecStory, type SpecValue } from "../lib/spec";
import { VALUE_TYPE_LABEL } from "../lib/specValues";
import type { ChangeKind, FieldChange, FigureChange, ItemChange, ItemKind, ListChange, RequirementChange, SpecDiff, StoryChange, ValueChange } from "../lib/specDiff";
import { commentLine, entrySpan, jsonLines, requirementSpan, type CommentLine, type LineSpan } from "../lib/specLines";
import { foldUnchanged, proseDiff, proseUnits, sideParts, type ProseBlock } from "../lib/specProse";
import { repoQueries } from "../queries/repos";
import { CheckText } from "./ReviewRules";
import { ValueText } from "./SpecValues";

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

/**
 * Set for a part that is new or gone as a whole. Its text is then simply its
 * text, to be read: marking every line of a new part as added says nothing
 * the card's "Added" doesn't.
 */
const WholeContext = createContext(false);

const KIND_LABEL: Record<ItemKind, string> = { added: "Added", removed: "Removed", changed: "Changed", moved: "Moved" };
const KIND_SIGN: Record<ItemKind, string> = { added: "+", removed: "−", changed: "~", moved: "→" };
const plural = (count: number, noun: string) => `${count} ${count === 1 ? noun : noun.endsWith("y") ? `${noun.slice(0, -1)}ies` : `${noun}s`}`;

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
    ...[...item.stories, ...item.requirements, ...item.values]
      .filter((r) => r.weakened !== null)
      .map((r) => ({ id: item.id, key: `${item.id}#${r.id}`, label: `${titleOf(item)} ${r.id}`, why: r.weakened ?? "" })),
  ]);
  return (
    <>
      <div className="spec-diff-summary">
        {line(diff.counts.items, ["added", "changed", "moved", "removed"] as const, "item")}
        {line(diff.counts.stories, ["added", "changed", "removed"] as const, "user story")}
        {line(diff.counts.requirements, ["added", "changed", "moved", "removed"] as const, "requirement")}
        {line(diff.counts.values, ["added", "changed", "removed"] as const, "value")}
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
  /** Laid out for reading prose rather than for comparing lines. */
  reading?: boolean | undefined;
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
  for (const entry of [...change.stories, ...change.requirements, ...change.values]) counts[entry.kind]++;
  const weakened = (change.weakened !== null ? 1 : 0) + [...change.stories, ...change.requirements, ...change.values].filter((r) => r.weakened !== null).length;

  return (
    <div className={`diff-file spec-change${viewed === true ? " viewed" : ""}${props.reading === true ? " reading" : ""}`} data-path={node.file ?? undefined} data-id={change.id} data-kind={change.kind}>
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
            <WholeContext.Provider value={change.kind === "added" || change.kind === "removed"}>
              <CardBody {...props} />
            </WholeContext.Provider>
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
  const node = change.after ?? change.before;
  // Where each part of the item is in its file, on each side.
  const lines = useMemo(() => {
    const [before, after] = [review?.text.before ?? null, review?.text.after ?? null];
    const [old, current] = [before === null ? null : jsonLines(before), after === null ? null : jsonLines(after)];
    return {
      field: (name: string): Spans => ({ before: old?.get(name) ?? null, after: current?.get(name) ?? null }),
      story: (id: string): Spans => ({
        before: before !== null && old !== null ? entrySpan(before, old, "stories", id) : null,
        after: after !== null && current !== null ? entrySpan(after, current, "stories", id) : null,
      }),
      value: (id: string): Spans => ({
        before: before !== null && old !== null ? entrySpan(before, old, "values", id) : null,
        after: after !== null && current !== null ? entrySpan(after, current, "values", id) : null,
      }),
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
      ...change.stories.map((story) => ({ key: `story:${story.id}`, spans: lines.story(story.id) })),
      ...[...change.requirements.map((r) => r.id), ...change.unchanged.map((r) => r.id)].map((id) => ({ key: `requirement:${id}`, spans: lines.requirement(id) })),
      ...change.values.map((value) => ({ key: `value:${value.id}`, spans: lines.value(value.id) })),
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
          <button
            className="icon-btn sm spec-comment-btn"
            aria-label={`Comment on ${label}`}
            // Where the comment lands: a line of the part's file, as in the pull request's Files tab.
            title={`Comment on line ${target.number} of ${node?.file ?? "the file"}`}
            onClick={() => review.onComment(target)}
          >
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
          {change.fields.length + change.stories.length + change.requirements.length + change.values.length + change.figures.length + change.lists.length === 0 && ", otherwise unchanged"}.
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
          {change.stories.length > 0 && (
            <Section title="User stories">
              {change.stories.map((story) => {
                const talk = discuss(`story:${story.id}`, lines.story(story.id), story.id);
                return <Story key={story.id} change={story} action={talk.button} comments={talk.comments} selected={talk.selected} />;
              })}
            </Section>
          )}
          {(change.requirements.length > 0 || change.unchanged.length > 0) && (
            <Section title="Requirements">
              {/* A part that is new or gone as a whole can have dozens: the first few, and the rest on demand. */}
              <Capped limit={whole ? WHOLE_SHOWN : Infinity} noun="requirement" open={change.requirements.some((r) => placed.byPart.has(`requirement:${r.id}`))}>
                {change.requirements.map((requirement) => {
                  const talk = discuss(`requirement:${requirement.id}`, lines.requirement(requirement.id), requirement.id);
                  return <Requirement key={requirement.id} change={requirement} action={talk.button} comments={talk.comments} selected={talk.selected} />;
                })}
              </Capped>
              <Unchanged requirements={change.unchanged} talk={(id) => discuss(`requirement:${id}`, lines.requirement(id), id)} discussed={(id) => placed.byPart.has(`requirement:${id}`)} />
            </Section>
          )}
          {change.values.length > 0 && (
            <Section title="Values">
              {change.values.map((value) => {
                const talk = discuss(`value:${value.id}`, lines.value(value.id), value.id);
                return <Value key={value.id} change={value} action={talk.button} comments={talk.comments} selected={talk.selected} />;
              })}
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

/** How many requirements of a part that is new or gone as a whole are shown before asking. */
const WHOLE_SHOWN = 6;

/** The first `limit` of its children, and a button for the rest. `open`: start with all of them. */
function Capped({ limit, noun, open: startOpen, children }: { limit: number; noun: string; open: boolean; children: ReactNode[] }) {
  const [open, setOpen] = useState(startOpen);
  // One more than the limit isn't worth a button.
  if (open || startOpen || children.length <= limit + 1) return <>{children}</>;
  return (
    <>
      {children.slice(0, limit)}
      <button className="spec-prose-fold" onClick={() => setOpen(true)} aria-expanded={false}>
        <ChevronRightIcon size={12} /> {plural(children.length - limit, `more ${noun}`)}
      </button>
    </>
  );
}

/** The requirements a change left alone, folded away: context for the ones it didn't. */
function Unchanged({
  requirements,
  talk,
  discussed: has,
}: {
  requirements: SpecRequirement[];
  /** The comments on one, and the button to add one where the pull request's diff reaches it. */
  talk: (id: string) => { button: ReactNode; comments: ReactNode; selected: boolean };
  discussed: (id: string) => boolean;
}) {
  const discussed = requirements.some((r) => has(r.id));
  const [open, setOpen] = useState(false);
  if (requirements.length === 0) return null;
  return (
    <>
      <button className="spec-unchanged-toggle" onClick={() => setOpen(!open)} aria-expanded={open || discussed}>
        {open || discussed ? <ChevronDownIcon size={14} /> : <ChevronRightIcon size={14} />} {plural(requirements.length, "unchanged requirement")}
      </button>
      {(open || discussed) &&
        requirements.map((requirement) => {
          // Folded, only the ones under discussion show.
          if (!open && !has(requirement.id)) return null;
          const own = talk(requirement.id);
          return (
            <div key={requirement.id} className="spec-diff-req" data-kind="unchanged" data-req={requirement.id} data-selected={own.selected}>
              <div className="spec-req-head">
                <span className="spec-req-id">{requirement.id}</span>
                <span className="spec-level" data-level={levelOf(requirement)}>
                  {levelOf(requirement)}
                </span>
                <span className="grow" />
                {own.button}
              </div>
              <div className="spec-diff-same">
                <CheckText text={requirement.text} />
              </div>
              {own.comments}
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

/** A reworded text's old side (what went out marked) or new side (what came in marked). */
function Marked({ block, side }: { block: Extract<ProseBlock, { kind: "changed" }>; side: "before" | "after" }) {
  return <>{sideParts(block.parts, side).map((part, i) => (part.marked ? <mark key={i}>{part.text}</mark> : <span key={i}>{part.text}</span>))}</>;
}

/** A row of a compared text: what a paragraph or list item was, and what it is. */
interface ProseRow {
  kind: "same" | "changed" | "added" | "removed" | "replaced";
  before: ProseBlock | null;
  after: ProseBlock | null;
}

/** Blocks as rows: something taken out next to something put in is one row, old beside new. */
function proseRows(blocks: ProseBlock[]): ProseRow[] {
  const rows: ProseRow[] = [];
  let index = 0;
  while (index < blocks.length) {
    const block = blocks[index];
    if (block === undefined) break;
    if (block.kind === "same" || block.kind === "changed") {
      rows.push({ kind: block.kind, before: block, after: block });
      index++;
      continue;
    }
    const run: ProseBlock[] = [];
    while (index < blocks.length && (blocks[index]?.kind === "removed" || blocks[index]?.kind === "added")) {
      const next = blocks[index];
      if (next !== undefined) run.push(next);
      index++;
    }
    const [removed, added] = [run.filter((b) => b.kind === "removed"), run.filter((b) => b.kind === "added")];
    for (let k = 0; k < Math.max(removed.length, added.length); k++) {
      const [before, after] = [removed[k] ?? null, added[k] ?? null];
      rows.push({ kind: before !== null && after !== null ? "replaced" : before !== null ? "removed" : "added", before, after });
    }
  }
  return rows;
}

function Cell({ block, side, kind }: { block: ProseBlock | null; side: "before" | "after"; kind: ProseRow["kind"] }) {
  if (block === null) return <div className="spec-split-cell" data-side={side} data-kind="none" aria-hidden />;
  const state = kind === "same" ? "same" : side === "before" ? "removed" : "added";
  return (
    <div className="spec-split-cell" data-side={side} data-kind={state} data-list={block.list}>
      {block.kind === "changed" ? <Marked block={block} side={side} /> : <CheckText text={block.text} />}
    </div>
  );
}

/** One column: a reworded text reads as one text, with what went out struck through and what came in marked. */
function UnifiedRow({ row }: { row: ProseRow }) {
  const one = (block: ProseBlock, kind: "same" | "added" | "removed") => (
    <div className="spec-prose-block" data-kind={kind} data-list={block.list}>
      <CheckText text={block.text} />
    </div>
  );
  if (row.before !== null && row.before.kind === "changed") {
    return (
      <div className="spec-prose-block spec-diff-inline" data-kind="changed" data-list={row.before.list}>
        {row.before.parts.map((part, i) => (part.kind === "del" ? <del key={i}>{part.text}</del> : part.kind === "ins" ? <ins key={i}>{part.text}</ins> : <span key={i}>{part.text}</span>))}
      </div>
    );
  }
  if (row.kind === "same" && row.after !== null) return one(row.after, "same");
  return (
    <>
      {row.before !== null && one(row.before, "removed")}
      {row.after !== null && one(row.after, "added")}
    </>
  );
}

function ProseRows({ rows, split }: { rows: ProseRow[]; split: boolean }) {
  return (
    <>
      {rows.map((row, i) =>
        split ? (
          <div key={i} className="spec-split-row" data-kind={row.kind}>
            <Cell block={row.before} side="before" kind={row.kind} />
            <Cell block={row.after} side="after" kind={row.kind} />
          </div>
        ) : (
          <UnifiedRow key={i} row={row} />
        ),
      )}
    </>
  );
}

/** Unchanged paragraphs away from any change, folded: there to open, not to wade through. */
function ProseFold({ blocks, split }: { blocks: ProseBlock[]; split: boolean }) {
  const [open, setOpen] = useState(false);
  if (open) return <ProseRows rows={proseRows(blocks)} split={split} />;
  return (
    <button className="spec-prose-fold" onClick={() => setOpen(true)} aria-expanded={false}>
      <ChevronRightIcon size={12} /> {plural(blocks.length, "unchanged paragraph")}
    </button>
  );
}

/** Whether a change to the spec's text shows the old beside the new: the preference, in a window with room for it. */
function useSplitSpec(): boolean {
  const wide = useMediaQuery(SPLIT_SPEC_QUERY);
  return usePrefs().splitDiff && wide;
}

/** From this width, a sentence has room next to what it used to say. */
export const SPLIT_SPEC_QUERY = "(min-width: 900px)";

/** App bar button: old beside new, or one column. Only where there is room for the choice. */
export function SpecLayoutButton() {
  const prefs = usePrefs();
  const wide = useMediaQuery(SPLIT_SPEC_QUERY);
  if (!wide) return null;
  const split = prefs.splitDiff;
  return (
    <button className="icon-btn" aria-label={split ? "Show in one column" : "Show side by side"} onClick={() => setPref("splitDiff", !split)}>
      {split ? <RowsIcon size={18} /> : <ColumnsIcon size={18} />}
    </button>
  );
}

/**
 * A text of the spec compared with what it was, as prose: paragraph by
 * paragraph and list item by list item, each one unchanged, reworded (the
 * words that changed marked), new or taken out. In a wide window the old
 * is beside the new.
 */
function Prose({ before, after }: { before: string | undefined; after: string | undefined }) {
  const split = useSplitSpec();
  const stretches = useMemo(() => foldUnchanged(proseDiff(before, after)), [before, after]);
  return (
    <div className={split ? "spec-prose spec-split" : "spec-prose"}>
      {stretches.map((stretch, i) => (stretch.fold ? <ProseFold key={i} blocks={stretch.blocks} split={split} /> : <ProseRows key={i} rows={proseRows(stretch.blocks)} split={split} />))}
    </div>
  );
}

/** Longer than this, a text that is only there to be read starts shortened. */
const PLAIN_CHARS = 420;

/** A text as it reads, with its paragraphs and lists; a long one starts shortened. */
function PlainProse({ text }: { text: string }) {
  const rows = useMemo(() => proseRows(proseUnits(text).map((unit): ProseBlock => ({ kind: "same", ...unit }))), [text]);
  const long = text.length > PLAIN_CHARS;
  const [open, setOpen] = useState(false);
  return (
    <div className="spec-prose">
      <div className={long && !open ? "spec-prose-clamp" : undefined}>
        <ProseRows rows={rows} split={false} />
      </div>
      {long && (
        <button className="spec-prose-fold" onClick={() => setOpen(!open)} aria-expanded={open}>
          {open ? <ChevronDownIcon size={12} /> : <ChevronRightIcon size={12} />} {open ? "Show less" : "Show all of it"}
        </button>
      )}
    </div>
  );
}

/** Text that changed. */
function TextChange({ before, after }: { before: string | undefined; after: string | undefined }) {
  const whole = useContext(WholeContext);
  // Part of something new or gone as a whole: nothing to compare it with, so it is simply read.
  if (whole) return <PlainProse text={after ?? before ?? ""} />;
  return <Prose before={before} after={after} />;
}

const FIELD_LABEL: Record<FieldChange["field"], string> = {
  title: "Title",
  summary: "Summary",
  status: "Status",
  description: "Description",
  order: "Position",
  deprecation: "Why it is deprecated",
};

const STATUS_LABEL: Record<SpecStatus, string> = { draft: "Draft", accepted: "Accepted", deprecated: "Deprecated" };
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

/** A named value that changed: what it was beside what it is, as each looks. */
function Value({ change, action, comments, selected }: { change: ValueChange; action: ReactNode; comments: ReactNode; selected: boolean }) {
  const { before, after } = change;
  const shown = after ?? before;
  const whole = useContext(WholeContext);
  if (shown === null) return null;
  const is = (value: SpecValue) => JSON.stringify([value.value, value.type === "color" ? value.dark : null, value.type === "number" ? value.unit : null]);
  const differs = before !== null && after !== null && is(before) !== is(after);
  return (
    <div className="spec-diff-req spec-diff-value" data-kind={change.kind} data-value={change.id} data-selected={selected}>
      <div className="spec-req-head">
        <span className="spec-req-id">{change.id}</span>
        <span className="spec-val-type">{VALUE_TYPE_LABEL[shown.type]}</span>
        <span className="grow" />
        {change.weakened !== null && (
          <span className="spec-diff-kind" data-kind="weakened" title={change.weakened}>
            <AlertIcon size={12} /> Takes away
          </span>
        )}
        {!whole && (
          <span className="spec-diff-kind" data-kind={change.kind}>
            {REQUIREMENT_KIND[change.kind]}
          </span>
        )}
        {action}
      </div>
      {differs ? (
        <div className="spec-value-move">
          <span className="spec-value-was">
            <ValueText value={before} />
          </span>
          <ArrowRightIcon size={14} className="c-muted" />
          <span className="spec-value-now">
            <ValueText value={after} />
          </span>
        </div>
      ) : (
        <div className="spec-value-move" data-kind={whole ? undefined : change.kind}>
          <ValueText value={shown} />
        </div>
      )}
      {change.reason !== null && (
        <div className="spec-diff-same small">
          <span className="bold">Why it changed</span> <CheckText text={change.reason} />
        </div>
      )}
      {change.unexplained && <div className="spec-diff-same small spec-same-version">Nothing says why it changed. Add what it was, and the reason, to its history.</div>}
      {before !== null && after !== null && before.description !== after.description && <TextChange before={before.description} after={after.description} />}
      {(before === null || after === null) && shown.description !== undefined && (
        <div className="spec-diff-same small">
          <CheckText text={shown.description} />
        </div>
      )}
      {before !== null && after !== null && before.status !== after.status && (
        <Move label="Status" before={before.status === undefined ? "its item's" : statusLabel(before.status)} after={after.status === undefined ? "its item's" : statusLabel(after.status)} />
      )}
      {after?.deprecation !== undefined && before?.deprecation?.reason !== after.deprecation.reason && (
        <div className="spec-diff-same small">
          <span className="bold">Why it is deprecated</span> <CheckText text={after.deprecation.reason} />
        </div>
      )}
      {change.weakened !== null && after === null && <div className="spec-weakened-note small">{change.weakened}</div>}
      {comments}
    </div>
  );
}

function Story({ change, action, comments, selected }: { change: StoryChange; action: ReactNode; comments: ReactNode; selected: boolean }) {
  const { before, after } = change;
  const shown = after ?? before;
  if (shown === null) return null;
  const [was, is] = [before === null ? null : storySentence(before), after === null ? null : storySentence(after)];
  const refs = (story: SpecStory) => (story.requirements ?? []).map((ref) => ref.replace(/^#/, "")).join(", ");
  const whole = useContext(WholeContext);
  return (
    <div className="spec-diff-req spec-diff-story" data-kind={change.kind} data-story={change.id} data-selected={selected}>
      <div className="spec-req-head">
        <span className="spec-req-id">{change.id}</span>
        <span className="grow" />
        {change.weakened !== null && (
          <span className="spec-diff-kind" data-kind="weakened" title={change.weakened}>
            <AlertIcon size={12} /> Takes away
          </span>
        )}
        {!whole && (
          <span className="spec-diff-kind" data-kind={change.kind}>
            {REQUIREMENT_KIND[change.kind]}
          </span>
        )}
        {action}
      </div>
      {whole ? (
        <div className="spec-diff-same spec-whole-text">
          <PlainProse text={storySentence(shown)} />
        </div>
      ) : was !== null && is !== null ? (
        was !== is ? (
          <TextChange before={was} after={is} />
        ) : (
          <div className="spec-diff-same">
            <CheckText text={is} />
          </div>
        )
      ) : (
        <Line kind={after !== null ? "added" : "removed"} text={storySentence(shown)} />
      )}
      {before !== null && after !== null && (
        <>
          {refs(before) !== refs(after) && <Move label="Made true by" before={refs(before) === "" ? "nothing" : refs(before)} after={refs(after) === "" ? "nothing" : refs(after)} />}
          {before.status !== after.status && (
            <Move label="Status" before={before.status === undefined ? "its item's" : statusLabel(before.status)} after={after.status === undefined ? "its item's" : statusLabel(after.status)} />
          )}
        </>
      )}
      {(before === null || after === null) && refs(shown) !== "" && (
        <div className="spec-diff-same small">
          <span className="bold">Made true by</span> <span className="mono">{refs(shown)}</span>
        </div>
      )}
      {after?.deprecation !== undefined && before?.deprecation?.reason !== after.deprecation.reason && (
        <div className="spec-diff-same small">
          <span className="bold">Why it is deprecated</span> <CheckText text={after.deprecation.reason} />
        </div>
      )}
      {comments}
    </div>
  );
}

function Requirement({ change, action, comments, selected }: { change: RequirementChange; action: ReactNode; comments: ReactNode; selected: boolean }) {
  const whole = useContext(WholeContext);
  const { before, after } = change;
  const shown = after ?? before;
  if (shown === null) return null;
  return (
    <div className="spec-diff-req" data-kind={change.kind} data-req={change.id} data-selected={selected} data-whole={whole}>
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
        {/* In a part that is new or gone as a whole, every requirement is: no need to say so on each. */}
        {(!whole || change.moved !== null) && (
          <span className="spec-diff-kind" data-kind={change.moved !== null ? "moved" : change.kind}>
            {change.moved !== null ? "Moved" : REQUIREMENT_KIND[change.kind]}
          </span>
        )}
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
      ) : whole ? (
        <div className="spec-diff-same spec-whole-text">
          <PlainProse text={shown.text} />
        </div>
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
          {before.status !== after.status && (
            // Without one of its own, a requirement has its item's status.
            <Move label="Status" before={before.status === undefined ? "its item's" : statusLabel(before.status)} after={after.status === undefined ? "its item's" : statusLabel(after.status)} />
          )}
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

const LIST_LABEL: Record<ListChange["field"], string> = { related: "Related" };

function List({ change, action }: { change: ListChange; action: ReactNode }) {
  return (
    <Section title={LIST_LABEL[change.field]} action={action}>
      <div className="mono small">
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
