import type { Doc } from "@convex/_generated/dataModel";
import { conversationValidationDefinition } from "@convex/domain/conversationValidation";
import { executionValidationDefinition } from "@convex/domain/executionValidationAgent";
import { savedMaterialInspectionDefinition } from "@convex/domain/savedMaterialInspection";
import { sourcesDefinition } from "@convex/domain/sourcesAgent";
import {
    nativeWorkbenchDefinition,
    workbenchDefinition,
} from "@convex/domain/workbenchAgent";
import type { AgentDefinition } from "./agentDefinition";
import { commonOperations } from "./commonOperations";
import { executionError } from "./errors";
import type { AgentOperationDefinition } from "./executionProtocol";
import { operationResultSchema } from "./operationResults";

// Defer imported definition reads until module initialization has completed.
function definitions() {
    return {
        [sourcesDefinition.id]: sourcesDefinition,
        [workbenchDefinition.id]: workbenchDefinition,
        [conversationValidationDefinition.id]: conversationValidationDefinition,
        [executionValidationDefinition.id]: executionValidationDefinition,
        [savedMaterialInspectionDefinition.id]:
            savedMaterialInspectionDefinition,
    } satisfies Record<Doc<"agentMissions">["definitionId"], AgentDefinition>;
}

/** Reject incomplete or contradictory declarations before any callback is dispatched. */
export function assertOperationContract(
    name: string,
    operation: AgentOperationDefinition,
): void {
    if (
        !name ||
        !["read", "atomic_effect", "durable_effect", "delegation"].includes(
            operation.effectKind,
        ) ||
        typeof operation.execute !== "function" ||
        typeof operation.resultValidator?.safeParse !== "function" ||
        typeof operation.pin !== "function" ||
        typeof operation.identity !== "function" ||
        typeof operation.validateOutcome !== "function" ||
        !Number.isSafeInteger(operation.version) ||
        operation.version < 1 ||
        (operation.effectKind === "delegation") !==
            (typeof operation.childMission === "function")
    )
        throw executionError("operation_contract_invalid");
    if (!closedResultObject(operationResultSchema(operation.resultValidator)))
        throw executionError("operation_contract_invalid");
}

function closedResultObject(schema: object): boolean {
    const value = schema as {
        type?: unknown;
        additionalProperties?: unknown;
        anyOf?: object[];
    };
    return value.anyOf
        ? value.anyOf.length > 0 && value.anyOf.every(closedResultObject)
        : value.type === "object" && value.additionalProperties === false;
}

/** Apply the same closed contract when validating or resolving a registered definition. */
export function bindAgentDefinition(
    definition: AgentDefinition,
): AgentDefinition {
    if (
        (definition.nativeConversation &&
            definition.executionScope !== "conversation") ||
        (definition.executionScope === "conversation" &&
            !definition.conversationReply)
    )
        throw executionError("definition_contract_invalid");
    for (const [name, operation] of Object.entries(definition.operations)) {
        assertOperationContract(name, operation);
        if (name in commonOperations)
            throw executionError("operation_definition_conflict");
    }
    for (const [name, operation] of Object.entries(commonOperations))
        assertOperationContract(name, operation);
    return {
        ...definition,
        operations: { ...definition.operations, ...commonOperations },
    };
}

/** Enumerates the exact versioned bindings accepted by runtime resolution. */
export function registeredAgentDefinitions(): readonly AgentDefinition[] {
    return [...Object.values(definitions()), nativeWorkbenchDefinition].map(
        bindAgentDefinition,
    );
}

let operations: Map<string, AgentOperationDefinition> | undefined;
function registeredOperations() {
    if (operations) return operations;
    const entries = new Map<string, AgentOperationDefinition>(
        Object.entries(commonOperations),
    );
    for (const definition of Object.values(definitions())) {
        for (const [name, operation] of Object.entries(definition.operations)) {
            assertOperationContract(name, operation);
            const existing = entries.get(name);
            if (existing && existing !== operation)
                throw executionError("operation_definition_conflict");
            entries.set(name, operation);
        }
    }
    operations = entries;
    return entries;
}

/** Operation lookup derives from the same static definitions used by agent bindings. */
export function getRegisteredOperation(name: string) {
    return registeredOperations().get(name);
}

/** Resolves the static domain binding; routing and execution mechanics remain separate owners. */
export function getAgentDefinition(
    id: Doc<"agentMissions">["definitionId"],
    version?: number,
): AgentDefinition {
    const current = definitions();
    const selectedVersion = version ?? current[id].version;
    const definition = [
        ...Object.values(current),
        nativeWorkbenchDefinition,
    ].find(
        (definition) =>
            definition.id === id && definition.version === selectedVersion,
    );
    if (!definition) throw executionError("definition_version_conflict");
    return bindAgentDefinition(definition);
}
