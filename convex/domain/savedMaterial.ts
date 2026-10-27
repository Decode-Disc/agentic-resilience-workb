import { internal } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import type { ActionCtx } from "@convex/_generated/server";
import type { SavedMaterialOperation } from "@convex/domain/savedMaterialOperations";
import { sha256Hex } from "@convex/domain/sourcePassages";
import {
    MAX_OPERATION_RESULT_BYTES,
    type operationOutcomeValidator,
} from "@convex/execution/contracts";
import { executionFailureCode } from "@convex/execution/errors";
import type { Infer } from "convex/values";

const MAX_SEARCH_RESULT_BYTES = 48 * 1024;
const MAX_HISTORY_RESULT_BYTES = 48 * 1024;

type OperationOutcome = Infer<typeof operationOutcomeValidator>;

type MissionOperationArgs = {
    missionId: Id<"agentMissions">;
    expectedGeneration: number;
};

type MissionCaptureArgs = MissionOperationArgs & {
    sourceId: Id<"sources">;
};

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function failedOutcome(error: unknown): OperationOutcome | undefined {
    const code = executionFailureCode(error);
    if (!code) return undefined;
    if (
        [
            "capture_unavailable",
            "capture_corrupt",
            "capture_identity_conflict",
            "no_prepared_capture",
            "retrieval_index_invalid",
            "retrieval_candidate_limit",
            "retrieval_passage_invalid",
        ].includes(code)
    )
        return { kind: "unavailable", code };
    if (
        [
            "not_authorized",
            "stale_execution",
            "corpus_not_approved",
            "source_not_approved",
            "mission_unavailable",
            "definition_version_conflict",
            "execution_slot_unavailable",
            "execution_deadline",
            "history_cursor_invalid",
            "retrieval_query_invalid",
        ].includes(code)
    )
        return { kind: "refused", code };
    return undefined;
}

function successOutcome(
    value: unknown,
    progress?: {
        captureId: Id<"sourceCaptures">;
        progressKey?: string;
        progressKeys?: string[];
    },
): OperationOutcome {
    const valueJson = JSON.stringify(value);
    if (new TextEncoder().encode(valueJson).length > MAX_OPERATION_RESULT_BYTES)
        return { kind: "unavailable", code: "operation_result_capacity" };
    return {
        kind: "success",
        valueJson,
        ...(progress
            ? {
                  captureId: progress.captureId,
                  ...(progress.progressKey
                      ? { progressKey: progress.progressKey }
                      : {}),
                  ...(progress.progressKeys
                      ? { progressKeys: progress.progressKeys }
                      : {}),
              }
            : {}),
    };
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

async function consultMissionState(
    ctx: ActionCtx,
    args: MissionOperationArgs & { cursor?: string },
): Promise<OperationOutcome> {
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
}

async function searchAvailableMaterial(
    ctx: ActionCtx,
    args: MissionCaptureArgs & { query: string },
): Promise<OperationOutcome> {
    const captureArgs = {
        missionId: args.missionId,
        expectedGeneration: args.expectedGeneration,
        sourceId: args.sourceId,
    };
    const result = await ctx.runAction(
        internal.sourceRetrievalActions.readApprovedMaterialForMission,
        { ...captureArgs, request: { kind: "search", query: args.query } },
    );
    if (result.status !== "ready")
        return { kind: "unavailable", code: result.reason };
    if (result.kind !== "search")
        throw new Error("Unexpected approved material result");
    const base = {
        kind: "search_available_material",
        sourceId: args.sourceId,
        captureId: result.captureId,
        contentHash: result.contentHash,
        canonicalUrl: result.canonicalUrl,
        retrievedAt: result.retrievedAt,
    };
    const selected: typeof result.passages = [];
    for (const passage of result.passages) {
        const candidate = [...selected, passage];
        const preview = {
            ...base,
            passages: candidate.map((item) => ({
                passageOrder: item.order,
                exactQuote: item.quotation,
                headingPath: item.headingPath,
            })),
        };
        if (
            new TextEncoder().encode(JSON.stringify(preview)).length >
            MAX_SEARCH_RESULT_BYTES
        )
            break;
        selected.push(passage);
    }
    const value = {
        ...base,
        passages: selected.map((passage) => ({
            passageOrder: passage.order,
            exactQuote: passage.quotation,
            headingPath: passage.headingPath,
        })),
        omittedPassageCount: result.passages.length - selected.length,
        limitReached:
            result.limitReached || selected.length < result.passages.length,
    };
    if (!selected.length) return successOutcome(value);
    const progressKeys = selected.map(({ order, quotationHash }) =>
        sha256Hex(
            JSON.stringify({
                captureId: result.captureId,
                contentHash: result.contentHash,
                order,
                quotationHash,
            }),
        ),
    );
    return successOutcome(value, { captureId: result.captureId, progressKeys });
}

async function readInContext(
    ctx: ActionCtx,
    args: MissionCaptureArgs & { passageOrder: number },
): Promise<OperationOutcome> {
    const result = await ctx.runAction(
        internal.sourceRetrievalActions.readApprovedMaterialForMission,
        {
            missionId: args.missionId,
            expectedGeneration: args.expectedGeneration,
            sourceId: args.sourceId,
            request: {
                kind: "context",
                passageOrder: args.passageOrder,
            },
        },
    );
    if (result.status !== "ready")
        return { kind: "unavailable", code: result.reason };
    if (result.kind !== "context")
        throw new Error("Unexpected approved material result");
    const { passage } = result;
    const value = {
        kind: "read_in_context",
        sourceId: args.sourceId,
        captureId: result.captureId,
        contentHash: result.contentHash,
        passage: {
            passageOrder: passage.order,
            startOffset: passage.startOffset,
            endOffset: passage.endOffset,
            exactQuote: passage.quotation,
            quotationHash: passage.quotationHash,
            headingPath: passage.headingPath,
            surroundingText: passage.surroundingText,
        },
    };
    const progressKey = sha256Hex(
        JSON.stringify({
            kind: "read_in_context",
            sourceId: args.sourceId,
            captureId: result.captureId,
            contentHash: result.contentHash,
            passageOrder: passage.order,
            quotationHash: passage.quotationHash,
        }),
    );
    return successOutcome(value, {
        captureId: result.captureId,
        progressKey,
    });
}

/** Executes one persisted operation using mission authority and immutable approved captures only. */
export async function executeSavedMaterialOperation(
    ctx: ActionCtx,
    args: MissionOperationArgs & { input: SavedMaterialOperation },
): Promise<OperationOutcome> {
    try {
        switch (args.input.kind) {
            case "consult_mission_state":
                return await consultMissionState(ctx, {
                    missionId: args.missionId,
                    expectedGeneration: args.expectedGeneration,
                    ...(args.input.cursor ? { cursor: args.input.cursor } : {}),
                });
            case "search_available_material":
                return await searchAvailableMaterial(ctx, {
                    missionId: args.missionId,
                    expectedGeneration: args.expectedGeneration,
                    sourceId: args.input.sourceId,
                    query: args.input.query,
                });
            case "read_in_context":
                return await readInContext(ctx, {
                    missionId: args.missionId,
                    expectedGeneration: args.expectedGeneration,
                    sourceId: args.input.sourceId,
                    passageOrder: args.input.passageOrder,
                });
        }
    } catch (error) {
        return (
            failedOutcome(error) ??
            (() => {
                throw error;
            })()
        );
    }
}
