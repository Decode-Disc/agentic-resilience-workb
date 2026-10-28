import {
    type Infer,
    type PropertyValidators,
    type VObject,
    v,
} from "convex/values";
import {
    agentCompletionValidator,
    agentOperationSuccessValidator,
    operationInputValidator,
} from "./agentSchemas";

export {
    agentDefinitionIdValidator,
    agentDefinitionVersionValidator,
    operationInputValidator,
} from "./agentSchemas";
export type AgentOperationDefinition = {
    version: number;
    description: string;
    inputValidator: VObject<Record<string, unknown>, PropertyValidators>;
};

export const MAX_CONTEXT_BYTES = 128 * 1024;
export const MAX_OPERATION_RESULT_BYTES = 64 * 1024;
export const MAX_OBSERVABLE_OUTPUT_BYTES = 512 * 1024;
export const MAX_WORKING_NOTES_BYTES = 16 * 1024;
export const MAX_BATCH_REQUESTS = 4;
export const MAX_NO_PROGRESS_TURNS = 3;
export const HISTORY_PAGE_SIZE = 20;
export const EXECUTION_WINDOW_MS = 15 * 60 * 1000;

export const invocationResponseValidator = v.union(
    v.object({
        kind: v.literal("operations"),
        requests: v.array(
            v.object({
                callId: v.string(),
                name: v.string(),
                inputJson: v.string(),
            }),
        ),
        workingNotes: v.optional(v.string()),
    }),
    agentCompletionValidator,
    v.object({ kind: v.literal("blocked"), code: v.string() }),
);

export const invocationReplyValidator = v.object({
    response: invocationResponseValidator,
    rawOutputJson: v.optional(v.string()),
});

/** Structural batch failures are incidents before receipt settlement and remain fenced at adoption. */
export function invocationStructureError(
    response: Infer<typeof invocationResponseValidator>,
) {
    if (response.kind !== "operations") return undefined;
    if (response.requests.length > MAX_BATCH_REQUESTS)
        return "operation_batch_limit";
    const callIds = response.requests.map((request) => request.callId);
    if (
        callIds.some((id) => id.length < 1 || id.length > 160) ||
        new Set(callIds).size !== callIds.length
    )
        return "invalid_tool_correlation";
    return undefined;
}

export const requestInputValidator = v.union(
    operationInputValidator,
    v.object({
        kind: v.literal("invalid"),
        name: v.string(),
        inputJson: v.string(),
    }),
);

export const operationOutcomeValidator = v.union(
    agentOperationSuccessValidator,
    v.object({ kind: v.literal("unavailable"), code: v.string() }),
    v.object({ kind: v.literal("refused"), code: v.string() }),
);

export const missionStatusValidator = v.union(
    v.literal("ready"),
    v.literal("running"),
    v.literal("waiting"),
    v.literal("completed"),
    v.literal("blocked"),
    v.literal("cancelled"),
);
