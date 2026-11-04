import { internal } from "@convex/_generated/api";
import type { Doc } from "@convex/_generated/dataModel";
import type { QueryCtx } from "@convex/_generated/server";
import { executionError } from "@convex/execution/errors";
import type { AgentOperationDefinition } from "@convex/execution/executionProtocol";
import { operationReuseIdentity } from "@convex/execution/missionData";
import { validate } from "convex-helpers/validators";
import { executeSavedMaterialOperation } from "./savedMaterial";
import {
    readInContextInputValidator,
    readInContextResult,
    savedMaterialOperationValidator,
    searchAvailableMaterialInputValidator,
    searchAvailableMaterialResult,
} from "./savedMaterialOperations";
import { sourceMaterialReferenceValidator } from "./sourceRetrievalPolicy";
export const savedMaterialOperationBehavior: Pick<
    Extract<AgentOperationDefinition, { effectKind: "durable_effect" }>,
    | "nativeAuthority"
    | "effectKind"
    | "pin"
    | "execute"
    | "validateOutcome"
    | "identity"
> = {
    effectKind: "durable_effect",
    nativeAuthority: "dossier",
    identity: operationReuseIdentity,
    async execute(ctx, args) {
        if (!args.missionId && !args.runId)
            return { outcome: { kind: "refused", code: "mission_required" } };
        if (!validate(savedMaterialOperationValidator, args.input))
            return {
                outcome: { kind: "refused", code: "operation_not_allowed" },
            };
        return {
            outcome: await executeSavedMaterialOperation(
                ctx,
                args as Parameters<typeof executeSavedMaterialOperation>[1],
            ),
        };
    },
    validateOutcome(request, outcome, ctx) {
        if (outcome.kind === "success") {
            const value: unknown = JSON.parse(outcome.valueJson);
            if (
                !validate(sourceMaterialReferenceValidator, value, {
                    db: ctx.db,
                    allowUnknownFields: true,
                }) ||
                !("sourceId" in request.input) ||
                value.sourceId !== request.input.sourceId ||
                value.captureId !==
                    (request.pin?.kind === "saved_material_inspection_v1"
                        ? request.pin.expectedCaptureId
                        : request.expectedCaptureId)
            )
                return { kind: "refused", code: "capture_identity_conflict" };
        }
        const expected =
            request.pin?.kind === "saved_material_inspection_v1"
                ? request.pin.expectedCaptureId
                : request.expectedCaptureId;
        return outcome.kind === "success" &&
            "captureId" in outcome &&
            outcome.captureId &&
            outcome.captureId !== expected
            ? { kind: "refused", code: "capture_identity_conflict" }
            : outcome;
    },
    async pin(
        ctx: QueryCtx,
        mission: Doc<"agentMissions"> | undefined,
        input,
        runId,
    ) {
        const run = runId ? await ctx.db.get(runId) : null;
        if (!mission && !run)
            return { kind: "unavailable", code: "mission_required" };
        if (input.kind === "invalid")
            return {
                kind: "available" as const,
                pin: { kind: "saved_material_inspection_v1" },
            };
        if (!validate(savedMaterialOperationValidator, input))
            return { kind: "unavailable", code: "operation_not_allowed" };
        if (!ctx.db.normalizeId("sources", input.sourceId))
            throw executionError("invalid_operation_input");
        const allowed = await ctx.runQuery(
            internal.sourceRetrieval.approvedCaptureForMission,
            {
                missionId: mission?._id,
                runId: mission ? undefined : run?._id,
                expectedGeneration:
                    mission?.generation ?? run?.executionGeneration ?? -1,
                sourceId: input.sourceId,
            },
        );
        if (allowed.status !== "available")
            return { kind: "unavailable" as const, code: allowed.reason };
        return {
            kind: "available" as const,
            pin: {
                kind: "saved_material_inspection_v1",
                expectedCaptureId: allowed.capture._id,
                expectedContentHash: allowed.capture.contentHash,
            },
        };
    },
};

export const savedMaterialOperations: Record<string, AgentOperationDefinition> =
    {
        search_available_material: {
            ...savedMaterialOperationBehavior,
            version: 1,
            description:
                "Search one source in the mission's approved stored capture and return matching exact quotations.",
            inputValidator: searchAvailableMaterialInputValidator,
            resultValidator: searchAvailableMaterialResult,
        },
        read_in_context: {
            ...savedMaterialOperationBehavior,
            version: 1,
            description:
                "Read one exact indexed quotation from an approved stored capture with bounded surrounding context.",
            inputValidator: readInContextInputValidator,
            resultValidator: readInContextResult,
        },
    };
