// The catalogue of shared specs: the parts other repositories offer, and
// pulling one into one of yours as a pull request.
// Spec: SC1, SC2, SC3, SC4, SC5

import { ChevronRightIcon, GitPullRequestIcon, LockIcon, NoteIcon, PlusIcon, RepoIcon, SearchIcon, TrashIcon, XIcon } from "@primer/octicons-react";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { getRouteApi, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { errorMessage } from "../lib/api";
import { to, useNav } from "../lib/nav";
import { useIsGuest } from "../lib/session";
import { SPEC_DIR, specCounts, type SpecNode } from "../lib/spec";
import { addSpecCatalogue, isRepoName, planImport, removeSpecCatalogue, sharedParts, useSpecCatalogues, type ImportPlan } from "../lib/specCatalogue";
import { useToast } from "../lib/toast";
import { repoQueries } from "../queries/repos";
import { useSpec } from "../queries/spec";
import { useCatalogue, type LoadedCatalogue } from "../queries/specCatalogue";
import { useOpenSpecPull } from "../queries/specPull";
import { viewerQueries } from "../queries/viewer";
import { Screen } from "../components/Screen";
import { SpecLogo } from "../components/SpecLogo";
import { Sheet } from "../components/Sheet";
import { CenterSpinner, EmptyState, ErrorView, SkeletonList, Spinner } from "../components/ui";

const route = getRouteApi("/specs");

const plural = (count: number, noun: string) => `${count.toLocaleString()} ${noun}${count === 1 ? "" : "s"}`;

/** A part picked to pull in: from which catalogue, read at which commit. */
interface Picked {
  name: string;
  catalogue: LoadedCatalogue;
  part: SpecNode;
}

export function SpecCatalogueScreen() {
  const search = route.useSearch();
  const nav = useNav();
  const guest = useIsGuest();
  const catalogues = useSpecCatalogues();
  const into = search.into !== undefined && isRepoName(search.into) ? search.into : null;
  const [picked, setPicked] = useState<Picked | null>(null);

  return (
    <Screen title="Shared specs" subtitle={into !== null ? `Adding to ${into}` : undefined}>
      {guest ? (
        <EmptyState icon={<LockIcon size={32} />} title="Sign in to use shared specs">
          Reading a spec needs GitHub's GraphQL API, which needs an account.
        </EmptyState>
      ) : (
        <>
          {into !== null && (
            <div className="banner" style={{ margin: 12 }}>
              <RepoIcon size={16} />
              <span className="grow">
                Pick a part to add to <span className="bold">{into}</span>.
              </span>
              <button className="btn btn-sm" onClick={() => nav.replace(to.specs())}>
                Any repository
              </button>
            </div>
          )}
          <AddCatalogue />
          {catalogues.length === 0 ? (
            <EmptyState icon={<NoteIcon size={32} />} title="No catalogues yet">
              A catalogue is a repository whose spec is made of parts that several products share, such as how their devices sync. Add one above, or use{" "}
              <span className="bold">Add to shared specs</span> in a repository's menu.
            </EmptyState>
          ) : (
            catalogues.map((name) => <Catalogue key={name} name={name} into={into} onPick={setPicked} />)
          )}
        </>
      )}
      <Sheet open={picked !== null} onClose={() => setPicked(null)} title={picked !== null ? `Add "${picked.part.title}"` : "Add a shared part"} full>
        {picked !== null && <ImportFlow picked={picked} into={into} onDone={() => setPicked(null)} />}
      </Sheet>
    </Screen>
  );
}

function AddCatalogue() {
  const toast = useToast();
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (addSpecCatalogue(name)) {
      toast.show("Catalogue added", "success");
      setName("");
    } else setError(isRepoName(name.trim()) ? "That catalogue is in your list already." : "Name a repository as owner/repo.");
  };
  return (
    <form className="pad" onSubmit={submit} style={{ borderBottom: "1px solid var(--border-muted)" }}>
      <label className="field-label" htmlFor="spec-catalogue-add">
        Add a catalogue
      </label>
      <div className="row-flex" style={{ gap: 8 }}>
        <input
          id="spec-catalogue-add"
          className="input"
          placeholder="owner/repo"
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            setError(null);
          }}
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          enterKeyHint="done"
        />
        <button className="btn btn-primary" type="submit" disabled={name.trim() === ""} aria-label="Add catalogue">
          <PlusIcon size={16} /> Add
        </button>
      </div>
      {error !== null && (
        <p className="small c-danger" role="alert" style={{ margin: "6px 0 0" }}>
          {error}
        </p>
      )}
    </form>
  );
}

