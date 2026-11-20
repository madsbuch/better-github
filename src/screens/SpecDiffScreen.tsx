import { ArrowLeftIcon, ChevronRightIcon, GitBranchIcon, GitCompareIcon, LockIcon, TriangleDownIcon } from "@primer/octicons-react";
import { useQuery } from "@tanstack/react-query";
import { getRouteApi, Link } from "@tanstack/react-router";
import { useMemo, useState, type ReactNode } from "react";
import { wordDiff, type Segment } from "../lib/diff";
import { to, useNav } from "../lib/nav";
import { useIsGuest } from "../lib/session";
import { SPEC_DIR, specTrail, type SpecFigure, type SpecRequirement, type SpecStatus } from "../lib/spec";
import { diffSpecs, type ChangeKind, type FieldChange, type FigureChange, type ItemChange, type ListChange, type RequirementChange, type SpecDiff } from "../lib/specDiff";
import { repoQueries } from "../queries/repos";
import { useSpec } from "../queries/spec";
import { BranchSheet } from "../components/BranchSheet";
import { CheckText } from "../components/ReviewRules";
import { Screen } from "../components/Screen";
import { CenterSpinner, EmptyState, ErrorView, SkeletonList } from "../components/ui";

const route = getRouteApi("/$owner/$repo/spec-diff");

interface Sides {
  owner: string;
  repo: string;
  base: string;
  head: string;
}

/** What changed in a repository's spec between two branches, by item and requirement. */
export function SpecDiffScreen() {
  const { owner, repo } = route.useParams();
  const search = route.useSearch();
  const nav = useNav();
  const guest = useIsGuest();
  const [picking, setPicking] = useState<"base" | "head" | null>(null);

  // Only needed for the default branch, when no base is given.
  const detail = useQuery({ ...repoQueries.detail(owner, repo), enabled: search.base === undefined });
  const base = search.base ?? detail.data?.repository?.defaultBranchRef?.name ?? "";
  const head = search.head ?? "";
  const before = useSpec(owner, repo, guest ? "" : base);
  const after = useSpec(owner, repo, guest ? "" : head);
  const ready = before.loaded && after.loaded;
  const diff = useMemo(() => (ready ? diffSpecs(before.spec, after.spec) : null), [ready, before.spec, after.spec]);
  const error = before.error ?? after.error;

  return (
    <Screen
      title="Spec changes"
      subtitle={`${owner}/${repo}`}
      onRefresh={async () => {
        before.retry();
        after.retry();
      }}
    >
      {guest ? (
        <EmptyState icon={<LockIcon size={32} />} title="Sign in to compare specs">
          Reading a repository's {SPEC_DIR} folder needs a GitHub account.
        </EmptyState>
      ) : base === "" ? (
        detail.isError ? (
          <ErrorView error={detail.error} onRetry={() => void detail.refetch()} />
        ) : detail.isPending ? (
          <CenterSpinner />
        ) : (
          <EmptyState title="This repository is empty" />
        )
      ) : (
        <>
          <div className="spec-diff-refs">
            <RefButton label="Base" value={base} onClick={() => setPicking("base")} />
            <ArrowLeftIcon size={16} className="c-muted" />
            <RefButton label="Compare" value={head} onClick={() => setPicking("head")} />
          </div>
          <BranchSheet
            open={picking !== null}
            onClose={() => setPicking(null)}
            owner={owner}
            repo={repo}
            current={picking === "base" ? base : head}
            title={picking === "base" ? "Base: the spec to compare against" : "Compare: the spec with the changes"}
            onSelect={(ref) => nav.replace(picking === "base" ? to.specDiff(owner, repo, ref, search.head) : to.specDiff(owner, repo, search.base, ref))}
          />
          {head === "" ? (
            <EmptyState icon={<GitCompareIcon size={32} />} title="Pick a branch to compare">
              See what its spec changes compared to {base}.
            </EmptyState>
          ) : error ? (
            <ErrorView
              error={error}
              onRetry={() => {
                before.retry();
                after.retry();
              }}
            />
          ) : diff === null ? (
            <SkeletonList />
          ) : before.spec === null && after.spec === null ? (
            <EmptyState title="No spec on either side">
              Neither {base} nor {head} has a <span className="mono">{SPEC_DIR}</span> folder.
            </EmptyState>
          ) : diff.items.length === 0 ? (
            <EmptyState title="The specs are the same">
              {head} changes nothing in the spec of {base}.
            </EmptyState>
          ) : (
            <>
              {(before.spec === null || after.spec === null) && (
                <div className="banner">
                  {before.spec === null ? `${base} has no spec: all of it is new on ${head}.` : `${head} has no spec: all of it is removed.`}
                </div>
              )}
              <Summary diff={diff} />
              {diff.items.map((item) => (
                <ItemCard key={item.id} change={item} sides={{ owner, repo, base, head }} />
              ))}
            </>
          )}
        </>
      )}
    </Screen>
  );
}

