import { internal } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import type { QueryCtx } from "@convex/_generated/server";
import { sha256Hex } from "@convex/domain/sourcePassages";
import { validate } from "convex-helpers/validators";
import { getAgentDefinition } from "./agentCatalog";
import { agentDefinitionIdValidator } from "./agentSchemas";
import { executionError } from "./errors";

function isRecord(value: unknown): value is Record<string, unknown> {
    return !!value && typeof value === "object" && !Array.isArray(value);
}

/** Current required state is separate from the frozen historical source. */
export async function readMissionState(
    ctx: Pick<QueryCtx, "runQuery" | "db">,
    args: {
        missionId: Id<"agentMissions">;
        expectedGeneration: number;
    },
    maximumBytes?: number,
): Promise<
    | { kind: "ready"; state: Record<string, unknown> }
    | { kind: "unavailable"; code: string }
> {
    const mission = await ctx.db.get(args.missionId);
    const nativeReference =
        mission?.executionRuntime === "pi-durable" &&
        maximumBytes !== undefined;
    const context = await ctx.runQuery(internal.execution.context.build, {
        ...args,
        correctionAdmission: nativeReference ? true : undefined,
    });
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
    if (nativeReference)
        return {
            kind: "ready",
            state: {
                version: 2,
                mission: input.mission,
                requiredState: {
                    section: "workbench_current_state",
                    contentHash: sha256Hex(context.inputJson),
                    generation: args.expectedGeneration,
                },
                inspection:
                    "Complete current state is supplied automatically in the native prompt section. This page contains only the requested immutable history.",
            },
        };
    const required = {
        mission: input.mission,
        humanInstructions: input.humanInstructions,
        conversationInstructions: input.conversationInstructions,
        decisions: input.decisions,
        constraints: input.constraints,
        workingNotes: input.workingNotes,
    };
    const base = {
        ...required,
        contextRendering: input.contextRendering,
        domain: input.domain,
        activeWork: input.activeWork,
    };
    const projection =
        getAgentDefinition(
            input.definition.id,
            input.definition.version,
        ).consultationContext?.(base, maximumBytes) ?? base;
    const work = isRecord(projection.activeWork)
        ? projection.activeWork
        : input.activeWork;
    return {
        kind: "ready",
        state: {
            ...projection,
            ...required,
            activeWork:
                isRecord(work) && isRecord(input.activeWork)
                    ? {
                          ...work,
                          unfinishedObligations:
                              input.activeWork.unfinishedObligations,
                          noProgressTurns: input.activeWork.noProgressTurns,
                      }
                    : input.activeWork,
        },
    };
}
