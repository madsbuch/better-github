import {
  AlertIcon,
  ChevronRightIcon,
  CodeIcon,
  CopyIcon,
  FileDirectoryFillIcon,
  FileIcon,
  GitCompareIcon,
  LockIcon,
  NoteIcon,
  SearchIcon,
  XIcon,
} from "@primer/octicons-react";
import { useQuery } from "@tanstack/react-query";
import { getRouteApi, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { to, useNav } from "../lib/nav";
import { useIsGuest } from "../lib/session";
import {
  isSpecPattern,
  resolveSpecRef,
  searchSpec,
  SPEC_DIR,
  specCounts,
  specTextBlocks,
  specTrail,
  type Spec,
  type SpecFigure,
  type SpecNode,
  type SpecRequirement,
  type SpecStatus,
} from "../lib/spec";
import { repoQueries } from "../queries/repos";
import { useCopySpecPrompt, useSpec } from "../queries/spec";
import { BranchBar } from "../components/RepoParts";
import { CheckText } from "../components/ReviewRules";
import { Screen } from "../components/Screen";
import { CenterSpinner, EmptyState, ErrorView, SkeletonList } from "../components/ui";

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
  const spec = loaded.spec;
  const node = spec?.nodes.get(id) ?? null;
  const place: Place = { owner, repo, gitRef };
  const copyPrompt = useCopySpecPrompt();

  return (
    <Screen
      title={node !== null && id !== "" ? node.title : "Spec"}
      subtitle={`${owner}/${repo}${gitRef !== "" ? ` · ${gitRef}` : ""}`}
      actions={
        <>
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
          ) : id === "" ? (
            <Outline spec={spec} place={place} initialFilter={search.q ?? ""} />
          ) : (
            <>
              <Trail node={node} place={place} />
              <Item spec={spec} node={node} place={place} current={search.r} />
              <Children node={node} place={place} heading="In this part" />
            </>
          )}
        </>
      )}
    </Screen>
  );
}

// ----------------------------------------------------------------- outline

/** The spec's first page: what it is, a filter over everything in it, and its top-level parts. */
function Outline({ spec, place, initialFilter }: { spec: Spec; place: Place; initialFilter: string }) {
  const nav = useNav();
  const [filter, setFilter] = useState(initialFilter);
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
      {filter.trim() !== "" ? (
        matches.length === 0 ? (
          <EmptyState title="Nothing matches">No item or requirement contains “{filter.trim()}”.</EmptyState>
        ) : (
          matches.map(({ node, requirements }) =>
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
      ) : (
        <>
          <Problems spec={spec} place={place} />
          <Item spec={spec} node={spec.root} place={place} current={undefined} />
          <p className="spec-counts muted small">
            {plural(counts.items, "item")} · {plural(counts.requirements, "requirement")}
            {counts.requirements > 0 && ` · ${counts.implemented} implemented`}
          </p>
          <Children node={spec.root} place={place} heading="Parts" />
        </>
      )}
    </>
  );
}

const plural = (count: number, noun: string) => `${count} ${noun}${count === 1 ? "" : "s"}`;

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
      {item?.description !== undefined && <SpecText text={item.description} />}
      {figures.map((figure) => (
        <Figure key={figure.src} figure={figure} place={place} />
      ))}
      {requirements.length > 0 && (
        <section aria-label="Requirements">
          <h3>Requirements</h3>
          {requirements.map((requirement) => (
            <Requirement key={requirement.id} requirement={requirement} inherited={item?.status} current={requirement.id === current} />
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
                <Link key={ref} {...to.spec(place.owner, place.repo, place.gitRef, ref)} className="spec-link">
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

function Requirement({ requirement, inherited, current }: { requirement: SpecRequirement; inherited: SpecStatus | undefined; current: boolean }) {
  const level = requirement.level ?? "must";
  return (
    <div className="spec-req" data-req={requirement.id} data-current={current}>
      <div className="spec-req-head">
        <span className="spec-req-id">{requirement.id}</span>
        <span className="spec-level" data-level={level}>
          {level}
        </span>
        {requirement.status !== undefined && requirement.status !== inherited && <StatusPill status={requirement.status} />}
      </div>
      <div className="spec-req-text">
        <SpecText text={requirement.text} />
      </div>
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

function Children({ node, place, heading }: { node: SpecNode; place: Place; heading: string }) {
  if (node.children.length === 0) return null;
  return (
    <section aria-label={heading}>
      <div className="section-title">{heading}</div>
      {node.children.map((child) => (
        <NodeRow key={child.id} node={child} place={place} />
      ))}
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
        <span className="row-title" style={{ display: "block" }}>
          {node.title}
        </span>
        {summary !== undefined && summary !== "" && <span className="spec-row-summary">
            <CheckText text={summary} />
          </span>}
        {node.error !== null && <span className="spec-row-summary c-danger">Couldn't be read</span>}
        <span className="row-meta">
          {node.item?.status !== undefined && <StatusPill status={node.item.status} />}
          <span>
            {[counts.items > 0 ? plural(counts.items, "item") : "", counts.requirements > 0 ? plural(counts.requirements, "requirement") : ""]
              .filter((part) => part !== "")
              .join(" · ")}
          </span>
        </span>
      </span>
      <ChevronRightIcon size={16} className="c-muted" />
    </Link>
  );
}