/** One catalogue: its parts, read at the newest commit of its default branch. */
function Catalogue({ name, into, onPick }: { name: string; into: string | null; onPick: (picked: Picked) => void }) {
  const catalogue = useCatalogue(name);
  const [owner = "", repo = ""] = name.split("/");
  const parts = catalogue.spec === null ? [] : sharedParts(catalogue.spec);
  const error = catalogue.tipError ?? catalogue.error;

  return (
    <section aria-label={name}>
      <h3 className="section-title row-flex" style={{ gap: 8 }}>
        <Link {...to.spec(owner, repo)} className="grow ellipsis">
          {name}
        </Link>
        <button className="icon-btn sm" aria-label={`Remove ${name}`} onClick={() => removeSpecCatalogue(name)}>
          <TrashIcon size={14} />
        </button>
      </h3>
      {error !== null ? (
        <ErrorView error={error} onRetry={catalogue.retry} />
      ) : catalogue.isPending ? (
        <SkeletonList rows={2} />
      ) : catalogue.spec === null ? (
        <p className="pad muted small">This repository has no {SPEC_DIR} folder on its default branch.</p>
      ) : parts.length === 0 ? (
        <p className="pad muted small">Its spec has no shared parts: folders at the top of {SPEC_DIR} whose index.json gives the part a permanent id in shared.</p>
      ) : (
        parts.map((part) => {
          const counts = specCounts(part);
          return (
            <div key={part.id} className="row" style={{ alignItems: "center" }}>
              <SpecLogo owner={owner} repo={repo} gitRef={catalogue.commit} src={part.item?.shared?.logo} name={part.title} />
              <Link {...to.spec(owner, repo, undefined, part.id)} className="row-body" style={{ minWidth: 0 }}>
                <span className="bold">{part.title}</span> <span className="muted small mono">{part.item?.shared?.id}</span>
                {part.item?.summary !== undefined && <span className="muted small" style={{ display: "block" }}>{part.item.summary}</span>}
                <span className="muted small" style={{ display: "block" }}>
                  {plural(counts.requirements, "requirement")}
                  {counts.items > 0 ? ` · ${plural(counts.items + 1, "part")}` : ""}
                  {counts.values > 0 ? ` · ${plural(counts.values, "value")}` : ""}
                </span>
              </Link>
              <button className="btn btn-sm" style={{ flex: "none" }} disabled={catalogue.commit === ""} onClick={() => onPick({ name, catalogue, part })}>
                {into !== null ? "Add" : "Use in…"}
              </button>
            </div>
          );
        })
      )}
    </section>
  );
}

/** Where the part goes: the repository from the screen, or one picked here. */
function ImportFlow({ picked, into, onDone }: { picked: Picked; into: string | null; onDone: () => void }) {
  const [target, setTarget] = useState<string | null>(into);
  if (target === null) return <RepoPicker onPick={setTarget} />;
  return <ImportReview picked={picked} target={target} onBack={into === null ? () => setTarget(null) : undefined} onDone={onDone} />;
}

function RepoPicker({ onPick }: { onPick: (name: string) => void }) {
  const repos = useInfiniteQuery(viewerQueries.repos("yours"));
  const [filter, setFilter] = useState("");
  const all = repos.data?.pages.flatMap((page) => page.nodes) ?? [];
  const needle = filter.trim().toLowerCase();
  const visible = (needle === "" ? all : all.filter((repo) => repo.nameWithOwner.toLowerCase().includes(needle))).filter((repo) => !repo.isArchived).slice(0, 50);
  const typed = filter.trim();
  return (
    <div>
      <p className="muted small" style={{ margin: "0 0 8px" }}>
        Which repository should use it? The part is added to its spec in a pull request.
      </p>
      <div className="search-bar" style={{ margin: "0 0 8px" }}>
        <SearchIcon size={16} />
        <input
          type="search"
          placeholder="Filter, or type owner/repo"
          aria-label="Repository"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          autoCapitalize="off"
          autoCorrect="off"
          enterKeyHint="go"
        />
        {filter !== "" && (
          <button className="icon-btn sm" aria-label="Clear" onClick={() => setFilter("")}>
            <XIcon size={14} />
          </button>
        )}
      </div>
      {isRepoName(typed) && !visible.some((repo) => repo.nameWithOwner.toLowerCase() === typed.toLowerCase()) && (
        <button className="row" style={{ width: "100%", border: 0, background: "none", textAlign: "left" }} onClick={() => onPick(typed)}>
          <RepoIcon size={16} />
          <span className="row-body">{typed}</span>
          <ChevronRightIcon size={16} className="c-muted" />
        </button>
      )}
      {repos.isPending ? (
        <SkeletonList rows={4} />
      ) : repos.isError ? (
        <ErrorView error={repos.error} onRetry={() => void repos.refetch()} />
      ) : (
        visible.map((repo) => (
          <button key={repo.id} className="row" style={{ width: "100%", border: 0, background: "none", textAlign: "left" }} onClick={() => onPick(repo.nameWithOwner)}>
            <RepoIcon size={16} />
            <span className="row-body">
              {repo.nameWithOwner}
              {repo.description !== null && <span className="muted small ellipsis" style={{ display: "block" }}>{repo.description}</span>}
            </span>
            <ChevronRightIcon size={16} className="c-muted" />
          </button>
        ))
      )}
    </div>
  );
}

