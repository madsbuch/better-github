// Compile-time checks that GitHub's documented REST shapes (OpenAPI) satisfy
// the schemas for repositories, commits, contents, new pull requests and
// guest mode: if GitHub documents a field as nullable or optional that a
// schema requires, this file fails tsc.

import type { components } from "@octokit/openapi-types";
import type { z } from "zod";
import type { RestBranch, RestLatestRelease, RestOwner, RestRateLimit, RestRepo, RestRepoDetail } from "../queries/guest";
import type { RestComparison, RestCreatedPull, RestPullSimple } from "../queries/newPull";
import type { DiffEntry, RestCommit, RestCommitListItem, RestContentFile, RestContentItem, RestContents } from "../queries/repos";

type Fits<Api, Schema extends z.ZodType> = Api extends z.input<Schema> ? true : false;
type Schemas = components["schemas"];

// Repositories: commits and contents.
export const diffEntryFits: Fits<Schemas["diff-entry"], typeof DiffEntry> = true;
export const commitListItemFits: Fits<Schemas["commit"], typeof RestCommitListItem> = true;
export const commitFits: Fits<Schemas["commit"], typeof RestCommit> = true;
export const contentItemFits: Fits<Schemas["content-directory"][number], typeof RestContentItem> = true;
export const contentsFits: Fits<
  Schemas["content-directory"] | Schemas["content-file"] | Schemas["content-symlink"] | Schemas["content-submodule"],
  typeof RestContents
> = true;
export const contentFileFits: Fits<Schemas["content-file"], typeof RestContentFile> = true;
// The blob screen also reads symlinks and submodules through the file schema.
export const contentSymlinkFits: Fits<Schemas["content-symlink"], typeof RestContentFile> = true;
export const contentSubmoduleFits: Fits<Schemas["content-submodule"], typeof RestContentFile> = true;

// New pull requests.
export const comparisonFits: Fits<Schemas["commit-comparison"], typeof RestComparison> = true;
export const pullSimpleFits: Fits<Schemas["pull-request-simple"], typeof RestPullSimple> = true;
export const createdPullFits: Fits<Schemas["pull-request"], typeof RestCreatedPull> = true;

// Guest mode.
export const publicUserFits: Fits<Schemas["public-user"], typeof RestOwner> = true;
export const privateUserFits: Fits<Schemas["private-user"], typeof RestOwner> = true;
export const minimalRepoFits: Fits<Schemas["minimal-repository"], typeof RestRepo> = true;
export const fullRepoFits: Fits<Schemas["full-repository"], typeof RestRepoDetail> = true;
export const latestReleaseFits: Fits<Schemas["release"], typeof RestLatestRelease> = true;
export const shortBranchFits: Fits<Schemas["short-branch"], typeof RestBranch> = true;
export const rateLimitFits: Fits<Schemas["rate-limit-overview"], typeof RestRateLimit> = true;
