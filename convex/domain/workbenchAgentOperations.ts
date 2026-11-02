import { internal } from "@convex/_generated/api";
import type { OperationOutcome } from "@convex/execution/agentDefinition";
import { executionFailureCode } from "@convex/execution/errors";
import type { AgentOperationDefinition } from "@convex/execution/executionProtocol";
import { operationReuseIdentity } from "@convex/execution/missionData";
import { savedMaterialOperations } from "./savedMaterialAgentOperations";
import {
    adjustFramingInput,
    controlResearchInput,
    nativeAdjustFramingInput,
    nativeSourceRequestInput,
    sourceRequestInput,
} from "./workbenchContracts";

function recoverableWorkbenchRefusal(
    error: unknown,
): OperationOutcome | undefined {
    const code = executionFailureCode(error);
    return code &&
        [
            "stale_instructions",
            "framing_version_conflict",
            "framing_fixed",
            "framing_read_only",
            "framing_analyst_conflict",
            "framing_authority_unavailable",
            "framing_authority_capacity",
            "explicit_research_intent_required",
            "instruction_not_authorized",
            "instruction_capacity",
            "source_request_target_required",
            "version_conflict",
            "human_prerequisite_required",
        ].includes(code)
        ? { kind: "refused", code }
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
                    valueJson: JSON.stringify({ revision }),
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
                input.action === "pause" &&
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
            return { outcome: { kind: "success", valueJson: value } };
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
    description:
        "Register an analyst's documentary instruction with its original message and your interpreted need. Supply a coverage role only for a supported targeted search within the fixed framing. Initial work or an analyst pause may defer transmission. Other requests receive an explicit limitation; this tool does not open another documentary phase.",
};

export const workbenchOperations: Record<string, AgentOperationDefinition> = {
    adjust_framing: adjustFraming,
    ...savedMaterialOperations,
    control_research: {
        ...instructionBehavior,
        version: 1,
        inputValidator: controlResearchInput,
        description:
            "Pause or resume research only on an explicit, unambiguous analyst request in the supplied message. A pause request lets admitted work finish before suspension; never claim an effective pause before its persisted state confirms it.",
    },
    transmit_source_request: transmitSourceRequest,
};

export const nativeWorkbenchOperations: Record<
    string,
    AgentOperationDefinition
> = {
    ...workbenchOperations,
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
