import { internal } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import type { ActionCtx } from "@convex/_generated/server";
import type { SavedMaterialOperation } from "@convex/domain/savedMaterialOperations";
import { sha256Hex } from "@convex/domain/sourcePassages";
import { executionFailureCode } from "@convex/execution/errors";
import type { OperationObservationOutcome } from "@convex/execution/executionProtocol";
import {
    MAX_OPERATION_RESULT_BYTES,
    MAX_SAVED_MATERIAL_SEARCH_RESULT_BYTES as MAX_SEARCH_RESULT_BYTES,
} from "@convex/resourcePolicy";
import { type Infer, v } from "convex/values";
import { validate } from "convex-helpers/validators";

type MissionOperationArgs = {
    missionId?: Id<"agentMissions">;
    runId?: Id<"researchRuns">;
    expectedGeneration: number;
};

type MissionCaptureArgs = MissionOperationArgs & {
    sourceId: Id<"sources">;
};

const continuationValidator = v.object({
    version: v.literal(1),
    kind: v.union(v.literal("search"), v.literal("context")),
    scope: v.string(),
    captureId: v.id("sourceCaptures"),
    contentHash: v.string(),
    cursor: v.union(v.string(), v.null()),
    offset: v.number(),
    range: v.optional(
        v.object({ startOffset: v.number(), endOffset: v.number() }),
    ),
});
function readContinuation(
    token: string | undefined,
    scope: string,
    kind: "search" | "context",
): Infer<typeof continuationValidator> | null | "invalid" {
    if (token === undefined) return null;
    let value: unknown;
    try {
        value = JSON.parse(token);
    } catch {
        return "invalid";
    }
    if (
        !validate(continuationValidator, value) ||
        value.scope !== scope ||
        value.kind !== kind ||
        !Number.isSafeInteger(value.offset) ||
        value.offset < 0
    )
        return "invalid";
    return value;
}
function materialScope(
    args: MissionCaptureArgs,
    request: { query: string } | { passageOrder: number },
) {
    return sha256Hex(
        JSON.stringify({
            missionId: args.missionId ?? null,
            runId: args.runId ?? null,
            generation: args.expectedGeneration,
            sourceId: args.sourceId,
            ...request,
        }),
    );
}

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
            "material_continuation_unavailable",
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
            "material_continuation_invalid",
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
    args: MissionCaptureArgs & { query: string; continuation?: string },
): Promise<OperationObservationOutcome> {
    if (!args.query.trim())
        return { kind: "refused", code: "retrieval_query_invalid" };
    const scope = materialScope(args, { query: args.query });
    const continued = readContinuation(args.continuation, scope, "search");
    if (continued === "invalid")
        return { kind: "refused", code: "material_continuation_invalid" };
    const captureArgs = {
        missionId: args.missionId,
        runId: args.runId,
        expectedGeneration: args.expectedGeneration,
        sourceId: args.sourceId,
    };
    const result = await ctx.runAction(
        internal.sourceRetrievalActions.readApprovedMaterialForMission,
        {
            ...captureArgs,
            request: {
                kind: "search",
                query: args.query,
                ...(continued
                    ? {
                          cursor: continued.cursor ?? undefined,
                          expectedCaptureId: continued.captureId,
                          expectedContentHash: continued.contentHash,
                      }
                    : {}),
            },
        },
    );
    if (result.status !== "ready")
        return {
            kind:
                result.reason === "material_continuation_invalid"
                    ? "refused"
                    : "unavailable",
            code: result.reason,
        };
    if (result.kind !== "search")
        throw new Error("Unexpected approved material result");
    const base = {
        kind: "search_available_material",
        sourceId: args.sourceId,
        captureId: result.captureId,
        contentHash: result.contentHash,
        document: result.document,
        canonicalUrl: result.canonicalUrl,
        retrievedAt: result.retrievedAt,
    };
    const selected: typeof result.passages = [];
    const offset = continued?.offset ?? 0;
    if (offset > result.passages.length)
        return { kind: "refused", code: "material_continuation_invalid" };
    for (const passage of result.passages.slice(offset)) {
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
    const nextOffset = offset + selected.length;
    const withinPage = nextOffset < result.passages.length;
    if (withinPage && !selected.length)
        return { kind: "unavailable", code: "operation_result_capacity" };
    const continuation =
        withinPage || result.continueCursor
            ? JSON.stringify({
                  version: 1,
                  kind: "search",
                  scope,
                  captureId: result.captureId,
                  contentHash: result.contentHash,
                  cursor: withinPage
                      ? (continued?.cursor ?? null)
                      : result.continueCursor,
                  offset: withinPage ? nextOffset : 0,
              })
            : null;
    const value = {
        ...base,
        continuation,
        responseOmittedPassageCount: result.passages.length - nextOffset,
        captureOmittedPassageCount: result.captureOmittedPassageCount ?? null,
        passages: selected.map((passage) => ({
            passageOrder: passage.order,
            exactQuote: passage.quotation,
            headingPath: passage.headingPath,
        })),
        omittedPassageCount: result.passages.length - nextOffset,
        limitReached: result.limitReached || withinPage,
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
    args: MissionCaptureArgs & {
        passageOrder: number;
        continuation?: string;
        range?: { startOffset: number; endOffset: number };
    },
): Promise<OperationObservationOutcome> {
    const scope = materialScope(args, { passageOrder: args.passageOrder });
    const continued = readContinuation(args.continuation, scope, "context");
    if (
        continued === "invalid" ||
        (continued &&
            args.range &&
            (args.range.startOffset !== continued.range?.startOffset ||
                args.range.endOffset !== continued.range?.endOffset))
    )
        return { kind: "refused", code: "material_continuation_invalid" };
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
                range: continued?.range ?? args.range,
                ...(continued
                    ? {
                          offset: continued.offset,
                          expectedCaptureId: continued.captureId,
                          expectedContentHash: continued.contentHash,
                      }
                    : {}),
            },
        },
    );
    if (result.status !== "ready")
        return {
            kind:
                result.reason === "material_continuation_invalid"
                    ? "refused"
                    : "unavailable",
            code: result.reason,
        };
    if (result.kind !== "context")
        throw new Error("Unexpected approved material result");
    const { passage } = result;
    const range = passage.contextRange;
    const continuation =
        range &&
        passage.contextEndOffset !== undefined &&
        passage.contextEndOffset < range.endOffset
            ? JSON.stringify({
                  version: 1,
                  kind: "context",
                  scope,
                  captureId: result.captureId,
                  contentHash: result.contentHash,
                  cursor: null,
                  offset: passage.contextEndOffset,
                  range,
              })
            : null;
    const value = {
        continuation,
        captureOmittedPassageCount: result.captureOmittedPassageCount ?? null,
        kind: "read_in_context",
        document: result.document,
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
            contextStartOffset: passage.contextStartOffset,
            contextEndOffset: passage.contextEndOffset,
            contextRange: range,
            captureCharacters: passage.captureCharacters,
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
                    continuation: args.input.continuation,
                });
            case "read_in_context":
                return await readInContext(ctx, {
                    missionId: args.missionId,
                    runId: args.runId,
                    expectedGeneration: args.expectedGeneration,
                    sourceId: args.input.sourceId,
                    passageOrder: args.input.passageOrder,
                    continuation: args.input.continuation,
                    range: args.input.range,
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
