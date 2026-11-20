// Reworking a spec while reading it (src/lib/specRework.ts): the buttons and
// forms that revise, deprecate and add requirements and items, and the bar
// that reviews the changes and copies them for a coding agent.

import { ArchiveIcon, CopyIcon, PencilIcon, PlusIcon, TrashIcon, UndoIcon } from "@primer/octicons-react";
import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import { errorMessage } from "../../lib/api";
import { backend } from "../../lib/backend";
import { to, useNav } from "../../lib/nav";
import { requirementStatus, type Spec, type SpecItem, type SpecLevel, type SpecNode, type SpecRequirement, type SpecStatus } from "../../lib/spec";
import { diffSpecs } from "../../lib/specDiff";
import {
  deprecateRequirement,
  newItemId,
  reviseRequirement,
  specReworkPrompt,
  suggestRequirementId,
  withFields,
  withNewRequirement,
  withRequirement,
  type ReworkedSpec,
  type SpecRework,
} from "../../lib/specRework";
import { useToast } from "../../lib/toast";
import { Sheet } from "../../components/Sheet";
import { SpecChangeCard, SpecChangesSummary } from "../../components/SpecChanges";

export interface Reworking {
  rework: SpecRework;
  /** The spec as the repository has it. */
  original: Spec;
  /** With the draft's changes: what the browser shows while reworking. */
  reworked: ReworkedSpec;
  owner: string;
  repo: string;
  gitRef: string;
}

/** Set while the spec is being reworked; null while it is only read. */
export const ReworkContext = createContext<Reworking | null>(null);
export const useReworking = () => useContext(ReworkContext);

const LEVELS: SpecLevel[] = ["must", "should", "may"];
const STATUSES: SpecStatus[] = ["draft", "accepted", "deprecated"];
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** The requirement as the repository has it; undefined for one the draft added. */
function originalOf(state: Reworking, node: SpecNode, id: string): { requirement: SpecRequirement } | undefined {
  const requirement = state.original.nodes.get(node.id)?.item?.requirements?.find((r) => r.id === id);
  return requirement ? { requirement } : undefined;
}

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="rework-field">
      <span className="field-label">{label}</span>
      {children}
      {hint !== undefined && <span className="muted small">{hint}</span>}
    </label>
  );
}

function LevelSelect({ value, onChange }: { value: SpecLevel; onChange: (level: SpecLevel) => void }) {
  return (
    <select className="select" value={value} onChange={(e) => onChange(LEVELS.find((level) => level === e.target.value) ?? "must")}>
      {LEVELS.map((level) => (
        <option key={level} value={level}>
          {level}
        </option>
      ))}
    </select>
  );
}

// ------------------------------------------------------------ requirements

/** What the draft did to a requirement, and the buttons to do more. */
export function RequirementTools({ node, requirement }: { node: SpecNode; requirement: SpecRequirement }) {
  const state = useReworking();
  const [sheet, setSheet] = useState<"revise" | "deprecate" | null>(null);
  const item = node.item;
  if (state === null || item === null) return null;
  const original = originalOf(state, node, requirement.id);
  const changed = original === undefined || !same(original.requirement, requirement);
  const deprecated = requirementStatus(item, requirement) === "deprecated";
  const label = original === undefined ? "New" : !changed ? null : deprecated && original.requirement.status !== "deprecated" ? "Deprecated here" : "Revised";
  const commit = (next: SpecRequirement | null) => state.rework.setItem(node.id, withRequirement(item, requirement.id, next));

  return (
    <div className="rework-tools">
      {label !== null && <span className="pill pill-accent rework-mark">{label}</span>}
      <span className="grow" />
      {!deprecated && (
        <button className="btn btn-sm" onClick={() => setSheet("revise")}>
          <PencilIcon size={14} /> Revise
        </button>
      )}
      {!deprecated && original !== undefined && (
        <button className="btn btn-sm" onClick={() => setSheet("deprecate")}>
          <ArchiveIcon size={14} /> Deprecate
        </button>
      )}
      {changed && original !== undefined && (
        <button className="btn btn-sm" onClick={() => commit(original.requirement)} aria-label={`Undo the changes to ${requirement.id}`}>
          <UndoIcon size={14} /> Undo
        </button>
      )}
      {original === undefined && (
        <button className="btn btn-sm btn-danger" onClick={() => commit(null)} aria-label={`Remove ${requirement.id}`}>
          <TrashIcon size={14} /> Remove
        </button>
      )}
      <ReviseSheet
        open={sheet === "revise"}
        onClose={() => setSheet(null)}
        requirement={requirement}
        original={original?.requirement}
        onSave={(text, level, reason) => {
          if (original === undefined) commit({ ...requirement, text, level: level === "must" ? undefined : level });
          // Put back exactly as it was: no change at all.
          else if (reason === null && text === original.requirement.text && level === (original.requirement.level ?? "must")) commit(original.requirement);
          else commit(reviseRequirement(original.requirement, { text, level, reason }));
        }}
      />
      <DeprecateSheet
        open={sheet === "deprecate"}
        onClose={() => setSheet(null)}
        id={requirement.id}
        onSave={(reason, replacedBy) => {
          if (original !== undefined) commit(deprecateRequirement(original.requirement, reason, replacedBy));
        }}
      />
    </div>
  );
}

