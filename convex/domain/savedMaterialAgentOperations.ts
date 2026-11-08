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
            materialRead: true,
            version: 1,
            description:
                "Search one authorized saved capture with a nonblank query. Returns exact quotations and passageOrder locators; only returned locators can be read. Empty matches do not prove documentary absence. Inspect capture completeness and response omissions before concluding coverage. Copy continuation unchanged with the same source and query to read the next page; it never restarts on another capture.",
            inputValidator: searchAvailableMaterialInputValidator,
            resultValidator: searchAvailableMaterialResult,
        },
        read_in_context: {
            ...savedMaterialOperationBehavior,
            materialRead: true,
            version: 1,
            description:
                "Read a passageOrder returned by saved-material search in the same capture. Returns an exact quotation with paged context; optionally request a range in capture character offsets that includes the focal passage, then copy continuation unchanged to continue that same range. Capture and response omissions are separate. Returns bounded context and current documentary-use permissions. Capture/index omissions differ from response truncation; an unavailable locator was not read. Search again rather than guessing an order.",
            inputValidator: readInContextInputValidator,
            resultValidator: readInContextResult,
        },
    };
