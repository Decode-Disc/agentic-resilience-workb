import { internal } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import type { ActionCtx } from "@convex/_generated/server";
import type { SavedMaterialOperation } from "@convex/domain/savedMaterialOperations";
import { sha256Hex } from "@convex/domain/sourcePassages";
import { executionFailureCode } from "@convex/execution/errors";
import {
    MAX_OPERATION_RESULT_BYTES,
    type OperationObservationOutcome,
} from "@convex/execution/executionProtocol";

// Reserve the remaining result budget for documentary permissions and observed-link previews.
const MAX_SEARCH_RESULT_BYTES = 30 * 1024;

type MissionOperationArgs = {
    missionId?: Id<"agentMissions">;
    runId?: Id<"researchRuns">;
    expectedGeneration: number;
};

type MissionCaptureArgs = MissionOperationArgs & {
    sourceId: Id<"sources">;
};

function failedOutcome(
    error: unknown,
): OperationObservationOutcome | undefined {
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

async function successOutcome(
    ctx: ActionCtx,
    args: MissionCaptureArgs,
    value: Record<string, unknown>,
    progress?: {
        captureId: Id<"sourceCaptures">;
        progressKey?: string;
        progressKeys?: string[];
    },
): Promise<OperationObservationOutcome> {
    const documentaryStatus = await ctx.runQuery(
        internal.sourcesMission.materialStatus,
        {
            missionId: args.missionId,
            runId: args.runId,
            expectedGeneration: args.expectedGeneration,
            sourceId: args.sourceId,
        },
    );
    const valueJson = JSON.stringify(
        documentaryStatus ? { ...value, documentaryStatus } : value,
    );
    if (new TextEncoder().encode(valueJson).length > MAX_OPERATION_RESULT_BYTES)
        return { kind: "unavailable", code: "operation_result_capacity" };
    return {
        kind: "success",
        value: JSON.parse(valueJson),
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

async function searchAvailableMaterial(
    ctx: ActionCtx,
    args: MissionCaptureArgs & { query: string },
): Promise<OperationObservationOutcome> {
    if (!args.query.trim())
        return { kind: "refused", code: "retrieval_query_invalid" };
    const captureArgs = {
        missionId: args.missionId,
        runId: args.runId,
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
    if (!selected.length) return successOutcome(ctx, args, value);
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
    return successOutcome(ctx, args, value, {
        captureId: result.captureId,
        progressKeys,
    });
}

async function readInContext(
    ctx: ActionCtx,
    args: MissionCaptureArgs & { passageOrder: number },
): Promise<OperationObservationOutcome> {
    const result = await ctx.runAction(
        internal.sourceRetrievalActions.readApprovedMaterialForMission,
        {
            missionId: args.missionId,
            runId: args.runId,
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
    return successOutcome(ctx, args, value, {
        captureId: result.captureId,
        progressKey,
    });
}

/** Executes one persisted operation using mission authority and immutable approved captures only. */
export async function executeSavedMaterialOperation(
    ctx: ActionCtx,
    args: MissionOperationArgs & { input: SavedMaterialOperation },
): Promise<OperationObservationOutcome> {
    try {
        switch (args.input.kind) {
            case "search_available_material":
                return await searchAvailableMaterial(ctx, {
                    missionId: args.missionId,
                    runId: args.runId,
                    expectedGeneration: args.expectedGeneration,
                    sourceId: args.input.sourceId,
                    query: args.input.query,
                });
            case "read_in_context":
                return await readInContext(ctx, {
                    missionId: args.missionId,
                    runId: args.runId,
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