function ReviseSheet({
  open,
  onClose,
  requirement,
  original,
  onSave,
}: {
  open: boolean;
  onClose: () => void;
  requirement: SpecRequirement;
  original: SpecRequirement | undefined;
  onSave: (text: string, level: SpecLevel, reason: string | null) => void;
}) {
  return (
    <Sheet open={open} onClose={onClose} title={`Revise ${requirement.id}`} full>
      {open && <ReviseForm requirement={requirement} original={original} onSave={onSave} onClose={onClose} />}
    </Sheet>
  );
}

function ReviseForm({
  requirement,
  original,
  onSave,
  onClose,
}: {
  requirement: SpecRequirement;
  original: SpecRequirement | undefined;
  onSave: (text: string, level: SpecLevel, reason: string | null) => void;
  onClose: () => void;
}) {
  // A revision already in the draft opens as it was left: its reason is the one its history gives for the version before.
  const drafted = original !== undefined && (requirement.version ?? 1) > (original.version ?? 1) ? (requirement.history?.at(-1)?.reason ?? "") : "";
  const [text, setText] = useState(requirement.text);
  const [level, setLevel] = useState<SpecLevel>(requirement.level ?? "must");
  const [meaning, setMeaning] = useState(original === undefined || drafted !== "" || requirement.text === original.text);
  const [reason, setReason] = useState(drafted);
  // How binding it is belongs to what it means.
  const levelChanged = original !== undefined && level !== (original.level ?? "must");
  const versioned = original !== undefined && (meaning || levelChanged);
  const ready = text.trim() !== "" && (!versioned || reason.trim() !== "");

  return (
    <div className="rework-form">
      {original !== undefined && (
        <p className="muted small" style={{ margin: 0 }}>
          It says now: “{original.text}”
        </p>
      )}
      <Field label="What it should say">
        <textarea className="textarea" value={text} onChange={(e) => setText(e.target.value)} autoFocus />
      </Field>
      <Field label="How binding it is">
        <LevelSelect value={level} onChange={setLevel} />
      </Field>
      {original !== undefined && (
        <label className="checkbox-row rework-check">
          <input type="checkbox" checked={versioned} disabled={levelChanged} onChange={(e) => setMeaning(e.target.checked)} />
          <span>
            <span className="bold">This changes what it means</span>
            <span className="muted small" style={{ display: "block" }}>
              It becomes version {(original.version ?? 1) + 1}; what it said is kept, with why. Leave off for a wording fix.
            </span>
          </span>
        </label>
      )}
      {versioned && (
        <Field label="Why it changes" hint="Kept in the requirement's history, for whoever reads it in a year.">
          <textarea className="textarea" value={reason} onChange={(e) => setReason(e.target.value)} style={{ minHeight: 80 }} />
        </Field>
      )}
      <button
        className="btn btn-primary btn-block"
        disabled={!ready}
        onClick={() => {
          onSave(text.trim(), level, versioned ? reason.trim() : null);
          onClose();
        }}
      >
        Save
      </button>
    </div>
  );
}

