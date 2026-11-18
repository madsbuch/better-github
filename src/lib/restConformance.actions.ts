// Compile-time checks that GitHub's documented REST shapes (OpenAPI) satisfy
// the schemas for Actions, releases and notifications: if GitHub documents a
// field as nullable or optional that a schema requires, this file fails tsc.
//
// Not checked here, because OpenAPI types their `id` (or a nested id the
// schema reads) as `number | bigint`: WorkflowRun (`workflow-run`) and
// WorkflowJob (`job`, also `run_id`).

import type { components } from "@octokit/openapi-types";
import type { z } from "zod";
import type { RestNotification } from "../queries/notifications";
import type { Release, ReleaseAsset } from "../queries/releases";
import type { CheckAnnotation, Workflow } from "./types";

type Fits<Api, Schema extends z.ZodType> = Api extends z.input<Schema> ? true : false;
type Schemas = components["schemas"];

export const releaseFits: Fits<Schemas["release"], typeof Release> = true;
export const releaseAssetFits: Fits<Schemas["release-asset"], typeof ReleaseAsset> = true;
export const notificationFits: Fits<Schemas["thread"], typeof RestNotification> = true;
export const workflowFits: Fits<Schemas["workflow"], typeof Workflow> = true;
export const checkAnnotationFits: Fits<Schemas["check-annotation"], typeof CheckAnnotation> = true;
