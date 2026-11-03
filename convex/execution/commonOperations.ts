import { internal } from "@convex/_generated/api";
import { sha256Hex, stableStringify } from "@convex/domain/sourcePassages";
import {
    consultConversationInputValidator,
    consultMissionStateInputValidator,
    consultRunStateInputValidator,
} from "./agentSchemas";
import type { AgentOperationDefinition } from "./executionProtocol";
import { pinHistoryRead } from "./history";
import { operationReuseIdentity } from "./missionData";

/** Read policies and execution are the same for native callers and generated tools. */
export const consultMissionStateOperation: Extract<
    AgentOperationDefinition,
    { effectKind: "read" }
> = {
    effectKind: "read",
    version: 2,
    description:
        "Read current required mission state and immutable retained observations. Omit cursor initially; later copy only this operation's continueCursor, never an ID or an invented offset.",
    inputValidator: consultMissionStateInputValidator,
    identity(context) {
        return {
            ...operationReuseIdentity(context),
            stateVersion: context.mission?.nextEventSequence,
        };
    },
    pin: pinHistoryRead,
    async execute(ctx, args) {
        if (!args.requestId)
            return {
                outcome: { kind: "refused", code: "request_unavailable" },
            };
        return ctx.runQuery(internal.execution.history.read, {
            requestId: args.requestId,
            expectedGeneration: args.expectedGeneration,
        });
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
        "Read exact prior processed conversation messages in canonical fragments. Queued instructions and messages published after this read's snapshot are excluded. Omit cursor initially; later copy only this operation's continueCursor.",
    inputValidator: consultConversationInputValidator,
};
export const commonOperations = {
    consult_conversation: consultConversation,
    consult_mission_state: consultMissionStateOperation,
    consult_run_state: consultRunStateOperation,
};

/** Native empty start markers are explicit first-page requests, never continuation recovery. */
export function normalizeNativeHistoryInput(
    name: string,
    input: unknown,
): unknown {
    if (
        (name !== "consult_conversation" && name !== "consult_mission_state") ||
        !input ||
        typeof input !== "object" ||
        Array.isArray(input) ||
        !("cursor" in input) ||
        input.cursor !== ""
    )
        return input;
    const { cursor: _start, ...rest } = input;
    return rest;
}