function DeprecateSheet({ open, onClose, id, onSave }: { open: boolean; onClose: () => void; id: string; onSave: (reason: string, replacedBy: string[]) => void }) {
  return (
    <Sheet open={open} onClose={onClose} title={`Deprecate ${id}`}>
      {open && <DeprecateForm onSave={onSave} onClose={onClose} />}
    </Sheet>
  );
}

function DeprecateForm({ onSave, onClose }: { onSave: (reason: string, replacedBy: string[]) => void; onClose: () => void }) {
  const [reason, setReason] = useState("");
  const [replacedBy, setReplacedBy] = useState("");
  return (
    <div className="rework-form">
      <p className="muted small" style={{ margin: 0 }}>
        It stays in the spec, marked deprecated, so it stays known that it existed and why it was dropped.
      </p>
      <Field label="Why it is no longer wanted">
        <textarea className="textarea" value={reason} onChange={(e) => setReason(e.target.value)} style={{ minHeight: 90 }} autoFocus />
      </Field>
      <Field label="Replaced by (optional)" hint="Requirement ids, separated by commas.">
        <input className="input mono" value={replacedBy} onChange={(e) => setReplacedBy(e.target.value)} autoCapitalize="off" autoCorrect="off" spellCheck={false} />
      </Field>
      <button
        className="btn btn-primary btn-block"
        disabled={reason.trim() === ""}
        onClick={() => {
          const ids = replacedBy
            .split(/[\s,]+/)
            .filter((id) => id !== "")
            .map((id) => (id.includes("#") ? id : `#${id}`));
          onSave(reason.trim(), ids);
          onClose();
        }}
      >
        Deprecate
      </button>
    </div>
  );
}

/** Adds a requirement to an item, with an id nothing else in the spec has. */
export function AddRequirement({ node }: { node: SpecNode }) {
  const state = useReworking();
  const [open, setOpen] = useState(false);
  if (state === null || node.item === null) return null;
  const item = node.item;
  return (
    <>
      <button className="btn btn-sm rework-add" onClick={() => setOpen(true)}>
        <PlusIcon size={14} /> Add a requirement
      </button>
      <Sheet open={open} onClose={() => setOpen(false)} title="New requirement" full>
        {open && (
          <NewRequirementForm
            spec={state.reworked.spec}
            suggested={suggestRequirementId(state.reworked.spec, node)}
            onSave={(requirement) => state.rework.setItem(node.id, withNewRequirement(item, requirement))}
            onClose={() => setOpen(false)}
          />
        )}
      </Sheet>
    </>
  );
}

function NewRequirementForm({
  spec,
  suggested,
  onSave,
  onClose,
}: {
  spec: Spec;
  suggested: string;
  onSave: (requirement: { id: string; text: string; level: SpecLevel }) => void;
  onClose: () => void;
}) {
  const [id, setId] = useState(suggested);
  const [text, setText] = useState("");
  const [level, setLevel] = useState<SpecLevel>("must");
  const taken = spec.requirements.get(id.trim());
  const valid = /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(id.trim());
  return (
    <div className="rework-form">
      <Field label="What has to be true" hint="One statement that can be checked against the code.">
        <textarea className="textarea" value={text} onChange={(e) => setText(e.target.value)} autoFocus />
      </Field>
      <Field label="How binding it is">
        <LevelSelect value={level} onChange={setLevel} />
      </Field>
      <Field
        label="Id"
        hint={
          taken
            ? `${id.trim()} is already in ${taken.node.title}. Ids are unique in the whole spec.`
            : valid
              ? "Unique in the whole spec, and never changed afterwards."
              : "Letters, digits, dots, dashes and underscores."
        }
      >
        <input className="input mono" value={id} onChange={(e) => setId(e.target.value)} autoCapitalize="off" autoCorrect="off" spellCheck={false} />
      </Field>
      <button
        className="btn btn-primary btn-block"
        disabled={text.trim() === "" || !valid || taken !== undefined}
        onClick={() => {
          onSave({ id: id.trim(), text: text.trim(), level });
          onClose();
        }}
      >
        Add
      </button>
    </div>
  );
}

