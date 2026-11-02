import { internal } from "@convex/_generated/api";
import { sha256Hex, stableStringify } from "@convex/domain/sourcePassages";
import {
    consultConversationInputValidator,
    consultMissionStateInputValidator,
    consultRunStateInputValidator,
} from "./agentSchemas";
import { executionError, executionFailureCode } from "./errors";
import type { AgentOperationDefinition } from "./executionProtocol";
import { operationReuseIdentity } from "./missionData";
import { consultMissionState } from "./missionHistory";

/** Read policies and execution are the same for native callers and generated tools. */
export const consultMissionStateOperation: Extract<
    AgentOperationDefinition,
    { effectKind: "read" }
> = {
    effectKind: "read",
    version: 1,
    description:
        "Read only the current mission state and its bounded observable work history. For earlier analyst exchanges use consult_conversation. Omit cursor on the first read; on later pages copy only continueCursor returned by this operation, never a mission, turn or conversation ID.",
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
            return { outcome: { kind: "refused", code: "mission_required" } };
        return {
            outcome: await consultMissionState(ctx, {
                missionId: args.missionId,
                expectedGeneration: args.expectedGeneration,
                cursor: args.input.cursor,
            }),
        };
    },
    validateOutcome(_request, outcome) {
        return outcome;
    },
};
export const consultRunStateOperation: Extract<
    AgentOperationDefinition,
    { effectKind: "read" }
> = {
    effectKind: "read",
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
        if (!args.runId)
            return { outcome: { kind: "refused", code: "not_authorized" } };
        const value = await ctx.runQuery(
            internal.execution.operations.readRunState,
            {
                runId: args.runId,
                expectedGeneration: args.expectedGeneration,
                missionId: args.missionId,
            },
        );
        return {
            outcome: { kind: "success", valueJson: JSON.stringify(value) },
        };
    },
    validateOutcome(_request, outcome) {
        return outcome;
    },
};

const consultConversation: Extract<
    AgentOperationDefinition,
    { effectKind: "read" }
> = {
    ...consultMissionStateOperation,
    description:
        "Read exact prior processed conversation messages in bounded fragments; queued instructions are excluded. Omit cursor on the first read; on later pages copy only continueCursor returned by this operation, never a mission, turn or conversation ID.",
    inputValidator: consultConversationInputValidator,
    async execute(ctx, args) {
        if (!args.missionId || args.input.kind !== "consult_conversation")
            return { outcome: { kind: "refused", code: "mission_required" } };
        try {
            const valueJson = await ctx.runQuery(
                internal.execution.conversations.historyForMission,
                {
                    missionId: args.missionId,
                    expectedGeneration: args.expectedGeneration,
                    cursor: args.input.cursor,
                },
            );
            const page: unknown = JSON.parse(valueJson);
            if (
                !page ||
                typeof page !== "object" ||
                !("entries" in page) ||
                !Array.isArray(page.entries)
            )
                throw executionError("conversation_message_unavailable");
            return {
                outcome: {
                    kind: "success",
                    valueJson,
                    ...(page.entries.length
                        ? {
                              progressKey: sha256Hex(
                                  stableStringify({
                                      kind: "conversation_history",
                                      entries: page.entries,
                                  }),
                              ),
                          }
                        : {}),
                },
            };
        } catch (error) {
            if (executionFailureCode(error) !== "history_cursor_invalid")
                throw error;
            return {
                outcome: { kind: "refused", code: "history_cursor_invalid" },
            };
        }
    },
};

export const commonOperations = {
    consult_conversation: consultConversation,
    consult_mission_state: consultMissionStateOperation,
    consult_run_state: consultRunStateOperation,
};
