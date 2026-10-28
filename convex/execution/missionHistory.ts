import { internal } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import type { ActionCtx } from "@convex/_generated/server";
import type { OperationOutcome } from "./agentDefinition";
import { executionFailureCode } from "./errors";

const MAX_HISTORY_RESULT_BYTES = 48 * 1024;
type MissionOperationArgs = {
    missionId: Id<"agentMissions">;
    expectedGeneration: number;
};
function isRecord(value: unknown): value is Record<string, unknown> {
    return !!value && typeof value === "object" && !Array.isArray(value);
}
function successOutcome(value: unknown): OperationOutcome {
    return { kind: "success", valueJson: JSON.stringify(value) };
}
function selectHistoryPage(
    entries: Array<{
        sequence: number;
        offset: number;
        totalCharacters: number;
        content: string;
    }>,
    requestedCursor: string | undefined,
    pageCursor: string | null,
    fixedValue: Record<string, unknown>,
) {
    const selected: typeof entries = [];
    let continueCursor = pageCursor;
    for (const entry of entries) {
        const candidate = [...selected, entry];
        const candidateValue = {
            ...fixedValue,
            history: { entries: candidate, continueCursor: pageCursor },
        };
        if (
            new TextEncoder().encode(JSON.stringify(candidateValue)).length <=
            MAX_HISTORY_RESULT_BYTES
        ) {
            selected.push(entry);
            continue;
        }
        continueCursor = `${entry.sequence}:${entry.offset}`;
        break;
    }
    if (!selected.length && entries.length && continueCursor === pageCursor)
        continueCursor = requestedCursor ?? "1:0";
    return { entries: selected, continueCursor };
}

export async function consultMissionState(
    ctx: ActionCtx,
    args: MissionOperationArgs & { cursor?: string },
): Promise<OperationOutcome> {
    try {
        const mission = {
            missionId: args.missionId,
            expectedGeneration: args.expectedGeneration,
        };
        const [context, history] = await Promise.all([
            ctx.runQuery(internal.execution.context.build, mission),
            ctx.runQuery(internal.execution.missions.history, args),
        ]);
        if (context.kind === "blocked")
            return { kind: "unavailable", code: context.code };
        let parsedContext: unknown;
        try {
            parsedContext = JSON.parse(context.inputJson);
        } catch {
            return { kind: "unavailable", code: "mission_state_unavailable" };
        }
        if (!isRecord(parsedContext))
            return { kind: "unavailable", code: "mission_state_unavailable" };
        const state = {
            mission: parsedContext.mission,
            humanInstructions: parsedContext.humanInstructions,
            decisions: parsedContext.decisions,
            constraints: parsedContext.constraints,
            workingNotes: parsedContext.workingNotes,
            activeWork: parsedContext.activeWork,
        };
        const fixedValue = { kind: "consult_mission_state", state };
        const boundedHistory = selectHistoryPage(
            history.entries,
            args.cursor,
            history.continueCursor,
            fixedValue,
        );
        return successOutcome({ ...fixedValue, history: boundedHistory });
    } catch (error) {
        const code = executionFailureCode(error);
        if (!code) throw error;
        return { kind: "refused", code };
    }
}