// -------------------------------------------------------------------- items

/** Edits an item's own title, summary, description and status. */
export function ItemTools({ node }: { node: SpecNode }) {
  const state = useReworking();
  const [open, setOpen] = useState(false);
  // An item that couldn't be read is fixed in its file, not here.
  if (state === null || node.error !== null || !node.loaded) return null;
  const item: SpecItem = node.item ?? { title: node.title };
  const original = state.original.nodes.get(node.id)?.item ?? null;
  const changed = !same(original, node.item);
  return (
    <div className="rework-tools rework-item-tools">
      {changed && <span className="pill pill-accent rework-mark">{original === null ? "New" : "Changed"}</span>}
      <span className="grow" />
      <button className="btn btn-sm" onClick={() => setOpen(true)}>
        <PencilIcon size={14} /> Edit this part
      </button>
      {changed && (
        <button className="btn btn-sm" onClick={() => state.rework.setItem(node.id, null)} aria-label={`Undo every change to ${node.title}`}>
          <UndoIcon size={14} /> Undo all
        </button>
      )}
      <Sheet open={open} onClose={() => setOpen(false)} title={`Edit ${node.title}`} full>
        {open && <ItemForm item={item} onSave={(fields) => state.rework.setItem(node.id, withFields(item, fields))} onClose={() => setOpen(false)} />}
      </Sheet>
    </div>
  );
}

function ItemForm({ item, onSave, onClose }: { item: SpecItem; onSave: (fields: Parameters<typeof withFields>[1]) => void; onClose: () => void }) {
  const [title, setTitle] = useState(item.title);
  const [summary, setSummary] = useState(item.summary ?? "");
  const [description, setDescription] = useState(item.description ?? "");
  const [status, setStatus] = useState<SpecStatus | "">(item.status ?? "");
  const [reason, setReason] = useState(item.deprecation?.reason ?? "");
  const deprecated = status === "deprecated";
  return (
    <div className="rework-form">
      <Field label="Title">
        <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} />
      </Field>
      <Field label="Summary" hint="One line, shown wherever the part is listed.">
        <input className="input" value={summary} onChange={(e) => setSummary(e.target.value)} />
      </Field>
      <Field label="Description" hint="What this part does and why. A blank line starts a paragraph; lines starting with “- ” form a list.">
        <textarea className="textarea" value={description} onChange={(e) => setDescription(e.target.value)} style={{ minHeight: 140 }} />
      </Field>
      <Field label="Status">
        <select className="select" value={status} onChange={(e) => setStatus(STATUSES.find((option) => option === e.target.value) ?? "")}>
          <option value="">None</option>
          {STATUSES.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      </Field>
      {deprecated && (
        <Field label="Why it is no longer wanted" hint="The part and its requirements stay, marked deprecated.">
          <textarea className="textarea" value={reason} onChange={(e) => setReason(e.target.value)} style={{ minHeight: 80 }} />
        </Field>
      )}
      <button
        className="btn btn-primary btn-block"
        disabled={title.trim() === "" || (deprecated && reason.trim() === "")}
        onClick={() => {
          onSave({ title: title.trim(), summary: summary.trim(), description: description.trim(), status: status === "" ? undefined : status, deprecationReason: reason.trim() });
          onClose();
        }}
      >
        Save
      </button>
    </div>
  );
}

