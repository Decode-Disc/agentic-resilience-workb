import { internal } from "@convex/_generated/api";
import type { OperationOutcome } from "@convex/execution/agentDefinition";
import {
    executionFailureCode,
    executionFailureValidation,
} from "@convex/execution/errors";
import type { AgentOperationDefinition } from "@convex/execution/executionProtocol";
import { operationReuseIdentity } from "@convex/execution/missionData";
import {
    observeOperationOutcome,
    operationResultValidator,
} from "@convex/execution/operationResults";
import { v } from "convex/values";
import { validate } from "convex-helpers/validators";
import { savedMaterialOperations } from "./savedMaterialAgentOperations";
import { readPreparedNeed } from "./sources";
import { preparedNeedInspectionValidator } from "./sourcesContracts";
import { executionStatusValidator } from "./validators";
import {
    adjustFramingInput,
    consultPreparedMaterialInput,
    controlResearchInput,
    nativeAdjustFramingInput,
    nativeSourceRequestInput,
    publicContextInput,
    publicContextResultValidator,
    publicReadInput,
    publicReadResultValidator,
    publicSearchResultValidator,
    requestApprovalInput,
    requestApprovalResultValidator,
    sourceRequestInput,
    workbenchInstructionTransmissionStatus,
} from "./workbenchContracts";
import {
    responseReviewInput,
    responseReviewResult,
} from "./workbenchResponseControlContracts";

function recoverableWorkbenchRefusal(
    error: unknown,
): Extract<OperationOutcome, { kind: "refused" }> | undefined {
    const code = executionFailureCode(error);
    const validation = executionFailureValidation(error);
    return code &&
        [
            "stale_instructions",
            "framing_version_conflict",
            "framing_fixed",
            "framing_event_basis_required",
            "framing_event_basis_invalid",
            "framing_open_preserve_program",
            "framing_public_lookup_invalid",
            "framing_public_reference_undated",
            "framing_read_only",
            "framing_analyst_conflict",
            "framing_authority_unavailable",
            "framing_authority_capacity",
            "framing_question_capacity",
            "explicit_research_intent_required",
            "instruction_not_authorized",
            "instruction_capacity",
            "source_request_target_required",
            "version_conflict",
            "human_prerequisite_required",
        ].includes(code)
        ? {
              kind: "refused",
              code,
              ...(validation ? { validation } : {}),
          }
        : undefined;
}

const adjustFraming: Extract<
    AgentOperationDefinition,
    { effectKind: "atomic_effect" }
> = {
    effectKind: "atomic_effect",
    version: 1,
    description:
        "Update the proposed activity and research questions before Start research. Read and preserve explicit analyst adjustments. Supply the currently observed revision; stale edits are refused.",
    inputValidator: adjustFramingInput,
    resultValidator: operationResultValidator(
        v.object({ revision: v.number() }),
    ),
    identity: operationReuseIdentity,
    async pin(ctx, mission, input, _runId, effectPin) {
        if (!mission || input.kind !== "adjust_framing")
            return { kind: "unavailable", code: "mission_required" };
        const run = await ctx.db.get(mission.runId);
        if (effectPin?.kind === "framing_revision")
            return run?.currentFramingRevisionId === effectPin.revisionId
                ? { kind: "available", pin: effectPin }
                : { kind: "unavailable", code: "framing_version_conflict" };
        if (run?.lifecycleState !== "framing" || !run.currentFramingRevisionId)
            return { kind: "unavailable", code: "framing_fixed" };
        const revision = await ctx.db.get(run.currentFramingRevisionId);
        return revision?.revision === input.expectedRevision
            ? {
                  kind: "available",
                  pin: { kind: "framing_revision", revisionId: revision._id },
              }
            : { kind: "unavailable", code: "framing_version_conflict" };
    },
    async execute(ctx, args) {
        if (!args.requestId)
            return {
                outcome: { kind: "refused", code: "request_unavailable" },
            };
        try {
            const revision = await ctx.runMutation(
                internal.framing.applyFromWorkbench,
                {
                    requestId: args.requestId,
                    expectedGeneration: args.expectedGeneration,
                },
            );
            return {
                outcome: {
                    kind: "success",
                    value: { revision },
                },
            };
        } catch (error) {
            const refusal = recoverableWorkbenchRefusal(error);
            if (refusal) return { outcome: refusal };
            throw error;
        }
    },
    validateOutcome(_request, outcome) {
        return outcome;
    },
};

