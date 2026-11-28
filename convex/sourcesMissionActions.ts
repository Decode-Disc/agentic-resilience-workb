"use node";

import { internal } from "@convex/_generated/api";
import { type ActionCtx, internalAction } from "@convex/_generated/server";
import { sha256Hex } from "@convex/domain/sourcePassages";
import { preparationFailureCode } from "@convex/domain/sourcePreparationAuthority";
import { SOURCES_RESOURCE_LIMIT_CODES } from "@convex/domain/sources";
import { consultableSourceResult } from "@convex/domain/sourcesOperationResults";
import {
    executionFailureCode,
    executionFailureValidation,
} from "@convex/execution/errors";
import {
    operationOutcomeValidator,
    scheduledOperationArgs,
} from "@convex/execution/executionProtocol";
import { operationSuccess } from "@convex/execution/operationResults";
import { executeScheduledOperation } from "@convex/execution/operations";
import { nodeActionGenerationDeadline } from "@convex/resourcePolicy";
import { type Infer, v } from "convex/values";
import { ensureSourceCaptureIndex } from "./sourceRetrievalActions";
import { discoverForNeed } from "./sources/discoverForNeed";
import { examineContributions } from "./sources/examineContributions";

/** A canonical durable operation reuses acquisition, discovery, model receipts and indexing owners. */
export const execute = internalAction({
    args: scheduledOperationArgs,
    returns: v.union(operationOutcomeValidator, v.null()),
    handler: async (
        ctx,
        args,
    ): Promise<Infer<typeof operationOutcomeValidator> | null> => {
        const executionDeadlineAt = nodeActionGenerationDeadline(Date.now());
        return executeScheduledOperation(ctx, args, () =>
            executeSourcesOperation(ctx, args, executionDeadlineAt),
        );
    },
});

async function executeSourcesOperation(
    ctx: ActionCtx,
    args: {
        requestId: import("@convex/_generated/dataModel").Id<"agentOperationRequests">;
        expectedGeneration: number;
        epoch: number;
    },
    executionDeadlineAt: number,
): Promise<Infer<typeof operationOutcomeValidator>> {
    try {
        const reservation = await ctx.runMutation(
            internal.sourcesMission.reserve,
            args,
        );
        const { preparation, input, sourceId } = reservation;
        const simulation = await ctx.runQuery(
            internal.sourcesSimulation.enabled,
            { runId: preparation.runId },
        );
        if (input.kind === "make_source_consultable") {
            if (!sourceId)
                return {
                    kind: "refused",
                    code: "acquisition_target_invalid",
                };
            const result = await ctx.runAction(
                internal.sourceCaptureActions.inspectSource,
                { preparationId: preparation._id, sourceId },
            );
            if (!result.sourceCaptureId || result.status === "unavailable")
                return {
                    kind: "unavailable",
                    code: result.reasonCode ?? "capture_unavailable",
                };
            if (!result.contentHash)
                return {
                    kind: "unavailable",
                    code: "capture_artifact_missing",
                };
            await ctx.runQuery(internal.sourcesMission.assertActive, args);
            await ctx.runMutation(internal.sourcesMission.retainCapture, {
                ...args,
                captureId: result.sourceCaptureId,
            });
            await ensureSourceCaptureIndex(ctx, {
                preparationId: preparation._id,
                captureId: result.sourceCaptureId,
                mode: "lexical",
            });
            return {
                ...operationSuccess(
                    consultableSourceResult,
                    {
                        sourceId,
                        captureId: result.sourceCaptureId,
                        status: result.status,
                        contentHash: result.contentHash,
                    },
                    {
                        progressKeys: [
                            sha256Hex(`capture:${result.sourceCaptureId}`),
                        ],
                    },
                ),
            };
        }
        if (input.kind === "discover_sources_for_need")
            return await discoverForNeed(
                ctx,
                args,
                reservation,
                input,
                simulation,
            );
        return await examineContributions(
            ctx,
            args,
            reservation,
            simulation,
            executionDeadlineAt,
        );
    } catch (error) {
        const code =
            executionFailureCode(error) ?? preparationFailureCode(error);
        if (!code) throw error;
        if (
            code === "source_candidate_limit" ||
            Object.values(SOURCES_RESOURCE_LIMIT_CODES).some(
                (limitCode) => limitCode === code,
            )
        )
            return { kind: "refused", code };
        const validation = executionFailureValidation(error);
        return {
            kind: "unavailable",
            code,
            ...(validation ? { validation } : {}),
        };
    }
}
