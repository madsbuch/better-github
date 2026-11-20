import {
  AlertIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  CodeIcon,
  CopyIcon,
  FileDirectoryFillIcon,
  FileIcon,
  GitCompareIcon,
  LockIcon,
  NoteIcon,
  PencilIcon,
  SearchIcon,
  XIcon,
} from "@primer/octicons-react";
import { useQuery } from "@tanstack/react-query";
import { getRouteApi, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { to, useNav } from "../lib/nav";
import { useIsGuest } from "../lib/session";
import {
  isSpecPattern,
  requirementStatus,
  requirementVersion,
  resolveSpecRef,
  searchSpec,
  SPEC_DIR,
  specCounts,
  specFilesAround,
  specTextBlocks,
  specTrail,
  splitSpecRef,
  unloadedBelow,
  type Spec,
  type SpecDeprecation,
  type SpecFigure,
  type SpecNode,
  type SpecRequirement,
  type SpecStatus,
} from "../lib/spec";
import { repoQueries } from "../queries/repos";
import { useCopySpecPrompt, useSpec, useSpecContents, type LoadedSpec } from "../queries/spec";
import { applyRework, useSpecRework } from "../lib/specRework";
import { BranchBar } from "../components/RepoParts";
import { CheckText } from "../components/ReviewRules";
import { Screen } from "../components/Screen";
import { CenterSpinner, EmptyState, ErrorView, LoadMore, SkeletonList } from "../components/ui";
import { AddItem, AddRequirement, ItemTools, RequirementTools, ReworkBar, ReworkContext, useReworking, type Reworking } from "./spec/Rework";

const route = getRouteApi("/$owner/$repo/spec");

/** Where the spec being browsed lives: every link inside it stays on the same branch. */
interface Place {
  owner: string;
  repo: string;
  gitRef: string;
}

export function SpecScreen() {
  const { owner, repo } = route.useParams();
  const search = route.useSearch();
  const nav = useNav();
  const guest = useIsGuest();
  const id = search.id ?? "";

  // Only needed to resolve the default branch when no ref is given.
  const detail = useQuery({ ...repoQueries.detail(owner, repo), enabled: search.ref === undefined });
  const gitRef = search.ref ?? detail.data?.repository?.defaultBranchRef?.name ?? "";
  // Reading the folder in one request needs GitHub's GraphQL API, which needs a token.
  const loaded = useSpec(owner, repo, guest ? "" : gitRef);
  // Reworking: the spec is shown with the changes made here, which stay on the device until they are handed to an agent.
  const rework = useSpecRework(owner, repo, gitRef);
  const [original, files] = [loaded.spec, loaded.files];
  const reworked = useMemo(
    () => (rework.draft.active && original !== null && files !== null ? applyRework(files, original, rework.draft) : null),
    [rework.draft, original, files],
  );
  const reworking = useMemo(
    (): Reworking | null => (reworked !== null && original !== null ? { rework, original, reworked, owner, repo, gitRef } : null),
    [rework, original, reworked, owner, repo, gitRef],
  );
  // A change the repository has caught up with (the agent's pull request merged, or it was undone) is no longer a change.
  const settled = reworked?.settled;
  useEffect(() => {
    settled?.forEach((item) => rework.setItem(item, null));
  }, [settled, rework]);
  const spec = reworked?.spec ?? loaded.spec;
  const node = spec?.nodes.get(id) ?? null;
  const place: Place = { owner, repo, gitRef };
  // What this page shows: the item, the folders above it, what it links to. Its children ask for themselves as they show.
  const around = useMemo(() => {
    if (node === null || spec === null) return [];
    const related = (node.item?.related ?? []).flatMap((ref) => resolveSpecRef(spec, ref)?.node ?? spec.nodes.get(splitSpecRef(ref).id) ?? []);
    return [node, ...specFilesAround(node).filter((n) => n.parent !== node), ...related];
  }, [spec, node]);
  useSpecContents(loaded, around);
  const copyPrompt = useCopySpecPrompt();

  return (
    <Screen
      title={node !== null && id !== "" ? node.title : "Spec"}
      subtitle={`${owner}/${repo}${gitRef !== "" ? ` · ${gitRef}` : ""}`}
      footer={reworking !== null && <ReworkBar state={reworking} onDone={() => rework.setActive(false)} />}
      actions={
        <>
          {!guest && original !== null && (
            <button
              className={`icon-btn${rework.draft.active ? " on" : ""}`}
              aria-label={rework.draft.active ? "Stop reworking the spec" : "Rework the spec"}
              aria-pressed={rework.draft.active}
              onClick={() => rework.setActive(!rework.draft.active)}
            >
              <PencilIcon size={18} />
            </button>
          )}
          {!guest && gitRef !== "" && (
            // From the default branch to the one being read; either side can be changed there.
            <Link {...to.specDiff(owner, repo, undefined, search.ref)} className="icon-btn" aria-label="Compare with another branch">
              <GitCompareIcon size={18} />
            </Link>
          )}
          {node !== null && node.file !== null && (
            <Link {...to.blob(owner, repo, gitRef, node.file)} className="icon-btn" aria-label="View source">
              <CodeIcon size={18} />
            </Link>
          )}
        </>
      }
      onRefresh={async () => loaded.retry()}
    >
      {guest ? (
        <EmptyState icon={<LockIcon size={32} />} title="Sign in to browse the spec">
          Reading a repository's {SPEC_DIR} folder needs a GitHub account.
        </EmptyState>
      ) : gitRef === "" ? (
        detail.isError ? (
          <ErrorView error={detail.error} onRetry={() => void detail.refetch()} />
        ) : detail.isPending ? (
          <CenterSpinner />
        ) : (
          <EmptyState title="This repository is empty" />
        )
      ) : loaded.error ? (
        <ErrorView error={loaded.error} onRetry={loaded.retry} />
      ) : loaded.isPending ? (
        <SkeletonList />
      ) : (
        <>
          {id === "" && <BranchBar owner={owner} repo={repo} gitRef={gitRef} onChange={(ref) => nav.replace(to.spec(owner, repo, ref))} />}
          {spec === null ? (
            <>
              <EmptyState icon={<NoteIcon size={32} />} title="No spec here">
                {gitRef} has no <span className="mono">{SPEC_DIR}</span> folder. A spec is a folder of JSON files, one per part of the product, saying what
                the code is meant to do. A coding agent can write one for you.
              </EmptyState>
              <div style={{ textAlign: "center" }}>
                <button className="btn" onClick={() => void copyPrompt(owner, repo, gitRef)}>
                  <CopyIcon size={14} /> Copy agent prompt
                </button>
              </div>
            </>
          ) : node === null ? (
            <EmptyState title="Not in the spec">
              Nothing on {gitRef} is called <span className="mono">{id}</span>. <Link {...to.spec(owner, repo, gitRef)}>Open the outline</Link>
            </EmptyState>
          ) : (
            <ReworkContext.Provider value={reworking}>
              {id === "" ? (
                <Outline spec={spec} loaded={loaded} place={place} initialFilter={search.q ?? ""} />
              ) : (
                <>
                  <Trail node={node} place={place} />
                  {node.loaded ? <Item spec={spec} node={node} place={place} current={search.r} /> : <SkeletonList rows={4} />}
                  <Children node={node} loaded={loaded} place={place} heading="In this part" />
                </>
              )}
            </ReworkContext.Provider>
          )}
          {loaded.contentsError !== null && (
            <div className="banner banner-danger">
              <span className="grow">Some items couldn't be read.</span>
              <button className="btn btn-sm" onClick={loaded.retry}>
                Retry
              </button>
            </div>
          )}
        </>
      )}
    </Screen>
  );
}

// ----------------------------------------------------------------- outline

/** The spec's first page: what it is, a filter over everything in it, and its top-level parts. */
function Outline({ spec, loaded, place, initialFilter }: { spec: Spec; loaded: LoadedSpec; place: Place; initialFilter: string }) {
  const nav = useNav();
  const [filter, setFilter] = useState(initialFilter);
  const filtering = filter.trim() !== "";
  // Filtering looks at every item, so a large spec is read in full the first time it is filtered.
  const unread = useMemo(() => (filtering ? unloadedBelow(spec.root) : []), [filtering, spec]);
  useSpecContents(loaded, unread);
  const [shown, setShown] = useState(PAGE);
  // The filter is in the URL too, so coming back from a result shows the results again.
  const change = (next: string) => {
    setFilter(next);
    nav.replace(to.spec(place.owner, place.repo, place.gitRef, undefined, next));
  };
  const matches = searchSpec(spec, filter);
  const counts = specCounts(spec.root);

  return (
    <>
      <div className="search-bar">
        <SearchIcon size={16} />
        <input
          type="search"
          placeholder="Filter the spec"
          aria-label="Filter the spec"
          value={filter}
          onChange={(e) => change(e.target.value)}
          autoCapitalize="off"
          autoCorrect="off"
          enterKeyHint="search"
        />
        {filter !== "" && (
          <button className="icon-btn sm" aria-label="Clear" onClick={() => change("")}>
            <XIcon size={14} />
          </button>
        )}
      </div>
      {filtering && unread.length > 0 && (
        <p className="spec-counts muted small" role="status">
          Reading the spec: {(counts.items - unread.length).toLocaleString()} of {plural(counts.items, "item")} so far…
        </p>
      )}
      {filtering ? (
        matches.length === 0 ? (
          unread.length > 0 ? null : (
            <EmptyState title="Nothing matches">No item or requirement contains “{filter.trim()}”.</EmptyState>
          )
        ) : (
          matches.slice(0, shown).map(({ node, requirements }) =>
            requirements.length === 0 ? (
              <NodeRow key={node.id} node={node} place={place} showPath />
            ) : (
              requirements.map((requirement) => (
                <Link key={`${node.id}#${requirement.id}`} {...to.spec(place.owner, place.repo, place.gitRef, `${node.id}#${requirement.id}`)} className="row spec-row">
                  <span className="row-body">
                    <span className="row-meta">
                      <span className="spec-req-id">{requirement.id}</span>
                      <span className="ellipsis">{specTrail(node).map((n) => n.title).join(" / ")}</span>
                    </span>
                    <span className="spec-row-summary">
                      <CheckText text={requirement.text} />
                    </span>
                  </span>
                </Link>
              ))
            ),
          )
        )
      ) : null}
      {filtering && <LoadMore hasMore={matches.length > shown} loading={false} onLoadMore={() => setShown(shown + PAGE)} />}
      {filtering ? null : (
        <>
          <Problems spec={spec} place={place} />
          <Item spec={spec} node={spec.root} place={place} current={undefined} />
          <p className="spec-counts muted small">
            {plural(counts.items, "item")}
            {/* Requirements are counted once everything is read; a large spec is read as it is looked at. */}
            {counts.unloaded === 0 && ` · ${plural(counts.requirements, "requirement")}`}
            {counts.unloaded === 0 && counts.requirements > 0 && ` · ${counts.implemented} implemented`}
            {counts.unloaded === 0 && counts.deprecated > 0 && ` · ${counts.deprecated} deprecated`}
          </p>
          <Children node={spec.root} loaded={loaded} place={place} heading="Parts" />
        </>
      )}
    </>
  );
}

const plural = (count: number, noun: string) => `${count.toLocaleString()} ${noun}${count === 1 ? "" : "s"}`;

/** Lists show this many rows at a time: a folder can hold thousands of items. */
const PAGE = 100;

/** Files that couldn't be read and references that lead nowhere. */
function Problems({ spec, place }: { spec: Spec; place: Place }) {
  const copyPrompt = useCopySpecPrompt();
  if (spec.problems.length === 0) return null;
  return (
    <div className="banner banner-attention spec-problems">
      <AlertIcon size={16} className="c-attention" />
      <div className="grow" style={{ minWidth: 0 }}>
        <div className="bold">{plural(spec.problems.length, "problem")} in this spec</div>
        <ul>
          {spec.problems.map((problem, i) => (
            <li key={i}>
              <Link {...to.blob(place.owner, place.repo, place.gitRef, problem.file)} className="mono small">
                {problem.file.slice(SPEC_DIR.length + 1)}
              </Link>{" "}
              <span className="small">{problem.message}</span>
            </li>
          ))}
        </ul>
        {/* The prompt lists these problems for the agent to fix. */}
        <button className="btn btn-sm" style={{ marginTop: 8 }} onClick={() => void copyPrompt(place.owner, place.repo, place.gitRef)}>
          <CopyIcon size={14} /> Copy agent prompt
        </button>
      </div>
    </div>
  );
}

function Trail({ node, place }: { node: SpecNode; place: Place }) {
  const trail = specTrail(node);
  return (
    <nav className="breadcrumbs" aria-label="Path in the spec">
      <Link {...to.spec(place.owner, place.repo, place.gitRef)}>Spec</Link>
      {trail.map((part, i) => (
        <span key={part.id} className="row-flex" style={{ gap: 4 }}>
          <span className="sep">/</span>
          {i === trail.length - 1 ? <span className="bold">{part.title}</span> : <Link {...to.spec(place.owner, place.repo, place.gitRef, part.id)}>{part.title}</Link>}
        </span>
      ))}
    </nav>
  );
}

// -------------------------------------------------------------------- item

const STATUS_LABEL: Record<SpecStatus, string> = { draft: "Draft", accepted: "Accepted", implemented: "Implemented", deprecated: "Deprecated" };
const STATUS_PILL: Record<SpecStatus, string> = {
  draft: "pill",
  accepted: "pill pill-accent",
  implemented: "pill pill-success",
  deprecated: "pill pill-attention",
};

function StatusPill({ status }: { status: SpecStatus }) {
  return <span className={`${STATUS_PILL[status]} spec-status`}>{STATUS_LABEL[status]}</span>;
}

function SpecText({ text }: { text: string }) {
  return (
    <>
      {specTextBlocks(text).map((block, i) =>
        block.kind === "list" ? (
          <ul key={i}>
            {block.items.map((item, j) => (
              <li key={j}>
                <CheckText text={item} />
              </li>
            ))}
          </ul>
        ) : (
          <p key={i}>
            <CheckText text={block.text} />
          </p>
        ),
      )}
    </>
  );
}

/** One item: what it says, its requirements, pictures, open questions and where it lives in the code. */
function Item({ spec, node, place, current }: { spec: Spec; node: SpecNode; place: Place; current: string | undefined }) {
  const item = node.item;
  const requirements = item?.requirements ?? [];
  const figures = item?.figures ?? [];
  const questions = item?.questions ?? [];
  const code = item?.code ?? [];
  const related = item?.related ?? [];

  const reworking = useReworking() !== null;
  const isDeprecated = (requirement: SpecRequirement) => requirementStatus(item, requirement) === "deprecated";
  const live = requirements.filter((requirement) => !isDeprecated(requirement));
  const deprecated = requirements.filter(isDeprecated);
  const [showDeprecated, setShowDeprecated] = useState(false);
  // Folded away unless asked for, or it's the requirement this page was opened at.
  const deprecatedOpen = showDeprecated || reworking || deprecated.some((requirement) => requirement.id === current);

  // Opened at one requirement (from a search result or another item): bring it into view.
  useEffect(() => {
    if (current === undefined) return;
    document.querySelector(`.spec-req[data-current="true"]`)?.scrollIntoView({ block: "center" });
  }, [current, node.id]);

  return (
    <article className="spec-item">
      <header>
        <h2>
          {node.title} {item?.status !== undefined && <StatusPill status={item.status} />}
        </h2>
        {item?.summary !== undefined && item.summary !== "" && <p className="spec-summary">
            <CheckText text={item.summary} />
          </p>}
      </header>
      <ItemTools node={node} />
      {node.error !== null && node.file !== null && (
        <div className="banner banner-danger" style={{ margin: "12px 0" }}>
          <AlertIcon size={16} className="c-danger" />
          <div className="grow" style={{ minWidth: 0 }}>
            <div className="bold">This item couldn't be read</div>
            <div className="small" style={{ overflowWrap: "anywhere" }}>
              {node.error}
            </div>
            <Link {...to.blob(place.owner, place.repo, place.gitRef, node.file)} className="small">
              Open {node.file}
            </Link>
          </div>
        </div>
      )}
      {item?.status === "deprecated" && (
        <div className="banner banner-attention spec-deprecation" style={{ margin: "12px 0" }}>
          <div className="grow" style={{ minWidth: 0 }}>
            <div className="bold">This part is deprecated</div>
            <Deprecation spec={spec} place={place} deprecation={item.deprecation} />
          </div>
        </div>
      )}
      {item?.description !== undefined && <SpecText text={item.description} />}
      {figures.map((figure) => (
        <Figure key={figure.src} figure={figure} place={place} />
      ))}
      {(live.length > 0 || (reworking && item !== null)) && (
        <section aria-label="Requirements">
          <h3>Requirements</h3>
          {live.map((requirement) => (
            <Requirement key={requirement.id} spec={spec} place={place} node={node} requirement={requirement} inherited={item?.status} current={requirement.id === current} />
          ))}
          <AddRequirement node={node} />
        </section>
      )}
      {deprecated.length > 0 && (
        // No longer wanted, and kept: that they existed, were dropped, and why.
        <section aria-label="Deprecated requirements">
          <button className="spec-unchanged-toggle spec-deprecated-toggle" onClick={() => setShowDeprecated(!deprecatedOpen)} aria-expanded={deprecatedOpen}>
            {deprecatedOpen ? <ChevronDownIcon size={14} /> : <ChevronRightIcon size={14} />} {plural(deprecated.length, "deprecated requirement")}
          </button>
          {deprecatedOpen &&
            deprecated.map((requirement) => (
              <Requirement key={requirement.id} spec={spec} place={place} node={node} requirement={requirement} inherited={item?.status} current={requirement.id === current} />
            ))}
        </section>
      )}
      {questions.length > 0 && (
        <section aria-label="Open questions">
          <h3>Open questions</h3>
          <ul className="spec-questions">
            {questions.map((question, i) => (
              <li key={i}>
                <CheckText text={question} />
              </li>
            ))}
          </ul>
        </section>
      )}
      {code.length > 0 && (
        <section aria-label="Code">
          <h3>Code</h3>
          <div className="spec-links">
            {code.map((path) =>
              isSpecPattern(path) ? (
                <span key={path} className="spec-link mono">
                  <SearchIcon size={14} className="c-muted" />
                  <span className="grow">{path}</span>
                </span>
              ) : (
                <Link key={path} {...codeTarget(place, path)} className="spec-link mono">
                  {isFolder(path) ? <FileDirectoryFillIcon size={14} className="c-accent" /> : <FileIcon size={14} className="c-muted" />}
                  <span className="grow">{path}</span>
                  <ChevronRightIcon size={14} className="c-muted" />
                </Link>
              ),
            )}
          </div>
        </section>
      )}
      {related.length > 0 && (
        <section aria-label="Related">
          <h3>Related</h3>
          <div className="spec-links">
            {related.map((ref) => {
              const target = resolveSpecRef(spec, ref);
              return target === null ? (
                <span key={ref} className="spec-link muted">
                  <span className="grow mono">{ref}</span>
                  <span className="small">not in the spec</span>
                </span>
              ) : (
                <Link
                  key={ref}
                  // By where it is now: a requirement named by its id alone may be in any item.
                  {...to.spec(place.owner, place.repo, place.gitRef, target.requirement ? `${target.node.id}#${target.requirement.id}` : target.node.id)}
                  className="spec-link"
                >
                  {target.requirement !== null && <span className="spec-req-id">{target.requirement.id}</span>}
                  <span className="grow">
                    <span className="bold">{target.node.title}</span>
                    {target.requirement !== null && (
                      <span className="spec-row-summary">
                        <CheckText text={target.requirement.text} />
                      </span>
                    )}
                  </span>
                  <ChevronRightIcon size={14} className="c-muted" />
                </Link>
              );
            })}
          </div>
        </section>
      )}
    </article>
  );
}

/** A path with no file extension is taken to be a folder. */
const isFolder = (path: string) => path.endsWith("/") || !(path.split("/").pop() ?? "").includes(".");

function codeTarget(place: Place, path: string) {
  return isFolder(path) ? to.tree(place.owner, place.repo, place.gitRef, path.replace(/\/+$/, "")) : to.blob(place.owner, place.repo, place.gitRef, path);
}

/** Why something was deprecated, when, and what took its place. */
function Deprecation({ spec, place, deprecation }: { spec: Spec; place: Place; deprecation: SpecDeprecation | undefined }) {
  if (deprecation === undefined) return <div className="small muted">No reason is given.</div>;
  const replacedBy = deprecation.replacedBy ?? [];
  return (
    <div className="spec-deprecation-why">
      <SpecText text={deprecation.reason} />
      {(replacedBy.length > 0 || deprecation.date !== undefined) && (
        <div className="small muted">
          {deprecation.date !== undefined && <span>Since {deprecation.date}. </span>}
          {replacedBy.length > 0 && (
            <span>
              Replaced by{" "}
              {replacedBy.map((ref, i) => {
                const target = resolveSpecRef(spec, ref);
                const label = target?.requirement?.id ?? target?.node.title ?? ref;
                return (
                  <span key={ref}>
                    {i > 0 && ", "}
                    {target ? (
                      <Link {...to.spec(place.owner, place.repo, place.gitRef, target.requirement ? `${target.node.id}#${target.requirement.id}` : target.node.id)}>
                        {label}
                      </Link>
                    ) : (
                      <span className="mono">{ref}</span>
                    )}
                  </span>
                );
              })}
              .
            </span>
          )}
        </div>
      )}
    </div>
  );
}

function Requirement({
  spec,
  place,
  node,
  requirement,
  inherited,
  current,
}: {
  spec: Spec;
  place: Place;
  node: SpecNode;
  requirement: SpecRequirement;
  inherited: SpecStatus | undefined;
  current: boolean;
}) {
  const level = requirement.level ?? "must";
  // Deprecated with its item, it has no record of its own: the item's says why.
  const deprecated = requirement.status === "deprecated";
  const version = requirementVersion(requirement);
  const history = requirement.history ?? [];
  const [showHistory, setShowHistory] = useState(false);
  return (
    <div className="spec-req" data-req={requirement.id} data-current={current} data-deprecated={deprecated || inherited === "deprecated"}>
      <div className="spec-req-head">
        <span className="spec-req-id">{requirement.id}</span>
        <span className="spec-level" data-level={level}>
          {level}
        </span>
        {requirement.status !== undefined && requirement.status !== inherited && <StatusPill status={requirement.status} />}
        {history.length > 0 && (
          <button className="spec-version" onClick={() => setShowHistory(!showHistory)} aria-expanded={showHistory} aria-label={`Version ${version}: show earlier versions`}>
            v{version} {showHistory ? <ChevronDownIcon size={12} /> : <ChevronRightIcon size={12} />}
          </button>
        )}
      </div>
      <div className="spec-req-text">
        <SpecText text={requirement.text} />
      </div>
      {deprecated && <Deprecation spec={spec} place={place} deprecation={requirement.deprecation} />}
      <RequirementTools node={node} requirement={requirement} />
      {showHistory && (
        // Newest first: why it says what it says now, then how it got there.
        <ol className="spec-history" aria-label={`Earlier versions of ${requirement.id}`}>
          {[...history]
            .reverse()
            .map((earlier) => (
              <li key={earlier.version}>
                <div className="spec-history-head">
                  <span className="spec-version-label">v{earlier.version}</span>
                  {(earlier.level ?? "must") !== level && (
                    <span className="spec-level" data-level={earlier.level ?? "must"}>
                      {earlier.level ?? "must"}
                    </span>
                  )}
                  {earlier.date !== undefined && <span className="muted small">until {earlier.date}</span>}
                </div>
                <div className="spec-history-text">
                  <CheckText text={earlier.text} />
                </div>
                <div className="spec-history-why">
                  <span className="bold">Changed because</span> <CheckText text={earlier.reason} />
                </div>
              </li>
            ))}
        </ol>
      )}
    </div>
  );
}

function Figure({ figure, place }: { figure: SpecFigure; place: Place }) {
  const path = `${SPEC_DIR}/${figure.src}`;
  const file = useQuery(repoQueries.blob(place.owner, place.repo, place.gitRef, path));
  const url = file.data?.kind === "image" ? file.data.meta.download_url : null;
  const label = figure.alt ?? figure.caption ?? figure.src;
  return (
    <figure className="spec-figure">
      {url !== null && url !== "" ? (
        <Link {...to.blob(place.owner, place.repo, place.gitRef, path)} aria-label={`Open ${figure.src}`}>
          <img src={url} alt={label} loading="lazy" />
        </Link>
      ) : (
        <div className="spec-figure-missing muted small">{file.isPending ? "Loading picture…" : `Couldn't show ${figure.src}`}</div>
      )}
      {figure.caption !== undefined && figure.caption !== "" && <figcaption>{figure.caption}</figcaption>}
    </figure>
  );
}

// ---------------------------------------------------------------- children

function Children({ node, loaded, place, heading }: { node: SpecNode; loaded: LoadedSpec; place: Place; heading: string }) {
  const [shown, setShown] = useState(PAGE);
  // The rows on screen need their titles and summaries; the rest wait until they're scrolled to.
  const visible = useMemo(() => node.children.slice(0, shown), [node, shown]);
  useSpecContents(loaded, visible);
  const reworking = useReworking() !== null;
  if (node.children.length === 0 && !reworking) return null;
  return (
    <section aria-label={heading}>
      <div className="section-title">
        {heading}
        {node.children.length > PAGE && ` · ${node.children.length.toLocaleString()}`}
      </div>
      {visible.map((child) => (
        <NodeRow key={child.id} node={child} place={place} />
      ))}
      <LoadMore hasMore={node.children.length > shown} loading={false} onLoadMore={() => setShown(shown + PAGE)} />
      <AddItem node={node} />
    </section>
  );
}

function NodeRow({ node, place, showPath = false }: { node: SpecNode; place: Place; showPath?: boolean }) {
  const counts = specCounts(node);
  const summary = node.item?.summary;
  const trail = specTrail(node).slice(0, -1);
  return (
    <Link {...to.spec(place.owner, place.repo, place.gitRef, node.id)} className="row spec-row">
      <span className="row-icon">
        {node.children.length > 0 ? <FileDirectoryFillIcon size={16} className="c-accent" /> : <NoteIcon size={16} className="c-muted" />}
      </span>
      <span className="row-body">
        {showPath && trail.length > 0 && <span className="row-meta ellipsis">{trail.map((n) => n.title).join(" / ")}</span>}
        <span className={`row-title${node.loaded ? "" : " spec-unread"}`} style={{ display: "block" }}>
          {node.title}
        </span>
        {summary !== undefined && summary !== "" && <span className="spec-row-summary">
            <CheckText text={summary} />
          </span>}
        {node.error !== null && <span className="spec-row-summary c-danger">Couldn't be read</span>}
        <span className="row-meta">
          {node.item?.status !== undefined && <StatusPill status={node.item.status} />}
          <span>
            {[counts.items > 0 ? plural(counts.items, "item") : "", counts.unloaded === 0 && counts.requirements > 0 ? plural(counts.requirements, "requirement") : ""]
              .filter((part) => part !== "")
              .join(" · ")}
          </span>
        </span>
      </span>
      <ChevronRightIcon size={16} className="c-muted" />
    </Link>
  );
}