const instructionBehavior: Pick<
    Extract<AgentOperationDefinition, { effectKind: "atomic_effect" }>,
    "effectKind" | "identity" | "pin" | "execute" | "validateOutcome"
> = {
    effectKind: "atomic_effect",
    identity: operationReuseIdentity,
    async pin(ctx, mission, input, _runId, effectPin) {
        if (
            !mission ||
            (input.kind !== "control_research" &&
                input.kind !== "request_approval" &&
                input.kind !== "transmit_source_request")
        )
            return { kind: "unavailable", code: "operation_not_allowed" };
        const run = await ctx.db.get(mission.runId);
        const message = await ctx.db.get(input.messageId);
        if (
            !run?.fixedFramingRevisionId ||
            message?.runId !== run._id ||
            message.role !== "user" ||
            message.turnId !== mission.conversationTurnId
        )
            return { kind: "unavailable", code: "instruction_not_authorized" };
        if (input.kind === "transmit_source_request")
            return {
                kind: "available",
                pin: {
                    kind: "framing_revision",
                    revisionId: run.fixedFramingRevisionId,
                },
            };
        const pin = {
            kind: "workbench_instruction" as const,
            generation: run.executionGeneration,
            framingId: run.fixedFramingRevisionId,
            ...(run.researchControlRevision !== undefined
                ? { controlRevision: run.researchControlRevision }
                : {}),
        };
        if (effectPin) {
            if (
                effectPin.kind !== "workbench_instruction" ||
                effectPin.framingId !== pin.framingId ||
                (effectPin.controlRevision ?? 0) !== (pin.controlRevision ?? 0)
            )
                return { kind: "unavailable", code: "version_conflict" };
            const ownPauseSettled =
                ((input.kind === "control_research" &&
                    input.action === "pause") ||
                    (input.kind === "request_approval" &&
                        input.action === "pause_research")) &&
                run.executionGeneration === effectPin.generation + 1 &&
                run.executionStatus === "paused" &&
                run.pauseReason === "analyst";
            if (effectPin.generation !== pin.generation && !ownPauseSettled)
                return { kind: "unavailable", code: "version_conflict" };
            return { kind: "available", pin: effectPin };
        }
        return { kind: "available", pin };
    },
    async execute(ctx, args) {
        if (!args.requestId)
            return {
                outcome: { kind: "refused", code: "request_unavailable" },
            };
        try {
            const value = await ctx.runMutation(
                internal.workbench.performInstruction,
                {
                    requestId: args.requestId,
                    expectedGeneration: args.expectedGeneration,
                },
            );
            return { outcome: { kind: "success", value: JSON.parse(value) } };
        } catch (error) {
            const refusal = recoverableWorkbenchRefusal(error);
            if (refusal) return { outcome: refusal };
            throw error;
        }
    },
    validateOutcome(_request, outcome) {
        return outcome;
    },
};

const transmitSourceRequest: AgentOperationDefinition = {
    ...instructionBehavior,
    version: 1,
    inputValidator: sourceRequestInput,
    resultValidator: operationResultValidator(
        v.object({
            instructionId: v.id("workbenchInstructions"),
            status: workbenchInstructionTransmissionStatus,
            outcome: v.string(),
        }),
    ),
    description:
        "Register an analyst's documentary instruction with its original message and your interpreted need. Supply a coverage role only for a supported targeted search within the fixed framing. Initial work or an analyst pause may defer transmission. Other requests receive an explicit limitation; this tool does not open another documentary phase.",
};

/** Host-owned assessment uses the shared durable operation lifecycle, never a model-visible tool. */
export const responseCoherenceOperation: Extract<
    AgentOperationDefinition,
    { effectKind: "durable_effect" }
