import { internal } from "@convex/_generated/api";
import { sha256Hex, stableStringify } from "@convex/domain/sourcePassages";
import {
    consultMissionStateInputValidator,
    consultRunStateInputValidator,
} from "./agentSchemas";
import type { AgentOperationDefinition } from "./executionProtocol";
import { operationReuseIdentity } from "./missionData";
import { consultMissionState } from "./missionHistory";

/** Read policies and execution are the same for native callers and generated tools. */
export const consultMissionStateOperation: AgentOperationDefinition = {
    version: 1,
    description: "Read persisted mission state and bounded observable history.",
    inputValidator: consultMissionStateInputValidator,
    identity(context) {
        return {
            ...operationReuseIdentity(context),
            stateVersion: context.mission?.nextEventSequence,
        };
    },
    async pin(_ctx, mission) {
        return mission
            ? { kind: "available", pin: { kind: "mission_history" } }
            : { kind: "unavailable", code: "mission_required" };
    },
    async execute(ctx, args) {
        if (!args.missionId || args.input.kind !== "consult_mission_state")
            return { kind: "refused", code: "mission_required" };
        return consultMissionState(ctx, {
            missionId: args.missionId,
            expectedGeneration: args.expectedGeneration,
            cursor: args.input.cursor,
        });
    },
    validateOutcome(_request, outcome) {
        return outcome;
    },
};
export const consultRunStateOperation: AgentOperationDefinition = {
    nativeAuthority: "dossier",
    version: 1,
    description:
        "Consult the authorized dossier's persisted lifecycle without starting work.",
    inputValidator: consultRunStateInputValidator,
    identity: operationReuseIdentity,
    async pin(ctx, mission, _input, runId) {
        const id = mission?.runId ?? runId;
        const run = id ? await ctx.db.get(id) : null;
        return run
            ? {
                  kind: "available",
                  pin: {
                      kind: "run_state",
                      stateHash: sha256Hex(
                          stableStringify({
                              lifecycle: run.lifecycleState,
                              status: run.executionStatus,
                              generation: run.executionGeneration,
                              updatedAt: run.updatedAt,
                          }),
                      ),
                  },
              }
            : { kind: "unavailable", code: "not_authorized" };
    },
    async execute(ctx, args) {
        if (!args.runId) return { kind: "refused", code: "not_authorized" };
        const value = await ctx.runQuery(
            internal.execution.operations.readRunState,
            {
                runId: args.runId,
                expectedGeneration: args.expectedGeneration,
                missionId: args.missionId,
            },
        );
        return { kind: "success", valueJson: JSON.stringify(value) };
    },
    validateOutcome(_request, outcome) {
        return outcome;
    },
};

export const commonOperations = {
    consult_mission_state: consultMissionStateOperation,
    consult_run_state: consultRunStateOperation,
};
