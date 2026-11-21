import { internal } from "@convex/_generated/api";
import type { Doc, Id } from "@convex/_generated/dataModel";
import type { ActionCtx, QueryCtx } from "@convex/_generated/server";
import {
    canonicalFramingUrl,
    confirmedFramingFiling,
    documentaryCaptureAvailable,
    documentaryMaterialContext,
    framingMessageUrls,
    retainedDocumentAvailable,
} from "@convex/domain/documentaryAccess";
import {
    documentDates,
    recordedDocumentDate,
} from "@convex/domain/documentDates";
import {
    acquireDocumentResult,
    type documentaryCause,
    type documentaryPin,
    documentaryRange,
    documentaryReference,
    parseDocumentaryReference,
    type ReferencedSavedMaterialOperation,
    referencedContextResult,
    referencedSearchResult,
    type SavedMaterialOperation,
} from "@convex/domain/savedMaterialOperations";
import { sha256Hex, stableStringify } from "@convex/domain/sourcePassages";
import {
    capturedDocumentMetadata,
    readCaptureIndexState,
    sourceDocumentMetadata,
} from "@convex/domain/sourceRetrievalPolicy";
import {
    adoptedPublicRead,
    explicitResearchCommand,
    framingObservationRefusal,
    observedPublicRead,
} from "@convex/domain/workbenchContracts";
import { requireMissionAuthority } from "@convex/execution/authority";
import { executionError, executionFailureCode } from "@convex/execution/errors";
import {
    type OperationObservationOutcome,
    operationHasStarted,
} from "@convex/execution/executionProtocol";
import { operationObservationManifest } from "@convex/execution/retainedText";
import {
    MAX_NORMALIZED_ARTIFACT_BYTES,
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

export const referencedReadExtent = v.union(
    v.object({ kind: v.literal("beginning") }),
    v.object({
        kind: v.literal("focal"),
        range: documentaryRange,
        quotation: v.string(),
        passageOrder: v.number(),
    }),
    v.object({
        kind: v.literal("next"),
        offset: v.number(),
        endOffset: v.number(),
        readKind: referencedContextResult.fields.readKind,
    }),
);

type DocumentaryView = Awaited<ReturnType<typeof documentaryMaterialContext>>;

export const retainedDocumentCaptureKey = (
    rootOperationId: Id<"agentOperationRequests">,
    contentHash: string,
) => `retained-document:${rootOperationId}:${contentHash}`;

export async function retainedDocumentRoot(
    ctx: QueryCtx,
    view: DocumentaryView,
    root: Doc<"agentOperationRequests"> | null,
    use: "observed" | "continuation" = "observed",
) {
    if (root?.runId !== view.run._id || root.pin?.kind !== "framing_revision")
        return null;
    const result =
        use === "continuation"
            ? adoptedPublicRead(root)
            : observedPublicRead(root);
    const record = result?.document;
    if (!record || record.readId !== root._id || !result.reference) return null;
    const canonicalUrl = canonicalFramingUrl(result.reference.url);
    if (!canonicalUrl) return null;
    const access = await retainedDocumentAvailable(ctx, view, canonicalUrl);
    if (!access) return null;
    const manifest = await operationObservationManifest(ctx, root._id);
    if (
        !manifest ||
        manifest.contentHash !== record.contentHash ||
        manifest.characters !== record.characters ||
        manifest.sizeBytes < 1 ||
        manifest.sizeBytes > MAX_NORMALIZED_ARTIFACT_BYTES
    )
        throw executionError("retained_text_invalid");
    const origin: Doc<"sources">["origin"] =
        view.run.companySnapshot &&
        confirmedFramingFiling(canonicalUrl, view.run.companySnapshot.cik)
            ? "sec"
            : root.input.kind === "read_public_context" &&
                root.input.target.kind === "supplied"
              ? "analyst_url"
              : "exa";
    const reported = result.reference.publishedAt
        ? Date.parse(result.reference.publishedAt)
        : undefined;
    const metadata = sourceDocumentMetadata({
        title: access.source?.title ?? result.reference.publisher,
        origin,
        publishedAt:
            reported !== undefined && Number.isFinite(reported)
                ? reported
                : undefined,
        secForm: access.source?.secForm,
    });
    const dateEvidence = result.reference.eventAt
        ? Date.parse(result.reference.eventAt)
        : NaN;
    const document = capturedDocumentMetadata(
        {
            ...metadata,
            dates:
                result.reference.dates ??
                documentDates({
                    previous: metadata.dates,
                    text: "",
                    metadata: Number.isFinite(dateEvidence)
                        ? [
                              recordedDocumentDate("event", dateEvidence, {
                                  kind: "metadata",
                                  label: "eventAt",
                                  raw: result.reference.eventAt ?? "",
                              }),
                          ]
                        : [],
                }),
        },
        "",
    );
    const receipt = await ctx.db
        .query("providerCalls")
        .withIndex("by_operation_key", (q) =>
            q.eq(
                "operationKey",
                `workbench:${root._id}:${origin === "sec" ? "sec_filing" : "framing_context_read"}`,
            ),
        )
        .first();
    const retrievedAt =
        receipt?.status === "succeeded" &&
        receipt.operationRequestId === root._id
            ? receipt.completedAt
            : undefined;
    return {
        rootOperationId: root._id,
        canonicalUrl,
        contentHash: manifest.contentHash,
        sizeBytes: manifest.sizeBytes,
        characters: manifest.characters,
        fragments: manifest.fragmentHashes.length,
        representationCompleteness: record.acquisitionCompleteness,
        retrievedAt,
        document,
        origin,
        sourceId: access.source?._id,
        captureKey: retainedDocumentCaptureKey(root._id, manifest.contentHash),
    };
}

async function retainedCapture(ctx: Pick<QueryCtx, "db">, captureKey: string) {
    return ctx.db
        .query("sourceCaptures")
        .withIndex("by_capture_key", (q) => q.eq("captureKey", captureKey))
        .unique();
}

export async function resolveDocumentaryPinCapture(
    ctx: Pick<QueryCtx, "db">,
    target: Infer<typeof documentaryPin>["target"],
) {
    if (target.kind === "acquisition") return null;
    const capture =
        target.kind === "capture"
            ? await ctx.db.get(target.captureId)
            : await retainedCapture(
                  ctx,
                  retainedDocumentCaptureKey(
                      target.rootOperationId,
                      target.contentHash,
                  ),
              );
    if (capture?.contentHash !== target.contentHash) return null;
    return (
        target.kind === "capture"
            ? capture.sourceId === target.sourceId
            : capture.retainedImport?.rootOperationId ===
                  target.rootOperationId &&
              capture.requestedUrl === target.canonicalUrl
    )
        ? capture
        : null;
}

export async function documentaryInventory(
    ctx: QueryCtx,
    mission: Doc<"agentMissions">,
) {
    let frame: Awaited<ReturnType<typeof documentaryMaterialContext>>;
    try {
        frame = await documentaryMaterialContext(ctx, mission);
    } catch (error) {
        if (
            [
                "instruction_not_authorized",
                "documentary_material_unavailable",
            ].includes(executionFailureCode(error) ?? "")
        )
            return { materials: [], analystUrls: [], unavailableMaterials: [] };
        throw error;
    }
    const instructions =
        "instructions" in frame ? frame.instructions : undefined;
    const messages =
        instructions?.messages.filter(
            (message) => !explicitResearchCommand(message.text),
        ) ?? [];
    const materials = [];
    for await (const capture of ctx.db
        .query("sourceCaptures")
        .withIndex("by_run_and_status", (q) =>
            q.eq("runId", frame.run._id).eq("status", "committed"),
        )) {
        if (
            !capture.contentHash ||
            !(await documentaryCaptureAvailable(ctx, frame, capture))
        )
            continue;
        const source = await ctx.db.get(capture.sourceId);
        if (source?.runId !== capture.runId) continue;
        const state = await readCaptureIndexState(
            ctx.db,
            {
                runId: frame.run._id,
                corpusRevisionId: frame.corpusRevisionId,
            },
            capture._id,
        );
        if (state && state.contentHash !== capture.contentHash)
            throw executionError("capture_identity_conflict");
        materials.push({
            sourceId: capture.sourceId,
            captureId: capture._id,
            contentHash: capture.contentHash,
            canonicalUrl: capture.resolvedUrl ?? capture.requestedUrl,
            document: capture.document ?? sourceDocumentMetadata(source),
            retrievedAt: capture.retrievedAt ?? null,
            representationCompleteness:
                capture.representationCompleteness ??
                capture.readingCompleteness ??
                "unknown",
            indexStatus: state ? "indexed" : "not_indexed",
            readingReferences: instructions
                ? messages.map(({ messageId }) => ({
                      messageId,
                      reference: documentaryReference({
                          issuer: "capture",
                          captureId: capture._id,
                          conversationCause: {
                              messageId,
                              instructionVersion:
                                  instructions.instructionVersion,
                          },
                      }),
                      ...(frame.scope.kind === "framing"
                          ? {
                                refreshReference: documentaryReference({
                                    issuer: "capture_refresh",
                                    captureId: capture._id,
                                    conversationCause: {
                                        messageId,
                                        instructionVersion:
                                            instructions.instructionVersion,
                                    },
                                }),
                            }
                          : {}),
                  }))
                : [
                      {
                          reference: documentaryReference({
                              issuer: "capture",
                              captureId: capture._id,
                          }),
                          ...(frame.scope.kind === "sources"
                              ? {
                                    refreshReference: documentaryReference({
                                        issuer: "capture_refresh",
                                        captureId: capture._id,
                                    }),
                                }
                              : {}),
                      },
                  ],
        });
    }
    const retainedMaterials = [];
    const unavailableMaterials = new Map<
        string,
        {
            canonicalUrl: string;
            contentHash: string;
            reason: "retained_text_invalid" | "retained_text_incomplete";
        }
    >();
    if (frame.scope.kind !== "inspection") {
        for await (const request of ctx.db
            .query("agentOperationRequests")
            .withIndex("by_run_and_input_kind", (q) =>
                q
                    .eq("runId", frame.run._id)
                    .eq("input.kind", "read_public_context")
                    .eq("input.continuation", undefined),
            )) {
            let root: Awaited<ReturnType<typeof retainedDocumentRoot>>;
            try {
                root = await retainedDocumentRoot(ctx, frame, request);
            } catch (error) {
                const reason = executionFailureCode(error);
                if (
                    reason !== "retained_text_invalid" &&
                    reason !== "retained_text_incomplete"
                )
                    throw error;
                const observation = observedPublicRead(request);
                const canonicalUrl =
                    observation?.reference &&
                    canonicalFramingUrl(observation.reference.url);
                const contentHash = observation?.document?.contentHash;
                if (!canonicalUrl || !contentHash) throw error;
                unavailableMaterials.set(request._id, {
                    canonicalUrl,
                    contentHash,
                    reason,
                });
                continue;
            }
            if (!root) continue;
            const imported = await retainedCapture(ctx, root.captureKey);
            if (
                imported?.status === "committed" &&
                materials.some((item) => item.captureId === imported._id)
            )
                continue;
            retainedMaterials.push({
                canonicalUrl: root.canonicalUrl,
                contentHash: root.contentHash,
                document: root.document,
                representationCompleteness: root.representationCompleteness,
                retrievedAt: root.retrievedAt ?? null,
                readingReferences: instructions
                    ? messages.map(({ messageId }) => ({
                          messageId,
                          reference: documentaryReference({
                              issuer: "retained_document",
                              rootOperationId: root.rootOperationId,
                              conversationCause: {
                                  messageId,
                                  instructionVersion:
                                      instructions.instructionVersion,
                              },
                          }),
                      }))
                    : [
                          {
                              reference: documentaryReference({
                                  issuer: "retained_document",
                                  rootOperationId: root.rootOperationId,
                              }),
                          },
                      ],
            });
        }
    }
    return {
        materials: [...materials, ...retainedMaterials],
        unavailableMaterials: [...unavailableMaterials.values()],
        analystUrls:
            frame.scope.kind === "framing"
                ? messages.flatMap(({ messageId, text }) =>
                      framingMessageUrls(text).map((url) => ({
                          messageId,
                          url,
                          reference: documentaryReference({
                              issuer: "analyst_url",
                              messageId,
                              url,
                          }),
                      })),
                  )
                : [],
    };
}

function scopeForReference(
    frame: DocumentaryView,
    cause: Infer<typeof documentaryCause> | undefined,
): Infer<typeof documentaryPin>["scope"] {
    if (
        frame.scope.kind === "framing" ||
        frame.scope.kind === "workbench_read"
    ) {
        const instructions =
            "instructions" in frame ? frame.instructions : undefined;
        if (
            !cause ||
            cause.instructionVersion !== instructions?.instructionVersion ||
            !instructions.messages.some(
                ({ messageId, text }) =>
                    messageId === cause.messageId &&
                    !explicitResearchCommand(text),
            )
        )
            throw executionError("framing_observation_stale");
        return { ...frame.scope, cause };
    }
    if (cause) throw executionError("source_reference_not_observed");
    return frame.scope;
}

async function documentaryCaptureSelection(
    ctx: QueryCtx,
    frame: DocumentaryView,
    cause: Infer<typeof documentaryCause> | undefined,
    captureId: Id<"sourceCaptures">,
    extent: Infer<typeof referencedReadExtent>,
    identity?: { sourceId: Id<"sources">; contentHash: string },
) {
    const scope = scopeForReference(frame, cause);
    const capture = await ctx.db.get(captureId);
    if (
        !capture?.contentHash ||
        !(await documentaryCaptureAvailable(ctx, frame, capture)) ||
        (identity &&
            (capture.sourceId !== identity.sourceId ||
                capture.contentHash !== identity.contentHash))
    )
        throw executionError("capture_identity_conflict");
    const source = await ctx.db.get(capture.sourceId);
    if (source?.runId !== frame.run._id)
        throw executionError("capture_identity_conflict");
    return {
        capture: {
            ...capture,
            contentHash: capture.contentHash,
            document: capture.document ?? sourceDocumentMetadata(source),
            representationCompleteness:
                capture.representationCompleteness ??
                capture.readingCompleteness ??
                "unknown",
        },
        corpusRevisionId: frame.corpusRevisionId,
        extent,
        pin: {
            kind: "documentary_v1",
            scope,
            target: {
                kind: "capture",
                captureId: capture._id,
                sourceId: capture.sourceId,
                contentHash: capture.contentHash,
            },
        } as const,
    };
}

/** An issued reference is usable only after its exact operation result has been adopted. */
async function observedDocumentaryReference(ctx: QueryCtx, token: string) {
    const ref = parseDocumentaryReference(token);
    if (ref?.issuer !== "operation" || ref.item === "candidate") return null;
    const id = ctx.db.normalizeId("agentOperationRequests", ref.operationId);
    const issuer = id ? await ctx.db.get(id) : null;
    if (
        issuer?.pin?.kind !== "documentary_v1" ||
        issuer.status !== "completed" ||
        issuer.adoptedAt === undefined ||
        issuer.adoptionRefusalCode ||
        issuer.outcome?.kind !== "success"
    )
        return null;
    const value: unknown = JSON.parse(issuer.outcome.valueJson);
    if (ref.item === "document" && issuer.input.kind === "acquire_document") {
        const acquired = acquireDocumentResult.safeParse(value);
        return acquired.success && acquired.data.readingReference === token
            ? { item: "document" as const, issuer, value: acquired.data }
            : null;
    }
    if (
        ref.item === "passage" &&
        issuer.input.kind === "search_available_material" &&
        validate(referencedSearchResult, value, { db: ctx.db })
    ) {
        const displayed =
            Number.isSafeInteger(ref.index) && ref.index >= 0
                ? value.passages[ref.index]
                : undefined;
        return displayed?.reference === token
            ? {
                  item: "passage" as const,
                  issuer,
                  value,
                  readKind: "search" as const,
                  excerpt: displayed.exactQuote,
                  range: displayed.range,
                  passageOrder: displayed.passageOrder,
              }
            : null;
    }
    if (
        issuer.input.kind !== "read_in_context" ||
        !validate(referencedContextResult, value, { db: ctx.db })
    )
        return null;
    if (ref.item === "next" && value.nextReference === token)
        return { item: "next" as const, issuer, value };
    if (ref.item === "passage" && ref.index === 0 && value.reference === token)
        return {
            item: "passage" as const,
            issuer,
            value,
            readKind: value.readKind,
            excerpt: value.text,
            range: value.range,
        };
    return null;
}

/** Returns the displayed text, never the text promised by a beginning or continuation handle. */
export async function displayedDocumentaryPassage(
    ctx: QueryCtx,
    reference: string,
) {
    const observation = await observedDocumentaryReference(ctx, reference);
    return observation?.item === "passage" ? observation : null;
}

/** Recheck current authority without invalidating an adopted observation on an agent's save. */
export async function resolveDocumentaryMaterialReference(
    ctx: QueryCtx,
    mission: Doc<"agentMissions">,
    input: ReferencedSavedMaterialOperation,
) {
    const frame = await documentaryMaterialContext(ctx, mission);
    const ref = parseDocumentaryReference(input.reference);
    if (ref?.issuer === "retained_document") {
        const scope = scopeForReference(frame, ref.conversationCause);
        const rootId = ctx.db.normalizeId(
            "agentOperationRequests",
            ref.rootOperationId,
        );
        const root = rootId
            ? await retainedDocumentRoot(ctx, frame, await ctx.db.get(rootId))
            : null;
        if (!root) throw executionError("source_reference_not_observed");
        const existing = await retainedCapture(ctx, root.captureKey);
        const capture =
            existing?.status === "committed" &&
            existing.contentHash === root.contentHash &&
            existing.runId === frame.run._id &&
            existing.requestedUrl === root.canonicalUrl &&
            existing.retainedImport?.rootOperationId === root.rootOperationId &&
            existing.document &&
            existing.representationCompleteness
                ? {
                      ...existing,
                      contentHash: existing.contentHash,
                      document: existing.document,
                      representationCompleteness:
                          existing.representationCompleteness,
                  }
                : undefined;
        return {
            capture,
            retained: root,
            runId: frame.run._id,
            corpusRevisionId: frame.corpusRevisionId,
            extent: { kind: "beginning" as const },
            pin: {
                kind: "documentary_v1" as const,
                scope,
                target: {
                    kind: "retained_document" as const,
                    rootOperationId: root.rootOperationId,
                    canonicalUrl: root.canonicalUrl,
                    contentHash: root.contentHash,
                },
            },
        };
    }
    if (ref?.issuer === "capture") {
        const captureId = ctx.db.normalizeId("sourceCaptures", ref.captureId);
        if (!captureId) throw executionError("source_reference_not_observed");
        return documentaryCaptureSelection(
            ctx,
            frame,
            ref.conversationCause,
            captureId,
            { kind: "beginning" },
        );
    }

    const observation = await observedDocumentaryReference(
        ctx,
        input.reference,
    );
    if (observation?.issuer.pin?.kind !== "documentary_v1")
        throw executionError("source_reference_not_observed");
    const { issuer, value } = observation;
    const issuingScope = observation.issuer.pin.scope;
    const cause = "cause" in issuingScope ? issuingScope.cause : undefined;
    if (
        issuingScope.kind !== frame.scope.kind ||
        issuer.runId !== frame.run._id ||
        issuer.missionId !== mission._id
    )
        throw executionError("framing_observation_stale");
    if (frame.scope.kind === "framing" && "instructions" in frame) {
        const refusal = framingObservationRefusal(issuer, {
            runId: frame.run._id,
            missionId: mission._id,
            instructionVersion: frame.instructions.instructionVersion,
            messageId: cause?.messageId,
        });
        if (refusal) throw executionError(refusal);
    } else if (
        stableStringify(issuingScope) !==
            stableStringify({ ...frame.scope, ...(cause ? { cause } : {}) }) ||
        ("instructions" in frame &&
            issuer.instructionVersion !== frame.instructions.instructionVersion)
    )
        throw executionError("framing_observation_stale");
    if (
        (issuer.adoptionGeneration ?? issuer.expectedGeneration) !==
        mission.generation
    )
        throw executionError("framing_observation_stale");

    let extent: Infer<typeof referencedReadExtent> = { kind: "beginning" };
    if (input.kind === "read_in_context") {
        if (observation.item === "next") {
            extent = {
                kind: "next",
                offset: observation.value.range.endOffset,
                endOffset: observation.value.captureCharacters,
                readKind: observation.value.readKind,
            };
        } else if (observation.item === "passage") {
            if (observation.readKind !== "search")
                throw executionError("source_reference_not_observed");
            extent = {
                kind: "focal",
                range: observation.range,
                quotation: observation.excerpt,
                passageOrder: observation.passageOrder,
            };
        }
    } else if (observation.item === "next") {
        throw executionError("source_reference_not_observed");
    }
    return documentaryCaptureSelection(
        ctx,
        frame,
        cause,
        value.captureId,
        extent,
        value,
    );
}

export async function requireDocumentaryMaterialRequest(
    ctx: QueryCtx,
    args: {
        requestId: Id<"agentOperationRequests">;
        expectedGeneration: number;
    },
) {
    const request = await ctx.db.get(args.requestId);
    if (
        !request?.missionId ||
        !operationHasStarted(request) ||
        request.expectedGeneration !== args.expectedGeneration ||
        (request.input.kind !== "search_available_material" &&
            request.input.kind !== "read_in_context") ||
        !("reference" in request.input)
    )
        throw executionError("request_unavailable");
    const { mission } = await requireMissionAuthority(
        ctx,
        request.missionId,
        args.expectedGeneration,
    );
    const selected = await resolveDocumentaryMaterialReference(
        ctx,
        mission,
        request.input,
    );
    if (stableStringify(selected.pin) !== stableStringify(request.pin))
        throw executionError("version_conflict");
    return { ...selected, input: request.input };
}

export async function executeReferencedMaterialOperation(
    ctx: ActionCtx,
    args: {
        requestId: Id<"agentOperationRequests">;
        expectedGeneration: number;
        missionId?: Id<"agentMissions">;
        input: ReferencedSavedMaterialOperation;
    },
): Promise<OperationObservationOutcome> {
    try {
        const authority = {
            requestId: args.requestId,
            expectedGeneration: args.expectedGeneration,
        };
        if (
            parseDocumentaryReference(args.input.reference)?.issuer ===
            "retained_document"
        ) {
            const imported = await ctx.runAction(
                internal.sourceCaptureActions.importRetainedDocument,
                authority,
            );
            if (imported.status === "unavailable")
                return { kind: "unavailable", code: imported.reason };
        }
        const { capture, mayAcquireObservedDestinations } = await ctx.runQuery(
            internal.sourceRetrieval.documentaryCaptureForOperation,
            authority,
        );
        const base = {
            sourceId: capture.sourceId,
            captureId: capture._id,
            contentHash: capture.contentHash,
            canonicalUrl: capture.resolvedUrl ?? capture.requestedUrl,
            retrievedAt: capture.retrievedAt ?? null,
            document: capture.document,
            representationCompleteness: capture.representationCompleteness,
        };
        const scope = sha256Hex(
            stableStringify({
                missionId: args.missionId,
                generation: args.expectedGeneration,
                reference: args.input.reference,
                query:
                    args.input.kind === "search_available_material"
                        ? args.input.query
                        : undefined,
            }),
        );
        const continuation =
            args.input.kind === "search_available_material"
                ? readContinuation(args.input.continuation, scope, "search")
                : null;
        if (
            args.input.kind === "search_available_material" &&
            !args.input.query.trim()
        )
            return { kind: "refused", code: "retrieval_query_invalid" };
        if (
            continuation === "invalid" ||
            (continuation &&
                (continuation.captureId !== capture._id ||
                    continuation.contentHash !== capture.contentHash))
        )
            return { kind: "refused", code: "material_continuation_invalid" };
        const reading = await ctx.runAction(
            internal.sourceRetrievalActions.readDocumentaryForOperation,
            {
                ...authority,
                cursor: continuation?.cursor ?? undefined,
            },
        );
        if (reading.status !== "ready")
            return { kind: "unavailable", code: reading.reason };
        if (reading.kind === "context") {
            const value = {
                ...base,
                kind: "read_in_context" as const,
                text: reading.text,
                readKind: reading.readKind,
                range: reading.range,
                captureCharacters: reading.captureCharacters,
                ...(mayAcquireObservedDestinations &&
                capture.observedDestinations?.length
                    ? {
                          observedDestinations:
                              capture.observedDestinations.map(
                                  (destination, index) => ({
                                      urlPreview: Array.from(destination.url)
                                          .slice(0, 80)
                                          .join(""),
                                      acquisitionReference:
                                          documentaryReference({
                                              issuer: "operation",
                                              operationId: args.requestId,
                                              item: "destination",
                                              index,
                                          }),
                                  }),
                              ),
                      }
                    : {}),
                ...(reading.indexedPassage
                    ? { indexedPassage: reading.indexedPassage }
                    : {}),
                reference: documentaryReference({
                    issuer: "operation",
                    operationId: args.requestId,
                    item: "passage",
                    index: 0,
                }),
                ...(reading.range.endOffset < reading.captureCharacters
                    ? {
                          nextReference: documentaryReference({
                              issuer: "operation",
                              operationId: args.requestId,
                              item: "next",
                          }),
                      }
                    : {}),
            };
            return {
                kind: "success",
                value,
                captureId: capture._id,
                progressKey: sha256Hex(
                    stableStringify({
                        ...base,
                        range: reading.range,
                    }),
                ),
            };
        }
        const offset = continuation?.offset ?? 0;
        if (offset > reading.passages.length)
            return { kind: "refused", code: "material_continuation_invalid" };
        const passages: Infer<typeof referencedSearchResult>["passages"] = [];
        for (const passage of reading.passages.slice(offset)) {
            const displayed = {
                reference: documentaryReference({
                    issuer: "operation",
                    operationId: args.requestId,
                    item: "passage",
                    index: passages.length,
                }),
                passageOrder: passage.order,
                exactQuote: passage.quotation,
                headingPath: passage.headingPath,
                range: {
                    startOffset: passage.startOffset,
                    endOffset: passage.endOffset,
                },
            };
            if (
                new TextEncoder().encode(
                    JSON.stringify({
                        ...base,
                        passages: [...passages, displayed],
                    }),
                ).length > MAX_SEARCH_RESULT_BYTES
            )
                break;
            passages.push(displayed);
        }
        const nextOffset = offset + passages.length;
        const withinPage = nextOffset < reading.passages.length;
        if (withinPage && !passages.length)
            return { kind: "unavailable", code: "operation_result_capacity" };
        const limitReached = withinPage || reading.continueCursor !== null;
        return {
            kind: "success",
            value: {
                ...base,
                kind: "search_available_material",
                passages,
                limitReached,
                ...(limitReached
                    ? {
                          continuation: JSON.stringify({
                              version: 1,
                              kind: "search",
                              scope,
                              captureId: capture._id,
                              contentHash: capture.contentHash,
                              cursor: withinPage
                                  ? (continuation?.cursor ?? null)
                                  : reading.continueCursor,
                              offset: withinPage ? nextOffset : 0,
                          } satisfies Infer<typeof continuationValidator>),
                      }
                    : {}),
            },
            ...(passages.length ? { captureId: capture._id } : {}),
            progressKeys: passages.map(({ passageOrder, range }) =>
                sha256Hex(
                    stableStringify({
                        captureId: capture._id,
                        contentHash: capture.contentHash,
                        passageOrder,
                        range,
                    }),
                ),
            ),
        };
    } catch (error) {
        const outcome = failedOutcome(error);
        if (outcome) return outcome;
        throw error;
    }
}

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
            "retained_text_invalid",
            "retained_text_incomplete",
            "source_candidate_limit",
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
