import type { Doc } from "@convex/_generated/dataModel";
import { savedMaterialInspectionDefinition } from "@convex/domain/savedMaterialInspection";
import { executionError } from "./errors";

const definitions = {
    [savedMaterialInspectionDefinition.id]: savedMaterialInspectionDefinition,
} as const;

/** Resolves the static domain binding; routing and execution mechanics remain separate owners. */
export function getAgentDefinition(
    id: Doc<"agentMissions">["definitionId"],
    version?: number,
) {
    const definition = definitions[id];
    if (
        !definition ||
        (version !== undefined && definition.version !== version)
    )
        throw executionError("definition_version_conflict");
    return definition;
}
