import { internal } from "@convex/_generated/api";
import type { Doc } from "@convex/_generated/dataModel";
import type { QueryCtx } from "@convex/_generated/server";
import {
    acquireDocumentResult,
    readInContextResult,
    savedMaterialWireContract,
    searchAvailableMaterialResult,
} from "@convex/domain/savedMaterialOperationResults";
import { executionError } from "@convex/execution/errors";
import type { AgentOperationDefinition } from "@convex/execution/executionProtocol";
import { operationReuseIdentity } from "@convex/execution/missionData";
import { v } from "convex/values";
import { validate } from "convex-helpers/validators";
import {
    resolveFramingAcquisition,
    resolveSourcesAcquisition,
} from "./documentaryAccess";
import {
    executeReferencedMaterialOperation,
    executeSavedMaterialOperation,
    resolveDocumentaryMaterialReference,
    resolveDocumentaryPinCapture,
} from "./savedMaterial";
import {
    acquireDocumentInput,
    documentaryReference,
    readInContextInputValidator,
    referencedSavedMaterialOperation,
    savedMaterialBinding,
    savedMaterialOperationValidator,
    searchAvailableMaterialInputValidator,
} from "./savedMaterialOperations";
import { stableStringify } from "./sourcePassages";
import { sourceMaterialReferenceValidator } from "./sourceRetrievalPolicy";

export const acquireDocumentOperation: AgentOperationDefinition = {
    effectKind: "durable_effect",
    nativeAuthority: "dossier",
    version: 1,
    description:
        "Acquire one observed public document. Use an issued acquisition reference or an exact URL from the active analyst's message. Use an issued refresh reference when a new representation is needed. Returns document metadata and a reading reference.",
    inputValidator: acquireDocumentInput,
    resultValidator: acquireDocumentResult,
    unknownOutcome: { kind: "unavailable", code: "operation_outcome_unknown" },
    identity: operationReuseIdentity,
    scheduledAction: internal.sourceCaptureActions.acquireDocument,
    async pin(ctx, mission, input) {
        if (!mission || input.kind !== "acquire_document")
            return { kind: "unavailable", code: "operation_not_allowed" };
        const { pin } =
            mission.definitionId === "sources_v1"
                ? await resolveSourcesAcquisition(ctx, mission, input.reference)
                : await resolveFramingAcquisition(
                      ctx,
                      mission,
                      input.reference,
                  );
        return { kind: "available", pin };
    },
    async validateOutcome(request, outcome, { db }) {
        if (outcome.kind !== "success") return outcome;
        const value = acquireDocumentResult.parse(
            JSON.parse(outcome.valueJson),
        );
        const [source, capture] = await Promise.all([
            db.get(value.sourceId),
            db.get(value.captureId),
        ]);
        const pin = request.pin;
        if (
            pin?.kind !== "documentary_v1" ||
            request.input.kind !== "acquire_document" ||
            pin.target.kind !== "acquisition" ||
            source?.runId !== request.runId ||
            source?.canonicalUrl !== pin.target.canonicalUrl ||
            capture?.protocol !== "documentary_v1" ||
            capture.runId !== request.runId ||
            capture.sourceId !== source._id ||
            capture.requestedUrl !== source.canonicalUrl ||
            capture.requestInputHash !== pin.target.requestInputHash ||
            capture.status !== "committed" ||
            !capture.storageId ||
            capture.contentHash !== value.contentHash ||
            value.canonicalUrl !== capture.requestedUrl ||
            capture.retrievedAt !== value.retrievedAt ||
            capture.representationCompleteness !==
                value.representationCompleteness ||
            stableStringify(capture.document) !==
                stableStringify(value.document) ||
            value.readingReference !==
                documentaryReference({
                    issuer: "operation",
                    operationId: request._id,
                    item: "document",
                }) ||
            ("captureId" in outcome && outcome.captureId !== value.captureId)
        )
            return { kind: "refused", code: "capture_identity_conflict" };
        return outcome;
    },
};

