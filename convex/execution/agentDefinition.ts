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
    ExecutionScope,
    operationOutcomeValidator,
    requestInputValidator,
} from "./executionProtocol";
import type { completionFeedbackValidator } from "./operationContracts";
import { operationResultKey } from "./operationResults";

export type AgentScope = Infer<typeof agentScopeValidator>;
export type AgentState = Infer<typeof agentStateValidator>;
export type AgentResult = Infer<typeof agentResultValidator>;
export type AgentCompletion = Infer<typeof agentCompletionValidator>;
export type OperationPin = Infer<typeof operationPinValidator>;
export type OperationInput = Infer<typeof requestInputValidator>;
export type OperationOutcome = Infer<typeof operationOutcomeValidator>;
export type AgentProgress = {
    state?: AgentState;
    facts?: readonly string[];
    obligations?: string[];
    blockCode?: string;
};

type WithoutAccounting<T> = T extends unknown
    ? Omit<T, "progressKeys" | "noProgressTurns" | "lastSettledInvocationId">
    : never;
export type AgentProgressMission = WithoutAccounting<Doc<"agentMissions">>;

/** Definitions supply business rules; only the executor can change lifecycle or accounting. */
export type AgentDefinition = {
    id: AgentScope["kind"];
    version: number;
    authority: string;
    executionScope: ExecutionScope;
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
    operationDiagnostic?(code: string): string | undefined;
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
        mission: AgentProgressMission,
        outcome: OperationOutcome,
    ): AgentProgress;
    /** Completion examines the immutable input admitted to this invocation, including during retained-response replay. */
    complete(
        ctx: MutationCtx,
        mission: Doc<"agentMissions">,
        response: AgentCompletion,
        admittedInput: unknown,
        invocation: Doc<"agentInvocations">,
    ): Promise<
        | { kind: "blocked"; code: string }
        | { kind: "continue" }
        | {
              kind: "correct";
              feedback: Infer<typeof completionFeedbackValidator>;
          }
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
    variant?: AgentGenerationInput["operations"],
): AgentGenerationInput["operations"] {
    return Object.fromEntries(
        Object.entries(definition.operations).flatMap(([name, operation]) => {
            if (operation.systemOnly) return [];
            const projected = variant
                ? variant[name]
                : definition.modelOperation
                  ? definition.modelOperation(name, operation, snapshot)
                  : {
                        description: operation.description,
                        inputValidator: operation.inputValidator,
                    };
            return projected
                ? [
                      [
                          name,
                          {
                              ...projected,
                              resultContractKey: operationResultKey(
                                  operation.resultValidator,
                              ),
                          },
                      ],
                  ]
                : [];
        }),
    );
}

/** Keep the canonical outcome intact in Convex while giving the native model readable result data. */
export function modelOperationOutcome(
    definition: AgentDefinition,
    outcome: OperationOutcome,
): string {
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
                      outcome.code === "operation_adoption_failed" ||
                      outcome.code === "operation_effect_receipt_missing"
                          ? "The observed result was retained, but could not be adopted. Do not repeat the operation or infer non-execution; inspect confirmed effects and wait for authorized recovery."
                          : outcome.code === "operation_outcome_unknown"
                            ? "The operation outcome is unconfirmed. Do not repeat it or claim success or non-execution. Inspect retained state and wait for authorized recovery."
                            : outcome.code === "history_cursor_invalid"
                              ? "No history page was read. Omit cursor to start at the first page; for later pages copy only continueCursor returned by the same history operation. Use consult_conversation for prior analyst exchanges; consult_mission_state reads only the current mission."
                              : (definition.operationDiagnostic?.(
                                    outcome.code,
                                ) ??
                                "This result cannot advance the mission. Inspect recorded state and the reported prerequisite before choosing another action."),
              }
            : {}),
    });
}
