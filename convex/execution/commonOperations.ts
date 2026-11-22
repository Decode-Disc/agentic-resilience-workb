import { internal } from "@convex/_generated/api";
import { readResearchState } from "@convex/domain/researchState";
import { sha256Hex, stableStringify } from "@convex/domain/sourcePassages";
import { v } from "convex/values";
import { z } from "zod";
import {
    consultConversationInputValidator,
    consultMissionStateInputValidator,
    consultRunStateInputValidator,
} from "./agentSchemas";
import type { AgentOperationDefinition } from "./executionProtocol";
import { pinHistoryRead } from "./history";
import { operationReuseIdentity } from "./missionData";
import {
    conversationHistoryEntryValidator,
    historyPageValidator,
    runStateResultValidator,
} from "./operationContracts";
import {
    observeOperationOutcome,
    operationResultValidator,
} from "./operationResults";

/** Read policies and execution are the same for native callers and generated tools. */
export const consultMissionStateOperation: Extract<
    AgentOperationDefinition,
    { effectKind: "read" }
> = {
    effectKind: "read",
    version: 3,
    description:
        "Read immutable retained mission observations, including refused proposals. Current required state is supplied automatically in the prompt section; the returned state field identifies that supplied state rather than repeating the full working inventory. Supply reference to inspect one observed journal event, or omit reference to browse history chronologically. Omit cursor initially; continue only with this operation's continueCursor and omit reference on continuation.",
    inputValidator: consultMissionStateInputValidator,
    resultValidator: z.strictObject({
        kind: z.literal("consult_mission_state"),
        state: z.record(z.string(), z.json()),
        history: z.strictObject({
            entries: z.array(
                z.strictObject({
                    sequence: z.number(),
                    offset: z.number(),
                    totalCharacters: z.number(),
                    content: z.string(),
                }),
            ),
            continueCursor: z.string().nullable(),
        }),
    }),
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
        const result = await ctx.runQuery(internal.execution.history.read, {
            requestId: args.requestId,
            expectedGeneration: args.expectedGeneration,
        });
        return { ...result, outcome: observeOperationOutcome(result.outcome) };
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
    version: 3,
    description:
        "Consult the authorized dossier's persisted research progress, stops and available actions without starting work.",
    inputValidator: consultRunStateInputValidator,
    resultValidator: operationResultValidator(runStateResultValidator),
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
                              research: await readResearchState(ctx, run),
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
            outcome: { kind: "success", value },
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
    version: 2,
    description:
        "Read exact prior processed conversation messages in canonical fragments. Queued instructions and messages published after this read's snapshot are excluded. Omit cursor initially; later copy only this operation's continueCursor.",
    inputValidator: consultConversationInputValidator,
    resultValidator: operationResultValidator(
        v.object({
            entries: v.array(conversationHistoryEntryValidator),
            continueCursor: historyPageValidator.fields.continueCursor,
        }),
    ),
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
