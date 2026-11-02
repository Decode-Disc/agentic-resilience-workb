import type { Doc, Id } from "@convex/_generated/dataModel";
import type { ActionCtx, QueryCtx } from "@convex/_generated/server";
import type { ModelRoute } from "@convex/integrations/modelRouting";
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
    identity(context: {
        mission?: Doc<"agentMissions">;
        runId: Id<"researchRuns">;
        version: number;
        input: Infer<typeof requestInputValidator>;
        pin?: import("./agentDefinition").OperationPin;
    }): unknown;
    nativeAuthority?: "dossier" | "research";
    childMission?(request: Doc<"agentOperationRequests">): {
        definitionId: Doc<"agentMissions">["definitionId"];
        scope: import("./agentDefinition").AgentScope;
        maxRequests: number;
    };
    pin(
        ctx: QueryCtx,
        mission: Doc<"agentMissions"> | undefined,
        input: Infer<typeof requestInputValidator>,
        runId?: Id<"researchRuns">,
        effectPin?: import("./agentDefinition").OperationPin,
    ): Promise<
        | { kind: "available"; pin: import("./agentDefinition").OperationPin }
        | { kind: "unavailable"; code: string }
    >;
    execute(
        ctx: ActionCtx,
        args: {
            missionId?: Id<"agentMissions">;
            runId?: Id<"researchRuns">;
            requestId?: Id<"agentOperationRequests">;
            expectedGeneration: number;
            input: Infer<typeof requestInputValidator>;
        },
    ): Promise<Infer<typeof operationOutcomeValidator>>;
    validateOutcome(
        request: Doc<"agentOperationRequests">,
        outcome: Infer<typeof operationOutcomeValidator>,
    ): Infer<typeof operationOutcomeValidator>;
    version: number;
    description: string;
    inputValidator: VObject<Record<string, unknown>, PropertyValidators>;
};

export const agentBackendValidator = v.object({
    id: v.string(),
    version: v.number(),
});
export type AgentBackendIdentity = Infer<typeof agentBackendValidator>;
export const LEGACY_AGENT_BACKEND: AgentBackendIdentity = {
    id: "ai-sdk",
    version: 1,
};
export const HISTORICAL_AGENT_BACKEND: AgentBackendIdentity = {
    id: "convex-agent",
    version: 2,
};
export const DEFAULT_AGENT_BACKEND: AgentBackendIdentity = {
    id: "pi-durable",
    version: 1,
};

export type ModelAttemptReceipt = {
    observableReplyJson?: string;
    backendOutputJson?: string;
    model: string;
    resolvedModel?: string;
    provider?: string;
    inputTokens?: number;
    outputTokens?: number;
    reasoningTokens?: number;
    cachedInputTokens?: number;
    reportedCost?: number;
    latencyMs: number;
    dispatchOutcome?: "not_dispatched" | "response_received" | "unknown";
    httpStatus?: number;
    retryAfterAt?: number;
    outputDiagnostic?: Doc<"providerCalls">["diagnostic"];
};
export type AgentModelRoute = ModelRoute &
    Readonly<{ authorizedForAgent: true }>;
export type AgentGenerationInput = {
    route?: AgentModelRoute;
    instructions: string;
    prompt: string;
    operations: Record<
        string,
        Pick<AgentOperationDefinition, "description" | "inputValidator">
    >;
};
export type AgentGenerationObservation = ModelAttemptReceipt &
    (
        | {
              status: "succeeded";
              finishReason: "stop" | "tool-calls";
              assistantOutput: string;
              requests: { callId: string; name: string; inputJson: string }[];
          }
        | { status: "failed"; errorCode: string; retryable: boolean }
    );
export type AgentGenerationResult =
    | AgentGenerationObservation
    | {
          status: "blocked";
          reason:
              | "missing_authorized_route"
              | "tool_callbacks_not_allowed"
              | "generation_backend_unknown";
      };

export type AgentGenerationLifecycle = {
    beforeDispatch(requestJson: string): Promise<void>;
    observe(observation: AgentGenerationObservation): Promise<void>;
    signal?: AbortSignal;
};
export type AgentGenerationRuntime = {
    ctx: ActionCtx;
    invocationId: Id<"agentInvocations">;
    expectedGeneration: number;
    transport: { apiKey: string; fetch?: typeof fetch };
};

/** Backends generate observations; the harness owns every effect, reservation and adoption. */
export type AgentGenerationBackend = AgentBackendIdentity & {
    generate(
        input: AgentGenerationInput,
        lifecycle: AgentGenerationLifecycle,
        runtime: AgentGenerationRuntime,
    ): Promise<AgentGenerationResult>;
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
    pi = false,
) {
    if (response.kind !== "operations") return undefined;
    if (!pi && response.requests.length > MAX_BATCH_REQUESTS)
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

export const operationRefusalValidator = v.union(
    v.object({ kind: v.literal("unavailable"), code: v.string() }),
    v.object({ kind: v.literal("refused"), code: v.string() }),
);

export const operationOutcomeValidator = v.union(
    v.object({ kind: v.literal("waiting"), reference: v.string() }),
    agentOperationSuccessValidator,
    operationRefusalValidator,
);

export const missionStatusValidator = v.union(
    v.literal("ready"),
    v.literal("running"),
    v.literal("waiting"),
    v.literal("completed"),
    v.literal("blocked"),
    v.literal("cancelled"),
);
