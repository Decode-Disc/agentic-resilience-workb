import { internal } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import type { QueryCtx } from "@convex/_generated/server";
import { validate } from "convex-helpers/validators";
import { getAgentDefinition } from "./agentCatalog";
import { agentDefinitionIdValidator } from "./agentSchemas";
import { executionError } from "./errors";

function isRecord(value: unknown): value is Record<string, unknown> {
    return !!value && typeof value === "object" && !Array.isArray(value);
}

/** Current required state is separate from the frozen historical source. */
export async function readMissionState(
    ctx: Pick<QueryCtx, "runQuery">,
    args: {
        missionId: Id<"agentMissions">;
        expectedGeneration: number;
    },
): Promise<
    | { kind: "ready"; state: Record<string, unknown> }
    | { kind: "unavailable"; code: string }
> {
    const context = await ctx.runQuery(internal.execution.context.build, args);
    if (context.kind === "blocked")
        return { kind: "unavailable", code: context.code };
    const input: unknown = JSON.parse(context.inputJson);
    if (
        !isRecord(input) ||
        !isRecord(input.definition) ||
        !validate(agentDefinitionIdValidator, input.definition.id) ||
        typeof input.definition.version !== "number"
    )
        throw executionError("mission_state_invalid");
    return {
        kind: "ready",
        state: {
            ...getAgentDefinition(
                input.definition.id,
                input.definition.version,
            ).consultationContext?.(input),
            mission: input.mission,
            humanInstructions: input.humanInstructions,
            decisions: input.decisions,
            constraints: input.constraints,
            workingNotes: input.workingNotes,
            activeWork: input.activeWork,
        },
    };
}
