import type { Doc } from "@convex/_generated/dataModel";
import type { MutationCtx, QueryCtx } from "@convex/_generated/server";
import type { Infer, Validator } from "convex/values";
import type {
    agentCompletionValidator,
    agentResultValidator,
    agentScopeValidator,
    agentStateValidator,
    operationPinValidator,
} from "./agentSchemas";
import type {
    AgentGenerationInput,
    AgentOperationDefinition,
    operationOutcomeValidator,
    requestInputValidator,
} from "./executionProtocol";

export type AgentScope = Infer<typeof agentScopeValidator>;
export type AgentState = Infer<typeof agentStateValidator>;
export type AgentResult = Infer<typeof agentResultValidator>;
export type AgentCompletion = Infer<typeof agentCompletionValidator>;
export type OperationPin = Infer<typeof operationPinValidator>;
export type OperationInput = Infer<typeof requestInputValidator>;
export type OperationOutcome = Infer<typeof operationOutcomeValidator>;
export type AgentProgress = {
    state?: AgentState;
    progressKeys?: string[];
    obligations?: string[];
    blockCode?: string;
};

/** Definitions supply business rules; only the executor can change lifecycle or accounting. */
export type AgentDefinition = {
    id: AgentScope["kind"];
    version: number;
    authority: string;
    executionScope?: "research" | "conversation";
    nativeConversation?: true;
    nativeToolSets?(
        operations: AgentDefinition["operations"],
    ): AgentGenerationInput["operations"][];
    textCompletion?(text: string): AgentCompletion;
    modelOperation?(
        name: string,
        operation: Pick<
            AgentOperationDefinition,
            "description" | "inputValidator"
        >,
        snapshot: unknown,
    ): Pick<AgentOperationDefinition, "description" | "inputValidator"> | null;
    normalizeOperationInput?(
        name: string,
        input: Record<string, unknown>,
        snapshot: unknown,
    ): Record<string, unknown>;
    consultationContext?(
        snapshot: Record<string, unknown>,
    ): Record<string, unknown>;
    operationDiagnostic?(code: string): string;
    conversationReply?(result: AgentResult): string;
    instructions: string;
    /** Domain distinctions the native summarizer must preserve across compaction. */
    compactionInstructions?: string;
    scopeValidator: Validator<AgentScope, "required", string>;
    stateValidator: Validator<AgentState, "required", string>;
    resultValidator: Validator<AgentResult, "required", string>;
    completionValidator: Validator<AgentCompletion, "required", string>;
    operations: Record<string, AgentOperationDefinition>;
    initialState(scope: AgentScope): {
        objectiveKey: string;
        state: AgentState;
        obligations: string[];
    };
    requireAuthority(
        ctx: QueryCtx,
        mission: Doc<"agentMissions">,
        run: Doc<"researchRuns">,
    ): Promise<void>;
    context(
        ctx: QueryCtx,
        mission: Doc<"agentMissions">,
        run: Doc<"researchRuns">,
    ): Promise<
        | { kind: "blocked"; code: string }
        | {
              kind: "ready";
              context: Record<string, unknown> & {
                  activeWork: Record<string, unknown>;
              };
          }
    >;
    progress(
        mission: Doc<"agentMissions">,
        outcome: OperationOutcome,
    ): AgentProgress;
    complete(
        ctx: MutationCtx,
        mission: Doc<"agentMissions">,
        response: AgentCompletion,
    ): Promise<
        | { kind: "blocked"; code: string }
        | { kind: "completed"; result: AgentResult }
    >;
    simulate?(input: unknown):
        | AgentCompletion
        | {
              kind: "operations";
              requests: { callId: string; name: string; inputJson: string }[];
          }
        | { kind: "blocked"; code: string };
};

/** Exposes model-visible schemas while keeping server execution callbacks out of SDK tools. */
export function agentToolSchemas(
    definition: Pick<AgentDefinition, "operations" | "modelOperation">,
    snapshot?: unknown,
): AgentGenerationInput["operations"] {
    return Object.fromEntries(
        Object.entries(definition.operations).flatMap(([name, operation]) => {
            const projected = definition.modelOperation
                ? definition.modelOperation(name, operation, snapshot)
                : {
                      description: operation.description,
                      inputValidator: operation.inputValidator,
                  };
            return projected ? [[name, projected]] : [];
        }),
    );
}

/** Keep the canonical outcome intact in Convex while giving the native model readable result data. */
export function modelOperationOutcome(
    definition: AgentDefinition,
    outcome: OperationOutcome,
): string {
    if (!definition.nativeConversation) return JSON.stringify(outcome);
    if (outcome.kind === "success")
        return JSON.stringify({
            kind: "success",
            value: JSON.parse(outcome.valueJson),
        });
    return JSON.stringify({
        ...outcome,
        ...("code" in outcome
            ? {
                  diagnostic:
                      outcome.code === "history_cursor_invalid"
                          ? "No history page was read. Omit cursor to start at the first page; for later pages copy only continueCursor returned by the same history operation. Use consult_conversation for prior analyst exchanges; consult_mission_state reads only the current mission."
                          : (definition.operationDiagnostic?.(outcome.code) ??
                            "This operation was not performed. Inspect the current state and correct the request before trying again."),
              }
            : {}),
    });
}
