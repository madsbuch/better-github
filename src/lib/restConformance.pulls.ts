// Compile-time checks that GitHub's documented REST shapes satisfy the
// schemas the pull request screens parse responses with.
import type { components } from "@octokit/openapi-types";
import type { z } from "zod";
import type { RestPullFile } from "../queries/pulls";

type Fits<Api, Schema extends z.ZodType> = Api extends z.input<Schema> ? true : false;

export const restPullFileFits: Fits<components["schemas"]["diff-entry"], typeof RestPullFile> = true;