> = {
    systemOnly: true,
    effectKind: "durable_effect",
    unknownOutcome: { kind: "unavailable", code: "operation_outcome_unknown" },
    version: 1,
    description:
        "Check a retained response against its frozen authoritative facts.",
    inputValidator: responseReviewInput,
    resultValidator: operationResultValidator(responseReviewResult),
    identity: operationReuseIdentity,
    async pin(ctx, mission, input) {
        if (
            !mission ||
            input.kind !== "check_response_coherence" ||
            !mission.conversationTurnId
        )
            return { kind: "unavailable", code: "operation_not_allowed" };
        const turn = await ctx.db.get(mission.conversationTurnId);
        const requestHash = input.requestHash;
        const check = turn?.responseControl?.checks.find(
            (c) => c.requestHash === requestHash,
        );
        return check?.requestHash
            ? {
                  kind: "available",
                  pin: { kind: "response_review", hash: check.requestHash },
              }
            : { kind: "unavailable", code: "response_review_unavailable" };
    },
    async execute(ctx, args) {
        if (!args.requestId)
            return {
                outcome: { kind: "refused", code: "request_unavailable" },
            };
        const value = await ctx.runAction(
            internal.responseControlActions.execute,
            {
                requestId: args.requestId,
                expectedGeneration: args.expectedGeneration,
            },
        );
        return {
            outcome:
                value.status === "unavailable"
                    ? { kind: "unavailable", code: value.reason }
                    : { kind: "success", value },
        };
    },
    validateOutcome(_request, outcome) {
        return outcome;
    },
};

export const workbenchOperations: Record<string, AgentOperationDefinition> = {
    consult_prepared_material: {
        effectKind: "read",
        nativeAuthority: "dossier",
        version: 1,
        description:
            "Read the complete outcome of an observed documentary need, including its gap, unfinished reasons, contribution references and restrictions. Choose needId from documentaryPreparation.needReferences. Context previews are incomplete; this operation does not retrieve source passages or start research.",
        inputValidator: consultPreparedMaterialInput,
        resultValidator: operationResultValidator(
            preparedNeedInspectionValidator,
        ),
        identity: operationReuseIdentity,
        async pin(ctx, mission, input, runId) {
            const id = mission?.runId ?? runId;
            const run = id ? await ctx.db.get(id) : null;
            if (!run || input.kind !== "consult_prepared_material")
                return { kind: "unavailable", code: "not_authorized" };
            const result = await readPreparedNeed(ctx, run, input.needId);
            return result.kind === "available"
                ? { kind: "available", pin: result.pin }
                : result;
        },
        async execute(ctx, args) {
            if (!args.requestId)
                return {
                    outcome: { kind: "refused", code: "request_unavailable" },
                };
            const result = await ctx.runQuery(
                internal.sourcesMission.inspectPreparedNeed,
                {
                    requestId: args.requestId,
                    expectedGeneration: args.expectedGeneration,
                },
            );
            return {
                outcome:
                    result.kind === "available"
                        ? { kind: "success", value: result.value }
                        : result,
            };
        },
        validateOutcome(request, outcome) {
            if (outcome.kind !== "success") return outcome;
            const value = preparedNeedInspectionValidator;
            const parsed: unknown = JSON.parse(outcome.valueJson);
            if (
                !validate(value, parsed) ||
                request.input.kind !== "consult_prepared_material" ||
                request.pin?.kind !== "prepared_material" ||
                parsed.preparationId !== request.pin.preparationId ||
                parsed.need.id !== request.input.needId
            )
                return {
                    kind: "refused",
                    code: "prepared_material_identity_conflict",
                };
            return outcome;
        },
    },
    check_response_coherence: responseCoherenceOperation,
    adjust_framing: adjustFraming,
    ...savedMaterialOperations,
    control_research: {
        ...instructionBehavior,
        version: 1,
        inputValidator: controlResearchInput,
        resultValidator: operationResultValidator(
            v.object({
                generation: v.number(),
                status: executionStatusValidator,
                pauseRequested: v.boolean(),
            }),
        ),
        description:
            "Pause or resume research only on an explicit, unambiguous analyst request in the supplied message. A pause request lets admitted work finish before suspension; never claim an effective pause before its persisted state confirms it.",
    },
    request_approval: {
        ...instructionBehavior,
        version: 1,
        inputValidator: requestApprovalInput,
        resultValidator: operationResultValidator(
            requestApprovalResultValidator,
        ),
        description:
            "Ask the person to approve a research action you inferred from their message. Nothing changes until they approve, unless the action is already allowed for this dossier. An exact pause or resume command applies immediately. If a request covering the same action is already pending, it is shown again.",
    },
    transmit_source_request: transmitSourceRequest,
};