function RefButton({ label, value, onClick }: { label: string; value: string; onClick: () => void }) {
  return (
    <button className="btn btn-sm spec-diff-ref" onClick={onClick} aria-label={`${label}: ${value !== "" ? value : "pick a branch"}`}>
      <GitBranchIcon size={14} />
      <span className="ellipsis mono">{value !== "" ? value : "Pick a branch"}</span>
      <TriangleDownIcon size={14} />
    </button>
  );
}

const KIND_LABEL: Record<ChangeKind, string> = { added: "Added", removed: "Removed", changed: "Changed" };
const KIND_SIGN: Record<ChangeKind, string> = { added: "+", removed: "−", changed: "~" };

function Summary({ diff }: { diff: SpecDiff }) {
  const line = (counts: Record<ChangeKind, number>, noun: string) => {
    const total = counts.added + counts.removed + counts.changed;
    if (total === 0) return null;
    return (
      <span>
        <span className="bold">
          {total} {noun}
          {total === 1 ? "" : "s"}
        </span>{" "}
        {(["added", "changed", "removed"] as const)
          .filter((kind) => counts[kind] > 0)
          .map((kind) => (
            <span key={kind} className="spec-diff-count" data-kind={kind}>
              {KIND_SIGN[kind]}
              {counts[kind]}
            </span>
          ))}
      </span>
    );
  };
  return (
    <div className="spec-diff-summary">
      {line(diff.counts.items, "item")}
      {line(diff.counts.requirements, "requirement")}
    </div>
  );
}

// -------------------------------------------------------------------- item

