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
    savedMaterialOperationValidator,
    searchAvailableMaterialInputValidator,
} from "./savedMaterialOperations";
export const savedMaterialOperationBehavior: Pick<
    AgentOperationDefinition,
    "pin" | "execute" | "validateOutcome" | "identity"
> = {
    identity: operationReuseIdentity,
    async execute(ctx, args) {
        if (!args.missionId)
            return { kind: "refused", code: "mission_required" };
        if (!validate(savedMaterialOperationValidator, args.input))
            return { kind: "refused", code: "operation_not_allowed" };
        return executeSavedMaterialOperation(ctx, {
            ...args,
            missionId: args.missionId,
            input: args.input,
        });
    },
    validateOutcome(request, outcome) {
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
    async pin(ctx: QueryCtx, mission: Doc<"agentMissions"> | undefined, input) {
        if (!mission) return { kind: "unavailable", code: "mission_required" };
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
                missionId: mission._id,
                expectedGeneration: mission.generation,
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
        },
        read_in_context: {
            ...savedMaterialOperationBehavior,
            version: 1,
            description:
                "Read one exact indexed quotation from an approved stored capture with bounded surrounding context.",
            inputValidator: readInContextInputValidator,
        },
    };