export const savedMaterialOperationBehavior: Pick<
    Extract<
        AgentOperationDefinition,
        { effectKind: "durable_effect"; execute: unknown }
    >,
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
        if (validate(referencedSavedMaterialOperation, args.input)) {
            if (!args.requestId)
                return {
                    outcome: { kind: "refused", code: "request_unavailable" },
                };
            return {
                outcome: await executeReferencedMaterialOperation(ctx, {
                    ...args,
                    requestId: args.requestId,
                    input: args.input,
                }),
            };
        }
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
    async validateOutcome(request, outcome, ctx) {
        if (request.pin?.kind === "documentary_v1") {
            if (outcome.kind !== "success") return outcome;
            const value: unknown = JSON.parse(outcome.valueJson);
            const wire = savedMaterialWireContract(
                request.input.kind,
                "referenced",
            );
            const capture = await resolveDocumentaryPinCapture(
                ctx,
                request.pin.target,
            );
            if (
                !wire?.resultValidator.safeParse(value).success ||
                !validate(sourceMaterialReferenceValidator, value, {
                    db: ctx.db,
                    allowUnknownFields: true,
                }) ||
                capture?.runId !== request.runId ||
                capture?.status !== "committed" ||
                value.sourceId !== capture.sourceId ||
                value.captureId !== capture._id ||
                value.contentHash !== capture.contentHash ||
                ("captureId" in outcome &&
                    outcome.captureId !== value.captureId)
            )
                return { kind: "refused", code: "capture_identity_conflict" };
            return outcome;
        }
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
        if (
            mission &&
            savedMaterialBinding(
                mission.definitionId,
                mission.definitionVersion,
            ) === "referenced"
        ) {
            if (!validate(referencedSavedMaterialOperation, input))
                return { kind: "unavailable", code: "operation_not_allowed" };
            const { pin } = await resolveDocumentaryMaterialReference(
                ctx,
                mission,
                input,
            );
            return { kind: "available", pin };
        }
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

const readingProvenanceGuidance =
    "The document field supplies recorded title, form and date metadata: dateKind distinguishes filing from publication, and null dates are unknown. Acquisition time is not a document date or reporting period. limitReached concerns the returned passage page, not a mission or reading allowance; use continuation for more passages. Saved-material reading does not consume external discovery allowance, but authority and overall execution limits still apply. Continuations are pagination data, not documentary evidence.";

export const savedMaterialOperations: Record<string, AgentOperationDefinition> =
    {
        search_available_material: {
            ...savedMaterialOperationBehavior,
            materialRead: true,
            version: 1,
            description: `Search one authorized saved capture with a nonblank query. Returns exact quotations and passageOrder locators; only returned locators can be read. Empty matches do not prove documentary absence. Inspect capture completeness and response omissions before concluding coverage. Copy continuation unchanged with the same source and query to read the next page; it never restarts on another capture. ${readingProvenanceGuidance}`,
            inputValidator: searchAvailableMaterialInputValidator
                .partial()
                .extend({
                    reference: v.optional(v.string()),
                    query: v.string(),
                }),
            resultValidator: searchAvailableMaterialResult,
        },
        read_in_context: {
            ...savedMaterialOperationBehavior,
            materialRead: true,
            version: 1,
            description: `Read a passageOrder returned by saved-material search in the same capture. Returns an exact quotation with paged context; optionally request a range in capture character offsets that includes the focal passage, then copy continuation unchanged to continue that same range. Capture and response omissions are separate. Returns bounded context and current documentary-use permissions. Capture/index omissions differ from response truncation; an unavailable locator was not read. Search again rather than guessing an order. ${readingProvenanceGuidance}`,
            inputValidator: readInContextInputValidator
                .partial()
                .extend({ reference: v.optional(v.string()) }),
            resultValidator: readInContextResult,
        },
    };
