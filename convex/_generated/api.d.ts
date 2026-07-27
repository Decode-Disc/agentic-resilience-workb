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
import type * as adminOperations from "../adminOperations.js";
import type * as audit from "../audit.js";
import type * as auth from "../auth.js";
import type * as companyResolution from "../companyResolution.js";
import type * as domain_evidenceAvailabilityPolicy from "../domain/evidenceAvailabilityPolicy.js";
import type * as domain_invitationCodes from "../domain/invitationCodes.js";
import type * as domain_publicSourceUrl from "../domain/publicSourceUrl.js";
import type * as domain_researchPlan from "../domain/researchPlan.js";
import type * as domain_transitions from "../domain/transitions.js";
import type * as domain_validators from "../domain/validators.js";
import type * as evidenceSufficiency from "../evidenceSufficiency.js";
import type * as exaDiscoveryActions from "../exaDiscoveryActions.js";
import type * as http from "../http.js";
import type * as integrations_exa from "../integrations/exa.js";
import type * as integrations_sec from "../integrations/sec.js";
import type * as invitations from "../invitations.js";
import type * as providerCalls from "../providerCalls.js";
import type * as researchLaunch from "../researchLaunch.js";
import type * as researchPlanning from "../researchPlanning.js";
import type * as researchRuns from "../researchRuns.js";
import type * as researchWorkflow from "../researchWorkflow.js";
import type * as sourceActions from "../sourceActions.js";
import type * as sourceDiscovery from "../sourceDiscovery.js";
import type * as sourceDiscoveryActions from "../sourceDiscoveryActions.js";
import type * as sources from "../sources.js";
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
  adminOperations: typeof adminOperations;
  audit: typeof audit;
  auth: typeof auth;
  companyResolution: typeof companyResolution;
  "domain/evidenceAvailabilityPolicy": typeof domain_evidenceAvailabilityPolicy;
  "domain/invitationCodes": typeof domain_invitationCodes;
  "domain/publicSourceUrl": typeof domain_publicSourceUrl;
  "domain/researchPlan": typeof domain_researchPlan;
  "domain/transitions": typeof domain_transitions;
  "domain/validators": typeof domain_validators;
  evidenceSufficiency: typeof evidenceSufficiency;
  exaDiscoveryActions: typeof exaDiscoveryActions;
  http: typeof http;
  "integrations/exa": typeof integrations_exa;
  "integrations/sec": typeof integrations_sec;
  invitations: typeof invitations;
  providerCalls: typeof providerCalls;
  researchLaunch: typeof researchLaunch;
  researchPlanning: typeof researchPlanning;
  researchRuns: typeof researchRuns;
  researchWorkflow: typeof researchWorkflow;
  sourceActions: typeof sourceActions;
  sourceDiscovery: typeof sourceDiscovery;
  sourceDiscoveryActions: typeof sourceDiscoveryActions;
  sources: typeof sources;
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