/** Adds a new part below `node`, and opens it to be filled in. */
export function AddItem({ node }: { node: SpecNode }) {
  const state = useReworking();
  const nav = useNav();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [summary, setSummary] = useState("");
  if (state === null) return null;
  const id = newItemId(state.reworked.spec, node, title);
  return (
    <>
      <button className="btn btn-sm rework-add" onClick={() => setOpen(true)}>
        <PlusIcon size={14} /> Add a part{node.id !== "" ? ` to ${node.title}` : ""}
      </button>
      <Sheet open={open} onClose={() => setOpen(false)} title="New part">
        <div className="rework-form">
          <Field label="Title">
            <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} />
          </Field>
          <Field label="Summary" hint="One line, shown wherever the part is listed.">
            <input className="input" value={summary} onChange={(e) => setSummary(e.target.value)} />
          </Field>
          {title.trim() !== "" && (
            <p className="muted small" style={{ margin: 0 }}>
              Its file will be <span className="mono">.spec/{id}.json</span>
            </p>
          )}
          <button
            className="btn btn-primary btn-block"
            disabled={title.trim() === ""}
            onClick={() => {
              state.rework.setItem(id, { title: title.trim(), ...(summary.trim() !== "" ? { summary: summary.trim() } : {}), status: "draft" });
              setOpen(false);
              setTitle("");
              setSummary("");
              nav.navigate(to.spec(state.owner, state.repo, state.gitRef, id));
            }}
          >
            Add
          </button>
        </div>
      </Sheet>
    </>
  );
}

// ---------------------------------------------------------------------- bar

/** Pinned below the spec while it is reworked: how much changed, and the way to hand it over. */
export function ReworkBar({ state, onDone }: { state: Reworking; onDone: () => void }) {
  const toast = useToast();
  const [review, setReview] = useState(false);
  const { rework, original, reworked, owner, repo, gitRef } = state;
  const diff = useMemo(() => diffSpecs(original, reworked.spec), [original, reworked.spec]);
  const count = reworked.files.length;
  const requirements = diff.counts.requirements.added + diff.counts.requirements.changed + diff.counts.requirements.moved + diff.counts.requirements.removed;

  const copy = async () => {
    try {
      await backend.copyText(specReworkPrompt({ repo: `${owner}/${repo}`, branch: gitRef, diff, files: reworked.files, note: rework.draft.note }));
      toast.show("Copied. Paste it into your coding agent.", "success");
    } catch (error) {
      toast.show(`Couldn't copy: ${errorMessage(error)}`, "error");
    }
  };

  return (
    <div className="bottom-bar rework-bar">
      <div className="rework-bar-text">
        <span className="bold">{count === 0 ? "Reworking the spec" : `${count} ${count === 1 ? "part" : "parts"} changed`}</span>
        <span className="muted small">
          {count === 0 ? "Changes stay on this device until you hand them over." : `${requirements} ${requirements === 1 ? "requirement" : "requirements"} · not in the repository yet`}
        </span>
      </div>
      {count === 0 ? (
        <button className="btn" style={{ flex: "none" }} onClick={onDone}>
          Done
        </button>
      ) : (
        <button className="btn btn-primary" style={{ flex: "none" }} onClick={() => setReview(true)}>
          Review &amp; copy
        </button>
      )}
      <Sheet
        open={review}
        onClose={() => setReview(false)}
        title="Your changes to the spec"
        full
        footer={
          <>
            <button
              className="btn btn-danger"
              onClick={() => {
                rework.discard();
                setReview(false);
                toast.show("Changes discarded");
              }}
            >
              Discard all
            </button>
            <button className="btn btn-primary" onClick={() => void copy()}>
              <CopyIcon size={14} /> Copy for my agent
            </button>
          </>
        }
      >
        <p className="muted small" style={{ margin: "0 0 4px" }}>
          Nothing is written to {owner}/{repo}. Copying gives your coding agent what changed and why, the new files, and what to do about the code.
        </p>
        <div className="rework-review">
          <SpecChangesSummary diff={diff} />
          {diff.items.map((item) => (
            <SpecChangeCard key={item.id} change={item} sides={{ owner, repo, base: gitRef, head: gitRef }} />
          ))}
        </div>
        <label className="rework-field" style={{ marginTop: 12 }}>
          <span className="field-label">Anything else the agent should know (optional)</span>
          <textarea className="textarea" value={rework.draft.note} onChange={(e) => rework.setNote(e.target.value)} style={{ minHeight: 80 }} />
        </label>
      </Sheet>
    </div>
  );
}
