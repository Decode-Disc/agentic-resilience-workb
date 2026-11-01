import type { Doc } from "@convex/_generated/dataModel";
import { conversationValidationDefinition } from "@convex/domain/conversationValidation";
import { executionValidationDefinition } from "@convex/domain/executionValidationAgent";
import { savedMaterialInspectionDefinition } from "@convex/domain/savedMaterialInspection";
import { workbenchDefinition } from "@convex/domain/workbench";
import type { AgentDefinition } from "./agentDefinition";
import { commonOperations } from "./commonOperations";
import { executionError } from "./errors";
import type { AgentOperationDefinition } from "./executionProtocol";

const definitions = {
    [workbenchDefinition.id]: workbenchDefinition,
    [conversationValidationDefinition.id]: conversationValidationDefinition,
    [executionValidationDefinition.id]: executionValidationDefinition,
    [savedMaterialInspectionDefinition.id]: savedMaterialInspectionDefinition,
} satisfies Record<Doc<"agentMissions">["definitionId"], AgentDefinition>;

const operations = new Map<string, AgentOperationDefinition>(
    Object.entries(commonOperations),
);
for (const definition of Object.values(definitions)) {
    for (const [name, operation] of Object.entries(definition.operations)) {
        const existing = operations.get(name);
        if (existing && existing !== operation)
            throw executionError("operation_definition_conflict");
        operations.set(name, operation);
    }
}

/** Operation lookup derives from the same static definitions used by agent bindings. */
export function getRegisteredOperation(name: string) {
    return operations.get(name);
}

/** Resolves the static domain binding; routing and execution mechanics remain separate owners. */
export function getAgentDefinition(
    id: Doc<"agentMissions">["definitionId"],
    version?: number,
): AgentDefinition {
    const definition: AgentDefinition = definitions[id];
    if (
        !definition ||
        (version !== undefined && definition.version !== version)
    )
        throw executionError("definition_version_conflict");
    return {
        ...definition,
        operations: {
            ...definition.operations,
            ...commonOperations,
        },
    };
}