/** What adding the part to `target` takes, and the pull request that does it. */
function ImportReview({ picked, target, onBack, onDone }: { picked: Picked; target: string; onBack: (() => void) | undefined; onDone: () => void }) {
  const [owner = "", repo = ""] = target.split("/");
  const [fromOwner = "", fromRepo = ""] = picked.name.split("/");
  const nav = useNav();
  const toast = useToast();
  const detail = useQuery(repoQueries.detail(owner, repo));
  const branch = detail.data?.repository?.defaultBranchRef?.name ?? "";
  const loaded = useSpec(owner, repo, branch);
  // Ids are checked against the whole spec, so all of it is read, however large.
  const { spec, want } = loaded;
  useEffect(() => {
    if (spec !== null) want(spec.nodes.values());
  }, [spec, want]);
  const allRead = spec === null || [...spec.nodes.values()].every((node) => node.loaded);
  const tree = picked.catalogue.folders?.get(picked.part.id);

  const plan = useMemo((): ImportPlan | null => {
    if (!loaded.loaded || !allRead || picked.catalogue.files === null) return null;
    if (tree === undefined) return { kind: "blocked", reasons: [`Couldn't tell which version of ${picked.part.id} this is. Refresh the catalogue and try again.`] };
    return planImport(
      { from: picked.name, commit: picked.catalogue.commit, tree, part: picked.part, files: picked.catalogue.files },
      { name: target, spec: loaded.spec, files: loaded.files },
    );
  }, [loaded.loaded, loaded.spec, loaded.files, allRead, picked, tree, target]);

  const openPull = useOpenSpecPull(owner, repo);
  const open = () => {
    if (plan?.kind !== "ready") return;
    openPull.mutate(
      {
        base: branch,
        title: plan.title,
        body: plan.body,
        files: [{ path: plan.root.path, text: plan.root.text }],
        copies: plan.copies.map((copy) => ({ ...copy, owner: fromOwner, repo: fromRepo })),
        deletes: plan.deletes,
      },
      {
        onSuccess: (pull) => {
          onDone();
          toast.show(`Pull request #${pull.number} opened. Point your coding agent at it.`, "success");
          nav.navigate(to.pull(owner, repo, pull.number));
        },
      },
    );
  };

  const error = detail.error ?? loaded.error;
  return (
    <div>
      <div className="row-flex" style={{ gap: 8, marginBottom: 12 }}>
        <RepoIcon size={16} />
        <span className="grow bold ellipsis">{target}</span>
        {onBack !== undefined && (
          <button className="btn btn-sm" onClick={onBack}>
            Change
          </button>
        )}
      </div>
      {error !== null ? (
        <ErrorView error={error} onRetry={loaded.retry} />
      ) : detail.isPending || plan === null ? (
        <CenterSpinner />
      ) : branch === "" ? (
        <p className="muted">This repository is empty: there is no branch to add the part to.</p>
      ) : plan.kind === "blocked" ? (
        <div className="banner banner-danger" role="alert">
          <div className="grow">
            <div className="bold">It can't be added as it is</div>
            <ul className="small" style={{ margin: "6px 0 0", paddingLeft: 18 }}>
              {plan.reasons.map((reason) => (
                <li key={reason}>{reason}</li>
              ))}
            </ul>
          </div>
        </div>
      ) : plan.kind === "current" ? (
        <p>
          {target} has this version of the part already, copied at <span className="mono">{plan.commit.slice(0, 7)}</span>.{" "}
          <Link {...to.spec(owner, repo, branch, picked.part.id)} onClick={onDone}>
            Open it
          </Link>
        </p>
      ) : (
        <>
          <ul className="small" style={{ margin: "0 0 12px", paddingLeft: 18 }}>
            <li>
              {plan.updates === null ? "Copies" : "Updates"} <span className="mono">
                {SPEC_DIR}/{picked.part.id}
              </span>{" "}
              ({plural(plan.copies.length, "file")}) from {picked.name} at <span className="mono">{picked.catalogue.commit.slice(0, 7)}</span>
              {plan.updates !== null && (
                <>
                  , in place of <span className="mono">{plan.updates.slice(0, 7)}</span>
                </>
              )}
              .
            </li>
            {plan.movesFrom !== null && (
              <li>
                Moves it from <span className="mono">
                  {SPEC_DIR}/{plan.movesFrom}
                </span>
                : the part was renamed. Its ids stay the same.
              </li>
            )}
            {plan.deletes.length > 0 && <li>Removes {plural(plan.deletes.length, "file")} the earlier copy has and this one doesn't.</li>}
            <li>
              Records it in <span className="mono">imports</span> in <span className="mono">{plan.root.path}</span>
              {loaded.spec === null ? `, which it creates: ${target} has no spec yet` : ""}.
            </li>
            <li>Opens a pull request into {branch}, with what a coding agent does next.</li>
          </ul>
          <div className="muted small" style={{ marginBottom: 12 }}>
            {plan.title}
          </div>
          {openPull.isError && (
            <p className="small c-danger" role="alert">
              {errorMessage(openPull.error)}
            </p>
          )}
          <button className="btn btn-primary" style={{ width: "100%" }} disabled={openPull.isPending} onClick={open}>
            {openPull.isPending ? <Spinner small /> : <GitPullRequestIcon size={16} />} Open pull request
          </button>
        </>
      )}
    </div>
  );
}
