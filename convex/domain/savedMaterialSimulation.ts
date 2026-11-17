import {
    type AgentDefinition,
    domainSnapshot,
} from "@convex/execution/agentDefinition";
import { validate } from "convex-helpers/validators";
import { savedMaterialCompletionValidator } from "./savedMaterialOperations";

export const savedMaterialSimulation: NonNullable<
    AgentDefinition["simulate"]
> = (input) => {
    input = domainSnapshot(input);
    if (
        !input ||
        typeof input !== "object" ||
        !("availableMaterials" in input) ||
        !Array.isArray(input.availableMaterials) ||
        !("triggeringRequestsAndResults" in input) ||
        !Array.isArray(input.triggeringRequestsAndResults)
    )
        return { kind: "blocked", code: "simulation_context_invalid" };
    const source: unknown = input.availableMaterials[0];
    if (
        !source ||
        typeof source !== "object" ||
        !("sourceId" in source) ||
        typeof source.sourceId !== "string"
    )
        return { kind: "blocked", code: "simulation_material_unavailable" };
    const requests = input.triggeringRequestsAndResults;
    const latest: unknown = requests.at(-1);
    const operation: unknown =
        latest && typeof latest === "object" && "input" in latest
            ? latest.input
            : null;
    const previousKind =
        operation && typeof operation === "object" && "kind" in operation
            ? operation.kind
            : null;
    const request = (name: string, value: unknown) => ({
        kind: "operations" as const,
        requests: [
            {
                callId: `simulated-${name}`,
                name,
                inputJson: JSON.stringify(value),
            },
        ],
        workingNotes:
            "Simulation: inspect retained material; no analytical conclusion is established.",
    });
    if (!previousKind) return request("consult_mission_state", {});
    if (previousKind === "consult_mission_state")
        return request("search_available_material", {
            sourceId: source.sourceId,
            query: "workflow",
        });
    if (previousKind === "search_available_material")
        return request("read_in_context", {
            sourceId: source.sourceId,
            passageOrder: 0,
        });
    if (
        previousKind === "read_in_context" &&
        latest &&
        typeof latest === "object" &&
        "outcome" in latest
    ) {
        const outcome: unknown = latest.outcome;
        if (
            outcome &&
            typeof outcome === "object" &&
            "kind" in outcome &&
            outcome.kind === "success" &&
            "captureId" in outcome &&
            typeof outcome.captureId === "string"
        ) {
            const response = {
                kind: "complete",
                captureIds: [outcome.captureId],
            };
            if (validate(savedMaterialCompletionValidator, response))
                return response;
        }
    }
    return { kind: "blocked", code: "simulation_read_unavailable" };
};
