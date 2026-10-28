import type { Doc } from "@convex/_generated/dataModel";
import { executionValidationDefinition } from "@convex/domain/executionValidationAgent";
import { savedMaterialInspectionDefinition } from "@convex/domain/savedMaterialInspection";
import type { AgentDefinition } from "./agentDefinition";
import { consultMissionStateInputValidator } from "./agentSchemas";
import { executionError } from "./errors";

const definitions = {
    [executionValidationDefinition.id]: executionValidationDefinition,
    [savedMaterialInspectionDefinition.id]: savedMaterialInspectionDefinition,
} satisfies Record<Doc<"agentMissions">["definitionId"], AgentDefinition>;

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
            consult_mission_state: {
                version: 1,
                description:
                    "Read persisted mission state and bounded observable history.",
                inputValidator: consultMissionStateInputValidator,
            },
        },
    };
}
