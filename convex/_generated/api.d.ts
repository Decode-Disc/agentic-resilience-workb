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
import type * as browserPreview from "../browserPreview.js";
import type * as browserPreviewInternals from "../browserPreviewInternals.js";
import type * as claimGeneration from "../claimGeneration.js";
import type * as companyCoverImage from "../companyCoverImage.js";
import type * as companyResolution from "../companyResolution.js";
import type * as domain_claimCanonicalization from "../domain/claimCanonicalization.js";
import type * as domain_claimValidation from "../domain/claimValidation.js";
import type * as domain_claims from "../domain/claims.js";
import type * as domain_companyMetadata from "../domain/companyMetadata.js";
import type * as domain_conversationValidation from "../domain/conversationValidation.js";
import type * as domain_conversationValidationContracts from "../domain/conversationValidationContracts.js";
import type * as domain_coverImageUrl from "../domain/coverImageUrl.js";
import type * as domain_evidenceArtifacts from "../domain/evidenceArtifacts.js";
import type * as domain_evidenceAuthority from "../domain/evidenceAuthority.js";
import type * as domain_evidenceAvailabilityPolicy from "../domain/evidenceAvailabilityPolicy.js";
import type * as domain_evidenceFailure from "../domain/evidenceFailure.js";
import type * as domain_evidenceFanout from "../domain/evidenceFanout.js";
import type * as domain_evidenceLimits from "../domain/evidenceLimits.js";
import type * as domain_evidencePolicy from "../domain/evidencePolicy.js";
import type * as domain_executionClaim from "../domain/executionClaim.js";
import type * as domain_executionValidationAgent from "../domain/executionValidationAgent.js";
import type * as domain_executionValidationContracts from "../domain/executionValidationContracts.js";
import type * as domain_framingContracts from "../domain/framingContracts.js";
import type * as domain_invitationCodes from "../domain/invitationCodes.js";
import type * as domain_manualSourceIntake from "../domain/manualSourceIntake.js";
import type * as domain_previewCache from "../domain/previewCache.js";
import type * as domain_providerAvailability from "../domain/providerAvailability.js";
import type * as domain_publicSourceUrl from "../domain/publicSourceUrl.js";
import type * as domain_researchContext from "../domain/researchContext.js";
import type * as domain_researchPlan from "../domain/researchPlan.js";
import type * as domain_runCancellation from "../domain/runCancellation.js";
import type * as domain_runPurpose from "../domain/runPurpose.js";
import type * as domain_runWithdrawal from "../domain/runWithdrawal.js";
import type * as domain_savedMaterial from "../domain/savedMaterial.js";
import type * as domain_savedMaterialInspection from "../domain/savedMaterialInspection.js";
import type * as domain_savedMaterialOperations from "../domain/savedMaterialOperations.js";
import type * as domain_savedMaterialSimulation from "../domain/savedMaterialSimulation.js";
import type * as domain_showcaseManifest from "../domain/showcaseManifest.js";
import type * as domain_sourceCandidateCapacity from "../domain/sourceCandidateCapacity.js";
import type * as domain_sourceComparison from "../domain/sourceComparison.js";
import type * as domain_sourceComparisonContext from "../domain/sourceComparisonContext.js";
import type * as domain_sourceDiscoveryRecovery from "../domain/sourceDiscoveryRecovery.js";
import type * as domain_sourcePassages from "../domain/sourcePassages.js";
import type * as domain_sourcePreparationAuthority from "../domain/sourcePreparationAuthority.js";
import type * as domain_sourcePreparationReview from "../domain/sourcePreparationReview.js";
import type * as domain_sourceQualification from "../domain/sourceQualification.js";
import type * as domain_sourceRetrievalPolicy from "../domain/sourceRetrievalPolicy.js";
import type * as domain_sourceReviewProjection from "../domain/sourceReviewProjection.js";
import type * as domain_sourceReviewReads from "../domain/sourceReviewReads.js";
import type * as domain_sourceSelectionPolicy from "../domain/sourceSelectionPolicy.js";
import type * as domain_sourceUsage from "../domain/sourceUsage.js";
import type * as domain_transitions from "../domain/transitions.js";
import type * as domain_validators from "../domain/validators.js";
import type * as domain_workbench from "../domain/workbench.js";
import type * as domain_workbenchContracts from "../domain/workbenchContracts.js";
import type * as e2eFixtures from "../e2eFixtures.js";
import type * as evidenceActions from "../evidenceActions.js";
import type * as evidenceArtifacts from "../evidenceArtifacts.js";
import type * as evidenceExecution from "../evidenceExecution.js";
import type * as evidenceMatrix from "../evidenceMatrix.js";
import type * as evidenceSufficiency from "../evidenceSufficiency.js";
import type * as evidenceWorkflow from "../evidenceWorkflow.js";
import type * as exaDiscoveryActions from "../exaDiscoveryActions.js";
import type * as execution_agentCatalog from "../execution/agentCatalog.js";
import type * as execution_agentDefinition from "../execution/agentDefinition.js";
import type * as execution_agentSchemas from "../execution/agentSchemas.js";
import type * as execution_authority from "../execution/authority.js";
import type * as execution_cancellation from "../execution/cancellation.js";
import type * as execution_commonOperations from "../execution/commonOperations.js";
import type * as execution_context from "../execution/context.js";
import type * as execution_conversations from "../execution/conversations.js";
import type * as execution_errors from "../execution/errors.js";
import type * as execution_executionProtocol from "../execution/executionProtocol.js";
import type * as execution_fixtures from "../execution/fixtures.js";
import type * as execution_handoffs from "../execution/handoffs.js";
import type * as execution_invocationLifecycle from "../execution/invocationLifecycle.js";
import type * as execution_invocations from "../execution/invocations.js";
import type * as execution_invokeAgentModel from "../execution/invokeAgentModel.js";
import type * as execution_journal from "../execution/journal.js";
import type * as execution_missionData from "../execution/missionData.js";
import type * as execution_missionHistory from "../execution/missionHistory.js";
import type * as execution_missionWorkflow from "../execution/missionWorkflow.js";
import type * as execution_missions from "../execution/missions.js";
import type * as execution_modelActions from "../execution/modelActions.js";
import type * as execution_operations from "../execution/operations.js";
import type * as execution_piControl from "../execution/piControl.js";
import type * as execution_piStore from "../execution/piStore.js";
import type * as execution_piWorker from "../execution/piWorker.js";
import type * as execution_researchControl from "../execution/researchControl.js";
import type * as execution_simulation from "../execution/simulation.js";
import type * as fixtureManifestStore from "../fixtureManifestStore.js";
import type * as fixtures_cccShowcase from "../fixtures/cccShowcase.js";
import type * as framing from "../framing.js";
import type * as http from "../http.js";
import type * as integrations_agentBackends from "../integrations/agentBackends.js";
import type * as integrations_agentStorage from "../integrations/agentStorage.js";
import type * as integrations_approvedSourceRetrieval from "../integrations/approvedSourceRetrieval.js";
import type * as integrations_evidenceNormalization from "../integrations/evidenceNormalization.js";
import type * as integrations_exa from "../integrations/exa.js";
import type * as integrations_exaContentsClient from "../integrations/exaContentsClient.js";
import type * as integrations_exaEvidence from "../integrations/exaEvidence.js";
import type * as integrations_modelInput from "../integrations/modelInput.js";
import type * as integrations_modelRouting from "../integrations/modelRouting.js";
import type * as integrations_modelTransport from "../integrations/modelTransport.js";
import type * as integrations_piMission from "../integrations/piMission.js";
import type * as integrations_piStorage from "../integrations/piStorage.js";
import type * as integrations_piToolArguments from "../integrations/piToolArguments.js";
import type * as integrations_publicPdfEvidence from "../integrations/publicPdfEvidence.js";
import type * as integrations_sec from "../integrations/sec.js";
import type * as integrations_secEvidence from "../integrations/secEvidence.js";
import type * as integrations_showcaseClaimAdapter from "../integrations/showcaseClaimAdapter.js";
import type * as integrations_showcaseVerifierAdapter from "../integrations/showcaseVerifierAdapter.js";
import type * as integrations_sourceEmbeddings from "../integrations/sourceEmbeddings.js";
import type * as integrations_sourceQualification from "../integrations/sourceQualification.js";
import type * as integrations_sourceQualificationConfig from "../integrations/sourceQualificationConfig.js";
import type * as integrations_websiteResolver from "../integrations/websiteResolver.js";
import type * as invitations from "../invitations.js";
import type * as policyEvaluations from "../policyEvaluations.js";
import type * as providerCalls from "../providerCalls.js";
import type * as rateLimiter from "../rateLimiter.js";
import type * as researchLaunch from "../researchLaunch.js";
import type * as researchPlanning from "../researchPlanning.js";
import type * as researchRuns from "../researchRuns.js";
import type * as researchWorkflow from "../researchWorkflow.js";
import type * as resourceLimits from "../resourceLimits.js";
import type * as retrievalEvaluation from "../retrievalEvaluation.js";
import type * as runWorkspace from "../runWorkspace.js";
import type * as sourceActions from "../sourceActions.js";
import type * as sourceCaptures from "../sourceCaptures.js";
import type * as sourceDiscovery from "../sourceDiscovery.js";
import type * as sourceDiscoveryActions from "../sourceDiscoveryActions.js";
import type * as sourceIntake from "../sourceIntake.js";
import type * as sourcePreparation from "../sourcePreparation.js";
import type * as sourcePreparationActions from "../sourcePreparationActions.js";
import type * as sourcePreparationEvaluation from "../sourcePreparationEvaluation.js";
import type * as sourcePreparationStudyPolicy from "../sourcePreparationStudyPolicy.js";
import type * as sourcePreparationWorkflow from "../sourcePreparationWorkflow.js";
import type * as sourceRetrieval from "../sourceRetrieval.js";
import type * as sourceRetrievalActions from "../sourceRetrievalActions.js";
import type * as sourceSelectionProposalActions from "../sourceSelectionProposalActions.js";
import type * as sourceSelectionProposals from "../sourceSelectionProposals.js";
import type * as sources from "../sources.js";
import type * as visitors from "../visitors.js";
import type * as workbench from "../workbench.js";
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
  browserPreview: typeof browserPreview;
  browserPreviewInternals: typeof browserPreviewInternals;
  claimGeneration: typeof claimGeneration;
  companyCoverImage: typeof companyCoverImage;
  companyResolution: typeof companyResolution;
  "domain/claimCanonicalization": typeof domain_claimCanonicalization;
  "domain/claimValidation": typeof domain_claimValidation;
  "domain/claims": typeof domain_claims;
  "domain/companyMetadata": typeof domain_companyMetadata;
  "domain/conversationValidation": typeof domain_conversationValidation;
  "domain/conversationValidationContracts": typeof domain_conversationValidationContracts;
  "domain/coverImageUrl": typeof domain_coverImageUrl;
  "domain/evidenceArtifacts": typeof domain_evidenceArtifacts;
  "domain/evidenceAuthority": typeof domain_evidenceAuthority;
  "domain/evidenceAvailabilityPolicy": typeof domain_evidenceAvailabilityPolicy;
  "domain/evidenceFailure": typeof domain_evidenceFailure;
  "domain/evidenceFanout": typeof domain_evidenceFanout;
  "domain/evidenceLimits": typeof domain_evidenceLimits;
  "domain/evidencePolicy": typeof domain_evidencePolicy;
  "domain/executionClaim": typeof domain_executionClaim;
  "domain/executionValidationAgent": typeof domain_executionValidationAgent;
  "domain/executionValidationContracts": typeof domain_executionValidationContracts;
  "domain/framingContracts": typeof domain_framingContracts;
  "domain/invitationCodes": typeof domain_invitationCodes;
  "domain/manualSourceIntake": typeof domain_manualSourceIntake;
  "domain/previewCache": typeof domain_previewCache;
  "domain/providerAvailability": typeof domain_providerAvailability;
  "domain/publicSourceUrl": typeof domain_publicSourceUrl;
  "domain/researchContext": typeof domain_researchContext;
  "domain/researchPlan": typeof domain_researchPlan;
  "domain/runCancellation": typeof domain_runCancellation;
  "domain/runPurpose": typeof domain_runPurpose;
  "domain/runWithdrawal": typeof domain_runWithdrawal;
  "domain/savedMaterial": typeof domain_savedMaterial;
  "domain/savedMaterialInspection": typeof domain_savedMaterialInspection;
  "domain/savedMaterialOperations": typeof domain_savedMaterialOperations;
  "domain/savedMaterialSimulation": typeof domain_savedMaterialSimulation;
  "domain/showcaseManifest": typeof domain_showcaseManifest;
  "domain/sourceCandidateCapacity": typeof domain_sourceCandidateCapacity;
  "domain/sourceComparison": typeof domain_sourceComparison;
  "domain/sourceComparisonContext": typeof domain_sourceComparisonContext;
  "domain/sourceDiscoveryRecovery": typeof domain_sourceDiscoveryRecovery;
  "domain/sourcePassages": typeof domain_sourcePassages;
  "domain/sourcePreparationAuthority": typeof domain_sourcePreparationAuthority;
  "domain/sourcePreparationReview": typeof domain_sourcePreparationReview;
  "domain/sourceQualification": typeof domain_sourceQualification;
  "domain/sourceRetrievalPolicy": typeof domain_sourceRetrievalPolicy;
  "domain/sourceReviewProjection": typeof domain_sourceReviewProjection;
  "domain/sourceReviewReads": typeof domain_sourceReviewReads;
  "domain/sourceSelectionPolicy": typeof domain_sourceSelectionPolicy;
  "domain/sourceUsage": typeof domain_sourceUsage;
  "domain/transitions": typeof domain_transitions;
  "domain/validators": typeof domain_validators;
  "domain/workbench": typeof domain_workbench;
  "domain/workbenchContracts": typeof domain_workbenchContracts;
  e2eFixtures: typeof e2eFixtures;
  evidenceActions: typeof evidenceActions;
  evidenceArtifacts: typeof evidenceArtifacts;
  evidenceExecution: typeof evidenceExecution;
  evidenceMatrix: typeof evidenceMatrix;
  evidenceSufficiency: typeof evidenceSufficiency;
  evidenceWorkflow: typeof evidenceWorkflow;
  exaDiscoveryActions: typeof exaDiscoveryActions;
  "execution/agentCatalog": typeof execution_agentCatalog;
  "execution/agentDefinition": typeof execution_agentDefinition;
  "execution/agentSchemas": typeof execution_agentSchemas;
  "execution/authority": typeof execution_authority;
  "execution/cancellation": typeof execution_cancellation;
  "execution/commonOperations": typeof execution_commonOperations;
  "execution/context": typeof execution_context;
  "execution/conversations": typeof execution_conversations;
  "execution/errors": typeof execution_errors;
  "execution/executionProtocol": typeof execution_executionProtocol;
  "execution/fixtures": typeof execution_fixtures;
  "execution/handoffs": typeof execution_handoffs;
  "execution/invocationLifecycle": typeof execution_invocationLifecycle;
  "execution/invocations": typeof execution_invocations;
  "execution/invokeAgentModel": typeof execution_invokeAgentModel;
  "execution/journal": typeof execution_journal;
  "execution/missionData": typeof execution_missionData;
  "execution/missionHistory": typeof execution_missionHistory;
  "execution/missionWorkflow": typeof execution_missionWorkflow;
  "execution/missions": typeof execution_missions;
  "execution/modelActions": typeof execution_modelActions;
  "execution/operations": typeof execution_operations;
  "execution/piControl": typeof execution_piControl;
  "execution/piStore": typeof execution_piStore;
  "execution/piWorker": typeof execution_piWorker;
  "execution/researchControl": typeof execution_researchControl;
  "execution/simulation": typeof execution_simulation;
  fixtureManifestStore: typeof fixtureManifestStore;
  "fixtures/cccShowcase": typeof fixtures_cccShowcase;
  framing: typeof framing;
  http: typeof http;
  "integrations/agentBackends": typeof integrations_agentBackends;
  "integrations/agentStorage": typeof integrations_agentStorage;
  "integrations/approvedSourceRetrieval": typeof integrations_approvedSourceRetrieval;
  "integrations/evidenceNormalization": typeof integrations_evidenceNormalization;
  "integrations/exa": typeof integrations_exa;
  "integrations/exaContentsClient": typeof integrations_exaContentsClient;
  "integrations/exaEvidence": typeof integrations_exaEvidence;
  "integrations/modelInput": typeof integrations_modelInput;
  "integrations/modelRouting": typeof integrations_modelRouting;
  "integrations/modelTransport": typeof integrations_modelTransport;
  "integrations/piMission": typeof integrations_piMission;
  "integrations/piStorage": typeof integrations_piStorage;
  "integrations/piToolArguments": typeof integrations_piToolArguments;
  "integrations/publicPdfEvidence": typeof integrations_publicPdfEvidence;
  "integrations/sec": typeof integrations_sec;
  "integrations/secEvidence": typeof integrations_secEvidence;
  "integrations/showcaseClaimAdapter": typeof integrations_showcaseClaimAdapter;
  "integrations/showcaseVerifierAdapter": typeof integrations_showcaseVerifierAdapter;
  "integrations/sourceEmbeddings": typeof integrations_sourceEmbeddings;
  "integrations/sourceQualification": typeof integrations_sourceQualification;
  "integrations/sourceQualificationConfig": typeof integrations_sourceQualificationConfig;
  "integrations/websiteResolver": typeof integrations_websiteResolver;
  invitations: typeof invitations;
  policyEvaluations: typeof policyEvaluations;
  providerCalls: typeof providerCalls;
  rateLimiter: typeof rateLimiter;
  researchLaunch: typeof researchLaunch;
  researchPlanning: typeof researchPlanning;
  researchRuns: typeof researchRuns;
  researchWorkflow: typeof researchWorkflow;
  resourceLimits: typeof resourceLimits;
  retrievalEvaluation: typeof retrievalEvaluation;
  runWorkspace: typeof runWorkspace;
  sourceActions: typeof sourceActions;
  sourceCaptures: typeof sourceCaptures;
  sourceDiscovery: typeof sourceDiscovery;
  sourceDiscoveryActions: typeof sourceDiscoveryActions;
  sourceIntake: typeof sourceIntake;
  sourcePreparation: typeof sourcePreparation;
  sourcePreparationActions: typeof sourcePreparationActions;
  sourcePreparationEvaluation: typeof sourcePreparationEvaluation;
  sourcePreparationStudyPolicy: typeof sourcePreparationStudyPolicy;
  sourcePreparationWorkflow: typeof sourcePreparationWorkflow;
  sourceRetrieval: typeof sourceRetrieval;
  sourceRetrievalActions: typeof sourceRetrievalActions;
  sourceSelectionProposalActions: typeof sourceSelectionProposalActions;
  sourceSelectionProposals: typeof sourceSelectionProposals;
  sources: typeof sources;
  visitors: typeof visitors;
  workbench: typeof workbench;
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
  rateLimiter: import("@convex-dev/rate-limiter/_generated/component.js").ComponentApi<"rateLimiter">;
  agent: import("@convex-dev/agent/_generated/component.js").ComponentApi<"agent">;
};