function ItemCard({ change, sides }: { change: ItemChange; sides: Sides }) {
  // The side that has the item: the newer one unless it was removed.
  const node = change.after ?? change.before;
  if (node === null) return null;
  const ref = change.after !== null ? sides.head : sides.base;
  const trail = specTrail(node).slice(0, -1);
  const title = change.fields.find((field) => field.field === "title");
  const fields = change.fields.filter((field) => field.field !== "title" || change.kind === "changed");
  return (
    <article className="spec-diff-item" data-kind={change.kind} data-id={change.id}>
      <Link {...to.spec(sides.owner, sides.repo, ref, change.id)} className="spec-diff-item-head">
        <span className="grow" style={{ minWidth: 0 }}>
          {trail.length > 0 && <span className="row-meta ellipsis">{trail.map((n) => n.title).join(" / ")}</span>}
          <span className="spec-diff-item-title">{title?.after ?? title?.before ?? node.title}</span>
        </span>
        <span className="spec-diff-kind" data-kind={change.kind}>
          {KIND_LABEL[change.kind]}
        </span>
        <ChevronRightIcon size={16} className="c-muted" />
      </Link>
      {change.unreadable !== null ? (
        <p className="spec-diff-note">
          {change.unreadable.side === "after" ? `Can't be read on ${sides.head} any more` : `Couldn't be read on ${sides.base}; it can now`}:{" "}
          <span className="small">{change.unreadable.error}</span>
        </p>
      ) : (
        <>
          {fields.map((field) => (
            <Field key={field.field} change={field} whole={change.kind !== "changed"} />
          ))}
          {change.requirements.length > 0 && (
            <Section title="Requirements">
              {change.requirements.map((requirement) => (
                <Requirement key={requirement.id} change={requirement} />
              ))}
            </Section>
          )}
          {change.figures.length > 0 && (
            <Section title="Figures">
              {change.figures.map((figure) => (
                <Figure key={figure.src} change={figure} sides={sides} />
              ))}
            </Section>
          )}
          {change.lists.map((list) => (
            <List key={list.field} change={list} />
          ))}
        </>
      )}
    </article>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section aria-label={title}>
      <h3>{title}</h3>
      {children}
    </section>
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
};

const STATUS_LABEL: Record<SpecStatus, string> = { draft: "Draft", accepted: "Accepted", implemented: "Implemented", deprecated: "Deprecated" };
const isStatus = (value: string): value is SpecStatus => value in STATUS_LABEL;
const statusLabel = (value: string | undefined) => (value === undefined ? "none" : isStatus(value) ? STATUS_LABEL[value] : value);

/** A short value that changed, as "old → new". */
function Move({ label, before, after }: { label: string; before: string; after: string }) {
  return (
    <div className="spec-diff-move">
      <span className="muted">{label}</span> <del>{before}</del> <span aria-hidden>→</span> <ins>{after}</ins>
    </div>
  );
}

/** `whole`: the item itself was added or removed, so every field is on one side only. */
function Field({ change, whole }: { change: FieldChange; whole: boolean }) {
  const label = FIELD_LABEL[change.field];
  // A new or removed item has one status, not a move from or to nothing.
  if (change.field === "status" && (change.before === undefined || change.after === undefined) && whole) {
    return (
      <div className="spec-diff-move">
        <span className="muted">{label}</span> {statusLabel(change.after ?? change.before)}
      </div>
    );
  }
  if (change.field === "status") return <Move label={label} before={statusLabel(change.before)} after={statusLabel(change.after)} />;
  if (change.field === "order") return <Move label={label} before={change.before ?? "by title"} after={change.after ?? "by title"} />;
  return (
    <Section title={label}>
      <TextChange before={change.before} after={change.after} />
    </Section>
  );
}

const levelOf = (requirement: SpecRequirement) => requirement.level ?? "must";

function Requirement({ change }: { change: RequirementChange }) {
  const { before, after } = change;
  const shown = after ?? before;
  if (shown === null) return null;
  const moves =
    before !== null && after !== null ? (
      <>
        {levelOf(before) !== levelOf(after) && <Move label="Level" before={levelOf(before)} after={levelOf(after)} />}
        {before.status !== after.status && <Move label="Status" before={statusLabel(before.status)} after={statusLabel(after.status)} />}
      </>
    ) : null;
  return (
    <div className="spec-diff-req" data-kind={change.kind} data-req={change.id}>
      <div className="spec-req-head">
        <span className="spec-req-id">{change.id}</span>
        <span className="spec-level" data-level={levelOf(shown)}>
          {levelOf(shown)}
        </span>
        <span className="spec-diff-kind" data-kind={change.kind}>
          {KIND_LABEL[change.kind]}
        </span>
      </div>
      {before !== null && after !== null ? (
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
      {moves}
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
          {change.kind === "changed" && change.picture ? "Picture changed" : KIND_LABEL[change.kind]}
        </span>
      </div>
      {change.picture && (
        <div className="spec-diff-pictures">
          {before !== null && <Picture figure={before} owner={sides.owner} repo={sides.repo} gitRef={sides.base} label={`On ${sides.base}`} />}
          {after !== null && <Picture figure={after} owner={sides.owner} repo={sides.repo} gitRef={sides.head} label={`On ${sides.head}`} />}
        </div>
      )}
      {before !== null && after !== null && before.caption !== after.caption && <TextChange before={before.caption} after={after.caption} />}
      {before !== null && after !== null && before.alt !== after.alt && <TextChange before={before.alt} after={after.alt} />}
    </div>
  );
}

const LIST_LABEL: Record<ListChange["field"], string> = { questions: "Open questions", code: "Code", related: "Related" };

function List({ change }: { change: ListChange }) {
  const mono = change.field !== "questions";
  return (
    <Section title={LIST_LABEL[change.field]}>
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
