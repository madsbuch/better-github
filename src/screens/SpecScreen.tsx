import {
  AlertIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  CodeIcon,
  CopyIcon,
  FileDirectoryFillIcon,
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
  findInSpec,
  requirementStatus,
  SPEC_FINDS,
  specFindCounts,
  type SpecEntry,
  type SpecFind,
  specStatus,
  requirementVersion,
  resolveSpecRef,
  SPEC_DIR,
  specCounts,
  specFilesAround,
  specTextBlocks,
  specTrail,
  storySentence,
  valueText,
  type SpecValue,
  splitSpecRef,
  unloadedBelow,
  type Spec,
  type SpecDeprecation,
  type SpecFigure,
  type SpecNode,
  type SpecRequirement,
  type SpecStatus,
  type SpecStory,
} from "../lib/spec";
import { repoQueries } from "../queries/repos";
import { errorMessage } from "../lib/api";
import { specQueries, useCopySpecPrompt, useSpec, useSpecContents, type LoadedSpec } from "../queries/spec";
import { applyRework, useSpecRework } from "../lib/specRework";
import { BranchBar } from "../components/RepoParts";
import { CheckText } from "../components/ReviewRules";
import { Screen } from "../components/Screen";
import { CenterSpinner, EmptyState, ErrorView, LoadMore, SkeletonList } from "../components/ui";
import { SpecValuesProvider, ValuePreview, ValueText } from "../components/SpecValues";
import { VALUE_TYPE_LABEL } from "../lib/specValues";
import { AddItem, AddRequirement, AddStory, AddValue, ItemTools, RequirementTools, StoryTools, ValueTools, ReworkBar, ReworkContext, useReworking, type Reworking } from "./spec/Rework";

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
          {node !== null && id !== "" && (
            // From any part: the index of every requirement by id, with the search over the whole spec.
            <Link {...to.spec(owner, repo, search.ref, undefined, undefined, "requirements")} className="icon-btn" aria-label="Search and index">
              <SearchIcon size={18} />
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
              <SpecValuesProvider values={spec.values}>
              {id === "" ? (
                <Outline spec={spec} loaded={loaded} place={place} initialFilter={search.q ?? ""} initialFind={SPEC_FINDS.find((option) => option === search.k) ?? "all"} />
              ) : (
                <>
                  <Trail node={node} place={place} />
                  {node.loaded ? <Item spec={spec} node={node} place={place} current={search.r} /> : <SkeletonList rows={4} />}
                  <Children node={node} loaded={loaded} place={place} heading="In this part" />
                </>
              )}
              </SpecValuesProvider>
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

const FIND_LABEL: Record<SpecFind, string> = { all: "Outline", requirements: "Requirements", stories: "User stories", values: "Values", deprecated: "Deprecated" };
const ENTRY_KIND: Record<SpecEntry["kind"], string> = { part: "Part", story: "User story", requirement: "Requirement", value: "Value" };

/**
 * The spec's first page: what it is and its top-level parts, an index of every
 * requirement, user story and value by id, and a search over all of it.
 */
function Outline({ spec, loaded, place, initialFilter, initialFind }: { spec: Spec; loaded: LoadedSpec; place: Place; initialFilter: string; initialFind: SpecFind }) {
  const nav = useNav();
  const [filter, setFilter] = useState(initialFilter);
  const [find, setFind] = useState(initialFind);
  const filtering = filter.trim() !== "";
  // An index, or a search: either looks at every item, so a large spec is read in full the first time.
  const listing = filtering || find !== "all";
  const unread = useMemo(() => (listing ? unloadedBelow(spec.root) : []), [listing, spec]);
  useSpecContents(loaded, unread);
  const [shown, setShown] = useState(PAGE);
  // Both are in the URL too, so coming back from a result shows the results again.
  const change = (nextFilter: string, nextFind: SpecFind) => {
    setFilter(nextFilter);
    setFind(nextFind);
    setShown(PAGE);
    nav.replace(to.spec(place.owner, place.repo, place.gitRef, undefined, nextFilter, nextFind));
  };
  const found = useMemo(() => findInSpec(spec, filter, find), [spec, filter, find]);
  const findCounts = useMemo(() => specFindCounts(spec), [spec]);
  const counts = specCounts(spec.root);
  const target = (entry: SpecEntry) => (entry.kind === "part" ? entry.id : `${entry.node.id}#${entry.id}`);
  // Typing an id and pressing Enter goes there.
  const exact = filtering ? found.find((entry) => entry.kind !== "part" && entry.id.toLowerCase() === filter.trim().toLowerCase()) : undefined;

  return (
    <>
      <div className="search-bar">
        <SearchIcon size={16} />
        <input
          type="search"
          placeholder="Search the spec, or type an id"
          aria-label="Search the spec"
          value={filter}
          onChange={(e) => change(e.target.value, find)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && exact !== undefined) nav.navigate(to.spec(place.owner, place.repo, place.gitRef, target(exact)));
          }}
          autoCapitalize="off"
          autoCorrect="off"
          enterKeyHint="search"
        />
        {filter !== "" && (
          <button className="icon-btn sm" aria-label="Clear" onClick={() => change("", find)}>
            <XIcon size={14} />
          </button>
        )}
      </div>
      <div className="chips spec-find" role="radiogroup" aria-label="Show">
        {SPEC_FINDS.filter((option) => option === "all" || option === find || counts.unloaded > 0 || findCounts[option] > 0).map((option) => (
          <button key={option} role="radio" aria-checked={find === option} className={find === option ? "chip active" : "chip"} onClick={() => change(filter, option)}>
            {FIND_LABEL[option]}
            {option !== "all" && counts.unloaded === 0 && <span className="counter">{findCounts[option].toLocaleString()}</span>}
          </button>
        ))}
      </div>
      {listing && unread.length > 0 && (
        <p className="spec-counts muted small" role="status">
          Reading the spec: {(counts.items - unread.length).toLocaleString()} of {plural(counts.items, "item")} so far…
        </p>
      )}
      {listing &&
        (found.length === 0 ? (
          unread.length > 0 ? null : filtering ? (
            <EmptyState title="Nothing matches">
              Nothing {find === "all" ? "in the spec" : `among the ${FIND_LABEL[find].toLowerCase()}`} contains “{filter.trim()}”.
            </EmptyState>
          ) : (
            <EmptyState title={`No ${FIND_LABEL[find].toLowerCase()}`}>{find === "deprecated" ? "Nothing was dropped from this spec." : "This spec has none."}</EmptyState>
          )
        ) : (
          found.slice(0, shown).map((entry) =>
            entry.kind === "part" && !entry.deprecated ? (
              <NodeRow key={`part:${entry.id}`} node={entry.node} place={place} showPath />
            ) : (
              <Link key={`${entry.kind}:${entry.node.id}#${entry.id}`} {...to.spec(place.owner, place.repo, place.gitRef, target(entry))} className="row spec-row spec-entry" data-kind={entry.kind} data-deprecated={entry.deprecated}>
                <span className="row-body">
                  <span className="row-meta">
                    <span className="spec-req-id">{entry.kind === "part" ? entry.node.title : entry.id}</span>
                    {(find === "all" || find === "deprecated") && <span className="spec-entry-kind">{ENTRY_KIND[entry.kind]}</span>}
                    {entry.deprecated && find !== "deprecated" && <span className="pill pill-attention spec-status">Deprecated</span>}
                    <span className="ellipsis">{specTrail(entry.kind === "part" ? (entry.node.parent ?? entry.node) : entry.node).map((n) => n.title).join(" / ")}</span>
                  </span>
                  <span className="spec-row-summary">
                    <CheckText text={entry.text} />
                  </span>
                </span>
              </Link>
            ),
          )
        ))}
      {listing && <LoadMore hasMore={found.length > shown} loading={false} onLoadMore={() => setShown(shown + PAGE)} />}
      {listing ? null : (
        <>
          <Problems spec={spec} place={place} />
          <Item spec={spec} node={spec.root} place={place} current={undefined} />
          <p className="spec-counts muted small">
            {plural(counts.items, "item")}
            {/* Requirements are counted once everything is read; a large spec is read as it is looked at. */}
            {counts.unloaded === 0 && counts.values > 0 && ` · ${plural(counts.values, "named value")}`}
            {counts.unloaded === 0 && counts.stories > 0 && ` · ${plural(counts.stories, "user story").replace("storys", "stories")}`}
            {counts.unloaded === 0 && ` · ${plural(counts.requirements, "requirement")}`}
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

/** The one mark a part, story, requirement or value can carry: it was dropped, and is kept for the record. */
function StatusPill() {
  return <span className="pill pill-attention spec-status">Deprecated</span>;
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

/** One item: what it says, the user stories it serves, its requirements, pictures and what it relates to. */
function Item({ spec, node, place, current }: { spec: Spec; node: SpecNode; place: Place; current: string | undefined }) {
  const item = node.item;
  const requirements = item?.requirements ?? [];
  const figures = item?.figures ?? [];
  const stories = item?.stories ?? [];
  const related = item?.related ?? [];
  const values = item?.values ?? [];

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
    document.querySelector(`.spec-item [data-current="true"]`)?.scrollIntoView({ block: "center" });
  }, [current, node.id]);

  return (
    <article className="spec-item">
      <header>
        <h2>
          {node.title} {specStatus(item) !== undefined && <StatusPill />}
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
      {item?.deprecation !== undefined && (
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
      {(stories.length > 0 || (reworking && item !== null)) && (
        // Who the part is for, before what it must do.
        <section aria-label="User stories">
          <h3>User stories</h3>
          {stories.map((story) => (
            <Story key={story.id} spec={spec} place={place} node={node} story={story} inherited={specStatus(item)} current={story.id === current} />
          ))}
          <AddStory node={node} />
        </section>
      )}
      {(live.length > 0 || (reworking && item !== null)) && (
        <section aria-label="Requirements">
          <h3>Requirements</h3>
          {live.map((requirement) => (
            <Requirement key={requirement.id} spec={spec} place={place} node={node} requirement={requirement} inherited={specStatus(item)} current={requirement.id === current} />
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
              <Requirement key={requirement.id} spec={spec} place={place} node={node} requirement={requirement} inherited={specStatus(item)} current={requirement.id === current} />
            ))}
        </section>
      )}
      {(values.length > 0 || (reworking && item !== null)) && (
        // What the part decides once, for everything that uses it.
        <section aria-label="Values">
          <h3>Values</h3>
          {values.map((value) => (
            <Value key={value.id} spec={spec} place={place} node={node} value={value} inherited={specStatus(item)} current={value.id === current} />
          ))}
          <AddValue node={node} />
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
                  {...to.spec(place.owner, place.repo, place.gitRef, specTarget(target))}
                  className="spec-link"
                >
                  {(target.requirement ?? target.story ?? target.value) !== null && <span className="spec-req-id">{(target.requirement ?? target.story ?? target.value)?.id}</span>}
                  <span className="grow">
                    <span className="bold">{target.node.title}</span>
                    {(target.requirement !== null || target.story !== null) && (
                      <span className="spec-row-summary">
                        <CheckText text={target.requirement?.text ?? (target.story ? storySentence(target.story) : "")} />
                      </span>
                    )}
                    {target.value !== null && (
                      <span className="spec-row-summary">
                        <ValueText value={target.value} />
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

/** Where a reference leads: the item, or the requirement or user story in it. */
function specTarget(target: { node: SpecNode; requirement: SpecRequirement | null; story: SpecStory | null; value: SpecValue | null }): string {
  const entity = target.requirement?.id ?? target.story?.id ?? target.value?.id;
  return entity === undefined ? target.node.id : `${target.node.id}#${entity}`;
}

/** A user story as its sentence, with the requirements that make it true. */
function Story({
  spec,
  place,
  node,
  story,
  inherited,
  current,
}: {
  spec: Spec;
  place: Place;
  node: SpecNode;
  story: SpecStory;
  inherited: SpecStatus | undefined;
  current: boolean;
}) {
  const deprecated = specStatus(story) === "deprecated";
  return (
    <div className="spec-req spec-story" data-story={story.id} data-current={current} data-deprecated={deprecated || inherited === "deprecated"}>
      <div className="spec-req-head">
        <span className="spec-req-id">{story.id}</span>
        {specStatus(story) !== undefined && specStatus(story) !== inherited && <StatusPill />}
      </div>
      <p className="spec-req-text spec-story-text">
        As <strong>{story.as}</strong>, I want <strong>{story.want}</strong>
        {story.soThat !== undefined && (
          <>
            , so that <strong>{story.soThat}</strong>
          </>
        )}
        .
      </p>
      {(story.requirements ?? []).length > 0 && (
        <div className="spec-story-requirements">
          <span className="muted small">Made true by</span>
          {(story.requirements ?? []).map((ref) => {
            const target = resolveSpecRef(spec, ref);
            return target?.requirement ? (
              <Link
                key={ref}
                {...to.spec(place.owner, place.repo, place.gitRef, `${target.node.id}#${target.requirement.id}`)}
                className="spec-req-id"
                title={target.requirement.text}
              >
                {target.requirement.id}
              </Link>
            ) : (
              <span key={ref} className="spec-req-id muted">
                {ref}
              </span>
            );
          })}
        </div>
      )}
      {deprecated && <Deprecation spec={spec} place={place} deprecation={story.deprecation} />}
      <StoryTools node={node} story={story} />
    </div>
  );
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
                      <Link {...to.spec(place.owner, place.repo, place.gitRef, specTarget(target))}>
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
  const deprecated = specStatus(requirement) === "deprecated";
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
        {specStatus(requirement) !== undefined && specStatus(requirement) !== inherited && <StatusPill />}
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
      <Cited place={place} id={requirement.id} deprecated={deprecated || inherited === "deprecated"} />
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

/** A named value: what it is called, what it is, and what it was before. */
function Value({ spec, place, node, value, inherited, current }: { spec: Spec; place: Place; node: SpecNode; value: SpecValue; inherited: SpecStatus | undefined; current: boolean }) {
  const deprecated = specStatus(value) === "deprecated";
  const history = value.history ?? [];
  const [showHistory, setShowHistory] = useState(false);
  return (
    <div className="spec-val" data-value={value.id} data-current={current} data-deprecated={deprecated || inherited === "deprecated"}>
      <div className="spec-req-head">
        <span className="spec-req-id">{value.id}</span>
        <span className="spec-val-type">{VALUE_TYPE_LABEL[value.type]}</span>
        {specStatus(value) !== undefined && specStatus(value) !== inherited && <StatusPill />}
        {history.length > 0 && (
          <button className="spec-version" onClick={() => setShowHistory(!showHistory)} aria-expanded={showHistory} aria-label={`${value.id}: show what it was before`}>
            {plural(history.length, "change")} {showHistory ? <ChevronDownIcon size={12} /> : <ChevronRightIcon size={12} />}
          </button>
        )}
      </div>
      <div className="spec-val-is">
        <ValueText value={value} />
      </div>
      {value.description !== undefined && (
        <p className="spec-val-about">
          <CheckText text={value.description} />
        </p>
      )}
      {deprecated && <Deprecation spec={spec} place={place} deprecation={value.deprecation} />}
      <ValueTools node={node} value={value} />
      {showHistory && (
        // Newest first: why it is what it is now, then how it got there.
        <ol className="spec-history" aria-label={`What ${value.id} was before`}>
          {[...history].reverse().map((earlier, index) => (
            <li key={index}>
              <div className="spec-history-head">
                <span className="spec-value-text">
                  <ValuePreview value={{ type: value.type, value: earlier.value, dark: earlier.dark }} />
                  <span className="mono">{valueText({ value: earlier.value })}</span>
                </span>
                {earlier.date !== undefined && <span className="muted small">until {earlier.date}</span>}
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

/**
 * Where the code cites a requirement, as "Spec: <id>": looked up in the code
 * when asked for. The spec itself holds nothing about code.
 */
function Cited({ place, id, deprecated }: { place: Place; id: string; deprecated: boolean }) {
  const guest = useIsGuest();
  const [open, setOpen] = useState(false);
  const cited = useQuery({ ...specQueries.cited(place.owner, place.repo, id), enabled: open && !guest });
  // Searching code needs an account.
  if (guest) return null;
  return (
    <div className="spec-cited">
      <button className="spec-cited-toggle" onClick={() => setOpen(!open)} aria-expanded={open} aria-label={`Where the code cites ${id}`}>
        {open ? <ChevronDownIcon size={12} /> : <ChevronRightIcon size={12} />} <CodeIcon size={12} /> Cited in code
        {cited.data !== undefined && ` · ${cited.data.paths.length}`}
      </button>
      {open &&
        (cited.isPending ? (
          <p className="muted small spec-cited-note">Searching the code…</p>
        ) : cited.isError ? (
          <p className="small spec-cited-note">
            <span className="c-danger">{errorMessage(cited.error)}</span>{" "}
            <button className="btn btn-sm" onClick={() => void cited.refetch()}>
              Retry
            </button>
          </p>
        ) : cited.data.paths.length === 0 ? (
          <p className="muted small spec-cited-note">
            {deprecated ? "Nothing cites it any more." : `Nothing on the default branch has a comment “Spec: ${id}”.`}
          </p>
        ) : (
          <>
            {/* What still cites something that was dropped is what is left to remove. */}
            {deprecated && <p className="small spec-cited-note c-attention">It was dropped from the spec, and the code still cites it:</p>}
            <ul className="spec-cited-list">
              {cited.data.paths.map((path) => (
                <li key={path}>
                  <Link {...to.blob(place.owner, place.repo, undefined, path)} className="mono small">
                    {path}
                  </Link>
                </li>
              ))}
            </ul>
            {cited.data.more && <p className="muted small spec-cited-note">There may be more: GitHub returned only the first files it found.</p>}
          </>
        ))}
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
          {specStatus(node.item) !== undefined && <StatusPill />}
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
