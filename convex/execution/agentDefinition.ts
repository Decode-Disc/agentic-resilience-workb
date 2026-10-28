import type { Doc, Id } from "@convex/_generated/dataModel";
import type {
    ActionCtx,
    MutationCtx,
    QueryCtx,
} from "@convex/_generated/server";
import type { Infer, Validator } from "convex/values";
import type {
    agentCompletionValidator,
    agentResultValidator,
    agentScopeValidator,
    agentStateValidator,
    operationPinValidator,
} from "./agentSchemas";
import type {
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
    pinOperation(
        ctx: QueryCtx,
        mission: Doc<"agentMissions">,
        input: OperationInput,
    ): Promise<
        | { kind: "available"; pin: OperationPin }
        | { kind: "unavailable"; code: string }
    >;
    executeOperation(
        ctx: ActionCtx,
        args: {
            missionId: Id<"agentMissions">;
            expectedGeneration: number;
            input: OperationInput;
        },
    ): Promise<OperationOutcome>;
    validateOutcome(
        request: Doc<"agentOperationRequests">,
        outcome: OperationOutcome,
    ): OperationOutcome;
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
