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
    conversationReply?(result: AgentResult): string;
    instructions: string;
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
    definition: Pick<AgentDefinition, "operations">,
): AgentGenerationInput["operations"] {
    return Object.fromEntries(
        Object.entries(definition.operations).map(([name, operation]) => [
            name,
            {
                description: operation.description,
                inputValidator: operation.inputValidator,
            },
        ]),
    );
}