const publicContextOperation: Extract<
    AgentOperationDefinition,
    { effectKind: "durable_effect" }
> = {
    effectKind: "durable_effect",
    unknownOutcome: {
        kind: "unavailable",
        code: "operation_outcome_unknown",
    },
    version: 1,
    description:
        "Read dated public context about the confirmed company while framing. Search for the unresolved event or context. Only returned excerpts are readings.",
    inputValidator: publicContextInput,
    resultValidator: operationResultValidator(publicContextResultValidator),
    identity: operationReuseIdentity,
    async pin(ctx, mission, input, _runId, effectPin) {
        if (
            !mission ||
            (input.kind !== "verify_public_context" &&
                input.kind !== "search_public_context" &&
                input.kind !== "read_public_context")
        )
            return { kind: "unavailable", code: "mission_required" };
        const run = await ctx.db.get(mission.runId);
        if (run?.lifecycleState !== "framing" || !run.currentFramingRevisionId)
            return { kind: "unavailable", code: "framing_fixed" };
        if (
            effectPin &&
            (effectPin.kind !== "framing_revision" ||
                effectPin.revisionId !== run.currentFramingRevisionId)
        )
            return {
                kind: "unavailable",
                code: "framing_version_conflict",
            };
        return {
            kind: "available",
            pin: {
                kind: "framing_revision",
                revisionId: run.currentFramingRevisionId,
            },
        };
    },
    async execute(ctx, args) {
        if (!args.requestId)
            return {
                outcome: { kind: "refused", code: "request_unavailable" },
            };
        return {
            outcome: observeOperationOutcome(
                await ctx.runAction(
                    internal.workbenchPublicContextActions.execute,
                    {
                        requestId: args.requestId,
                        expectedGeneration: args.expectedGeneration,
                    },
                ),
            ),
        };
    },
    validateOutcome(_request, outcome) {
        return outcome;
    },
};

export const nativeWorkbenchOperations: Record<
    string,
    AgentOperationDefinition
> = {
    ...workbenchOperations,
    verify_public_context: publicContextOperation,
    adjust_framing: {
        ...adjustFraming,
        version: 2,
        inputValidator: nativeAdjustFramingInput,
    },
    transmit_source_request: {
        ...transmitSourceRequest,
        version: 2,
        inputValidator: nativeSourceRequestInput,
        description: `${transmitSourceRequest.description} Choose the matching coverageRole explicitly, or null if no supported role matches; never omit this choice. Public commercial terms use official_commercial_terms.`,
    },
};

/** v5 separates discovery from reading; retained v4 keeps its combined operation object. */
export const directedWorkbenchOperations: Record<
    string,
    AgentOperationDefinition
> = {
    ...Object.fromEntries(
        Object.entries(nativeWorkbenchOperations).filter(
            ([name]) => name !== "verify_public_context",
        ),
    ),
    read_public_context: {
        ...publicContextOperation,
        description:
            "Read a publication selected by index from an adopted search, or a public HTTPS reference supplied by the active analyst. Only the returned extent was read. If continuation is returned, repeat the same target with that continuation to read the next passage from the exact retained representation without another external acquisition. Acquisition completeness and remaining retained text are separate. Only returned passages are readings.",
        inputValidator: publicReadInput,
        resultValidator: operationResultValidator(publicReadResultValidator),
    },
    search_public_context: {
        ...publicContextOperation,
        effectKind: "durable_effect",
        description:
            "Discover public leads about the confirmed company without reading publications. Inspect dates and titles, reformulate if useful, and select a publication separately. Candidates are not evidence.",
        inputValidator: publicContextInput,
        resultValidator: operationResultValidator(publicSearchResultValidator),
    },
};
