/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as admin from "../admin.js";
import type * as audit from "../audit.js";
import type * as auth from "../auth.js";
import type * as domain_invitationCodes from "../domain/invitationCodes.js";
import type * as domain_transitions from "../domain/transitions.js";
import type * as domain_validators from "../domain/validators.js";
import type * as http from "../http.js";
import type * as invitations from "../invitations.js";
import type * as researchRuns from "../researchRuns.js";
import type * as researchWorkflow from "../researchWorkflow.js";
import type * as visitors from "../visitors.js";
import type * as workflow from "../workflow.js";
import type * as workflowControls from "../workflowControls.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  admin: typeof admin;
  audit: typeof audit;
  auth: typeof auth;
  "domain/invitationCodes": typeof domain_invitationCodes;
  "domain/transitions": typeof domain_transitions;
  "domain/validators": typeof domain_validators;
  http: typeof http;
  invitations: typeof invitations;
  researchRuns: typeof researchRuns;
  researchWorkflow: typeof researchWorkflow;
  visitors: typeof visitors;
  workflow: typeof workflow;
  workflowControls: typeof workflowControls;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {
  workflow: import("@convex-dev/workflow/_generated/component.js").ComponentApi<"workflow">;
};
