import { internal } from "@convex/_generated/api";
import type { Doc, Id } from "@convex/_generated/dataModel";
import type {
    ActionCtx,
    MutationCtx,
    QueryCtx,
} from "@convex/_generated/server";
import {
    internalAction,
    internalMutation,
    internalQuery,
} from "@convex/_generated/server";
import { REQUEST_APPROVAL_FIXTURE_CAUSE } from "@convex/domain/conversationValidationContracts";
import { sha256Hex, stableStringify } from "@convex/domain/sourcePassages";
import { supportsResearchControl } from "@convex/domain/transitions";
import {
    retainedDeliveryBody,
    retainedReplyKey,
} from "@convex/integrations/agentStorage";
import {
    HISTORY_PAGE_SIZE,
    MAX_CONVERSATION_SCAN_BYTES,
    RETAINED_TEXT_INLINE_BYTES,
} from "@convex/resourcePolicy";
import {
    paginationOptsValidator,
    paginationResultValidator,
} from "convex/server";
import { v } from "convex/values";
import { validate } from "convex-helpers/validators";
import { getAgentDefinition } from "./agentCatalog";
import type {
    AgentProgressMission,
    AgentResult,
    AgentScope,
    AgentState,
    OperationOutcome,
    OperationPin,
} from "./agentDefinition";
import { executionError } from "./errors";
import {
    completeRetainedText,
    retainCompleteText,
    retainedTextFragment,
    retainedTextParts,
    stageRetainedText,
    textFragmentValidator,
    verifyRetainedText,
} from "./retainedText";

/** Stable persisted identity for a mission's objective across attempts and definition versions. */
export function missionObjectiveKey(
    scope: AgentScope,
    conversationTurnId?: Id<"agentConversationTurns">,
): string {
    const suffix = conversationTurnId ? `:${conversationTurnId}` : "";
    switch (scope.kind) {
        case "workbench_v1":
            return `workbench${suffix}`;
        case "conversation_validation_v1":
            return `conversation${suffix}`;
        case "sources_v1":
            return `sources:${scope.preparationId}${suffix}`;
        case "saved_material_inspection_v1":
            return `saved-material:${scope.corpusRevisionId}${suffix}`;
        case "execution_validation_v1":
            return `validation:${JSON.stringify(scope.values)}${suffix}`;
    }
}

/** Both retained success formats contribute to the same mission progress. */
export function operationProgressKeys(outcome: OperationOutcome): string[] {
    return outcome.kind === "success"
        ? [
              ...("progressKeys" in outcome
                  ? (outcome.progressKeys ?? [])
                  : []),
              ...("progressKey" in outcome && outcome.progressKey
                  ? [outcome.progressKey]
                  : []),
          ]
        : [];
}

/** Classifies generation failures without treating a transport uncertainty as safe to replay. */
export function generationInterruption(code: string | undefined) {
    return code === "invalid_output"
        ? ("invalid_response" as const)
        : code === "repetition_stop"
          ? ("repeated_failure" as const)
          : undefined;
}

/** Execution and generation interruptions retain their mission; a blocked executor is not a terminal business result. Resume still enforces receipt, authority and capacity checks. */
export function isRecoverableInterruption(
    mission: Doc<"agentMissions">,
    run: Doc<"researchRuns">,
) {
    return (
        mission.status === "blocked" &&
        (mission.blockCode === "execution_interrupted" ||
            mission.blockCode === "execution_time_limit" ||
            (generationInterruption(mission.blockCode) !== undefined &&
                (mission.executionScope === "conversation" ||
                    (run.startMode === "framed" &&
                        supportsResearchControl(run)))))
    );
}

/** Normalizes persisted v1 inspection fields without rewriting historical records. */
export function missionScope(mission: AgentProgressMission): AgentScope {
    return "protocolVersion" in mission
        ? mission.scope
        : {
              kind: "saved_material_inspection_v1",
              corpusRevisionId: mission.corpusRevisionId,
          };
}

export function missionState(mission: AgentProgressMission): AgentState {
    return "protocolVersion" in mission
        ? mission.state
        : {
              kind: "saved_material_inspection_v1",
              inspectedCaptureIds: mission.inspectedCaptureIds,
          };
}

/** Old missions keep their original representation; each value has one persisted owner. */
export function domainDataPatch(
    mission: Doc<"agentMissions">,
    update: { state?: AgentState; result?: AgentResult },
) {
    if ("protocolVersion" in mission) return update;
    if (
        (update.state &&
            update.state.kind !== "saved_material_inspection_v1") ||
        (update.result && update.result.kind !== "saved_material_inspection_v1")
    )
        throw executionError("definition_version_conflict");
    return {
        ...(update.state?.kind === "saved_material_inspection_v1"
            ? { inspectedCaptureIds: update.state.inspectedCaptureIds }
            : {}),
        ...(update.result?.kind === "saved_material_inspection_v1"
            ? { completionRefs: update.result.captureIds }
            : {}),
    };
}

/** Provider receipts keep their historical corpus correlation when that scope exists. */
export function invocationScopeFields(mission: Doc<"agentMissions">) {
    const scope = missionScope(mission);
    return "corpusRevisionId" in scope
        ? { corpusRevisionId: scope.corpusRevisionId }
        : {};
}

export function retainedOperationPin(
    request: Doc<"agentOperationRequests">,
): OperationPin {
    if (request.pin) return request.pin;
    return request.input.kind === "consult_mission_state"
        ? { kind: "mission_history" }
        : {
              kind: "saved_material_inspection_v1",
              ...(request.expectedCaptureId
                  ? { expectedCaptureId: request.expectedCaptureId }
                  : {}),
              ...(request.expectedContentHash
                  ? { expectedContentHash: request.expectedContentHash }
                  : {}),
          };
}

/** Preserve v1 hash inputs so pending work and confirmed results remain reusable. */
export function operationIdentityScope(
    mission: Doc<"agentMissions">,
    pin: OperationPin | undefined,
) {
    if ("protocolVersion" in mission)
        return { scope: mission.scope, pin: pin ?? {} };
    return {
        corpusRevisionId: mission.corpusRevisionId,
        pin:
            pin?.kind === "saved_material_inspection_v1"
                ? {
                      ...(pin.expectedCaptureId
                          ? { expectedCaptureId: pin.expectedCaptureId }
                          : {}),
                      ...(pin.expectedContentHash
                          ? { expectedContentHash: pin.expectedContentHash }
                          : {}),
                  }
                : {},
    };
}

/** Preserves historical operation identity; each operation selects its reuse dependencies. */
export function operationReuseIdentity(
    context: Parameters<
        import("./executionProtocol").AgentOperationDefinition["identity"]
    >[0],
) {
    const { mission, runId, version, input, pin } = context;
    return mission
        ? {
              objective: mission.objectiveKey,
              version,
              ...operationIdentityScope(mission, pin),
              input,
          }
        : { runId, version, pin, input };
}

export function textualMissionOutcomePatch(
    kind: "workbench_v1" | "conversation_validation_v1",
    textId: Id<"retainedTexts">,
    contentHash: string,
) {
    return {
        result: undefined,
        resultTextId: undefined,
        textualOutcome: { version: 1 as const, kind, textId, contentHash },
    };
}

/** Domain completion keeps its full result while mission metadata stays within document capacity. */
/** Returns a validated completion identity for bounded inspection and replay. */
export async function retainedTextualOutcome(
    ctx: QueryCtx,
    mission: Doc<"agentMissions">,
) {
    if (!("protocolVersion" in mission) || !mission.textualOutcome)
        return undefined;
    const outcome = mission.textualOutcome;
    const text = await completeRetainedText(ctx, outcome.textId);
    if (
        text.key !== textualOutcomeKey(mission) ||
        text.contentHash !== outcome.contentHash ||
        outcome.kind !== mission.definitionId
    )
        throw executionError("invocation_result_invalid");
    return text;
}

export async function missionResultPatch(
    ctx: MutationCtx,
    mission: Doc<"agentMissions">,
    result: AgentResult,
    publication?: Pick<
        Doc<"agentMessageDeliveries">,
        "bodyTextId" | "contentHash"
    >,
) {
    if (
        "protocolVersion" in mission &&
        publication?.bodyTextId &&
        (result.kind === "workbench_v1" ||
            result.kind === "conversation_validation_v1")
    )
        return textualMissionOutcomePatch(
            result.kind,
            publication.bodyTextId,
            publication.contentHash,
        );
    const json = JSON.stringify(result);
    if (
        !("protocolVersion" in mission) ||
        new TextEncoder().encode(json).length <= RETAINED_TEXT_INLINE_BYTES
    )
        return domainDataPatch(mission, { result });
    return {
        result: undefined,
        resultTextId: await retainCompleteText(
            ctx,
            `${mission._id}:result`,
            json,
        ),
    };
}

/** Resolves the retained JSON from the mission's historical result slot. */
export async function retainedLegacyMissionResult(
    ctx: QueryCtx,
    mission: Doc<"agentMissions">,
    textId: Id<"retainedTexts">,
) {
    const text = await completeRetainedText(ctx, textId);
    if (text.key !== `${mission._id}:result`)
        throw executionError("invocation_result_invalid");
    return text;
}

export function missionTextualResultKey(missionId: Id<"agentMissions">) {
    return `${missionId}:textual_outcome`;
}

/** A completed result either shares a published delivery or owns its own exact text. */
export function textualOutcomeKey(mission: Doc<"agentMissions">) {
    if (
        "protocolVersion" in mission &&
        mission.textualOutcome?.ownership === "mission"
    )
        return missionTextualResultKey(mission._id);
    if (mission.conversationTurnId)
        return retainedReplyKey(mission.conversationTurnId);
    throw executionError("invocation_result_invalid");
}

const textualMigrationScope = {
    runId: v.id("researchRuns"),
    missionId: v.id("agentMissions"),
};
const migrationTextualKind = v.union(
    v.literal("workbench_v1"),
    v.literal("conversation_validation_v1"),
);

/** Inventories historical completion records independently of delivery and component storage. */
/** Older browser approval fixtures published a delivery directly, with no mission result. */
async function historicalApprovalFixtureDelivery(
    ctx: QueryCtx,
    run: Doc<"researchRuns">,
    conversation: Doc<"agentConversations">,
    mission: Doc<"agentMissions">,
) {
    if (
        run.purpose !== "browser_test" ||
        mission.definitionId !== "workbench_v1" ||
        mission.provenance !== "simulation" ||
        mission.lastInvocationId ||
        mission.completionEventId ||
        !mission.conversationTurnId
    )
        return undefined;
    const turn = await ctx.db.get(mission.conversationTurnId);
    if (
        turn?.status !== "published" ||
        turn.missionId !== mission._id ||
        turn.runId !== run._id ||
        turn.conversationId !== conversation._id ||
        !turn.publishedMessageId
    )
        return undefined;
    const reply = await ctx.db.get(turn.publishedMessageId);
    if (
        reply?.role !== "assistant" ||
        reply.delivery !== "reply" ||
        reply.status !== "processed" ||
        reply.turnId !== turn._id ||
        reply.runId !== run._id ||
        reply.conversationId !== conversation._id
    )
        return undefined;
    const approval = await ctx.db
        .query("agentOperationRequests")
        .withIndex("by_mission_and_input_kind", (q) =>
            q.eq("missionId", mission._id).eq("input.kind", "request_approval"),
        )
        .filter((q) => q.eq(q.field("cause"), REQUEST_APPROVAL_FIXTURE_CAUSE))
        .first();
    if (
        approval?.runId !== run._id ||
        approval.status !== "completed" ||
        approval.input.kind !== "request_approval" ||
        approval.input.action !== "pause_research"
    )
        return undefined;
    return { deliveryId: reply._id, operationId: approval._id };
}

export const missionMigrationInventory = internalQuery({
    args: {
        runId: v.id("researchRuns"),
        paginationOpts: paginationOptsValidator,
    },
    returns: paginationResultValidator(
        v.object({
            missionId: v.id("agentMissions"),
            definitionVersion: v.number(),
            resultTextId: v.optional(v.id("retainedTexts")),
            textId: v.optional(v.id("retainedTexts")),
            retainedHash: v.optional(v.string()),
            deliveryOnly: v.optional(
                v.object({
                    deliveryId: v.id("agentMessageDeliveries"),
                    operationId: v.id("agentOperationRequests"),
                }),
            ),
            status: v.union(
                v.literal("other"),
                v.literal("inline"),
                v.literal("fragmented"),
                v.literal("copying"),
                v.literal("switched"),
                v.literal("retained"),
                v.literal("delivery_only"),
                v.literal("inconsistent"),
            ),
        }),
    ),
    handler: async (ctx, args) => {
        const run = await ctx.db.get(args.runId);
        const conversation = await ctx.db
            .query("agentConversations")
            .withIndex("by_run", (q) => q.eq("runId", args.runId))
            .unique();
        if (
            !run ||
            run.withdrawnAt !== undefined ||
            !conversation?.storageMigrationFrozen
        )
            throw executionError("conversation_migration_not_frozen");
        const page = await ctx.db
            .query("agentMissions")
            .withIndex("by_run_and_status", (q) =>
                q.eq("runId", args.runId).eq("status", "completed"),
            )
            .paginate({
                ...args.paginationOpts,
                numItems: Math.min(
                    args.paginationOpts.numItems,
                    HISTORY_PAGE_SIZE,
                ),
                maximumRowsRead: HISTORY_PAGE_SIZE,
                maximumBytesRead: MAX_CONVERSATION_SCAN_BYTES,
            });
        return {
            ...page,
            page: await Promise.all(
                page.page.map(async (mission) => {
                    const base = {
                        missionId: mission._id,
                        definitionVersion: mission.definitionVersion,
                    };
                    if (
                        mission.definitionId !== "workbench_v1" &&
                        mission.definitionId !== "conversation_validation_v1"
                    )
                        return { ...base, status: "other" as const };
                    if (!("protocolVersion" in mission))
                        return { ...base, status: "inconsistent" as const };
                    const inline = mission.result !== undefined;
                    const fragmented = mission.resultTextId !== undefined;
                    const outcome = mission.textualOutcome;
                    if (
                        !inline &&
                        !fragmented &&
                        !outcome &&
                        !mission.legacyTextualResultCopy
                    ) {
                        const deliveryOnly =
                            await historicalApprovalFixtureDelivery(
                                ctx,
                                run,
                                conversation,
                                mission,
                            );
                        if (deliveryOnly)
                            return {
                                ...base,
                                status: "delivery_only" as const,
                                deliveryOnly,
                            };
                    }
                    let status:
                        | "inline"
                        | "fragmented"
                        | "copying"
                        | "switched"
                        | "retained"
                        | "inconsistent";
                    if (
                        (inline && fragmented) ||
                        (outcome && outcome.kind !== mission.definitionId)
                    )
                        status = "inconsistent";
                    else if (outcome)
                        status = inline || fragmented ? "switched" : "retained";
                    else if (inline || fragmented)
                        status = mission.legacyTextualResultCopy
                            ? "copying"
                            : inline
                              ? "inline"
                              : "fragmented";
                    else status = "inconsistent";
                    const retained =
                        status === "switched" || status === "retained"
                            ? await retainedTextualOutcome(ctx, mission)
                            : undefined;
                    return {
                        ...base,
                        retainedHash: retained?.contentHash,
                        status,
                        resultTextId: mission.resultTextId,
                        textId:
                            outcome?.textId ??
                            mission.legacyTextualResultCopy?.textId,
                    };
                }),
            ),
        };
    },
});

async function legacyTextualSource(
    ctx: QueryCtx,
    args: { runId: Id<"researchRuns">; missionId: Id<"agentMissions"> },
) {
    const run = await ctx.db.get(args.runId);
    const mission = await ctx.db.get(args.missionId);
    if (
        !run ||
        run.withdrawnAt !== undefined ||
        mission?.runId !== run._id ||
        !("protocolVersion" in mission) ||
        mission.status !== "completed" ||
        (mission.definitionId !== "workbench_v1" &&
            mission.definitionId !== "conversation_validation_v1") ||
        (mission.result === undefined) === (mission.resultTextId === undefined)
    )
        throw executionError("mission_migration_source_unavailable");
    const conversation = await ctx.db
        .query("agentConversations")
        .withIndex("by_run", (q) => q.eq("runId", run._id))
        .unique();
    if (!conversation?.storageMigrationFrozen)
        throw executionError("conversation_migration_not_frozen");
    const turn = mission.conversationTurnId
        ? await ctx.db.get(mission.conversationTurnId)
        : null;
    if (
        mission.conversationTurnId &&
        (!turn ||
            turn.runId !== run._id ||
            turn.conversationId !== conversation._id ||
            turn.missionId !== mission._id)
    )
        throw executionError("mission_migration_source_unavailable");
    const delivery = turn?.publishedMessageId
        ? await ctx.db.get(turn.publishedMessageId)
        : null;
    if (
        turn?.publishedMessageId &&
        (!delivery ||
            delivery.turnId !== turn._id ||
            delivery.role !== "assistant" ||
            delivery.delivery !== "reply")
    )
        throw executionError("mission_migration_source_unavailable");
    const resultText = mission.resultTextId
        ? await retainedLegacyMissionResult(ctx, mission, mission.resultTextId)
        : undefined;
    const inline =
        mission.result === undefined
            ? undefined
            : JSON.stringify(mission.result);
    const sourceIdentity = sha256Hex(
        stableStringify({
            missionId: mission._id,
            runId: run._id,
            generation: mission.generation,
            status: mission.status,
            definitionId: mission.definitionId,
            definitionVersion: mission.definitionVersion,
            turnId: turn?._id,
            deliveryId: delivery?._id,
            resultTextId: resultText?._id,
            resultHash: resultText?.contentHash ?? sha256Hex(inline ?? ""),
        }),
    );
    return {
        mission,
        delivery,
        resultText,
        inline,
        sourceIdentity,
        kind: mission.definitionId,
    };
}

/** Binds the preflight inventory to the frozen original result without reading its fragments. */
export const legacyMissionSourceIdentity = internalQuery({
    args: textualMigrationScope,
    returns: v.string(),
    handler: async (ctx, args) =>
        (await legacyTextualSource(ctx, args)).sourceIdentity,
});

export const legacyMissionResultFragment = internalQuery({
    args: {
        ...textualMigrationScope,
        index: v.number(),
        deliveryBody: v.optional(v.literal(true)),
        switchedTextId: v.optional(v.id("retainedTexts")),
        sourceIdentity: v.optional(v.string()),
    },
    returns: v.object({
        sourceIdentity: v.string(),
        kind: migrationTextualKind,
        definitionVersion: v.number(),
        content: v.string(),
        fragmentCount: v.number(),
        contentHash: v.string(),
        sizeBytes: v.number(),
        characters: v.number(),
        hasDelivery: v.boolean(),
        textId: v.optional(v.id("retainedTexts")),
    }),
    handler: async (ctx, args) => {
        const source = await legacyTextualSource(ctx, args);
        if (
            args.sourceIdentity !== undefined &&
            args.sourceIdentity !== source.sourceIdentity
        )
            throw executionError("mission_migration_source_changed");
        const text = args.switchedTextId
            ? await retainedTextualOutcome(ctx, source.mission)
            : args.deliveryBody && source.delivery
              ? await retainedDeliveryBody(ctx, source.delivery)
              : source.resultText;
        if (args.deliveryBody && !source.delivery)
            throw executionError("mission_migration_source_changed");
        if (args.switchedTextId && text?._id !== args.switchedTextId)
            throw executionError("mission_migration_body_mismatch");
        if (!text && args.index !== 0)
            throw executionError("retained_text_range");
        const inline = source.inline ?? "";
        return {
            sourceIdentity: source.sourceIdentity,
            kind: source.kind,
            definitionVersion: source.mission.definitionVersion,
            content: text
                ? await retainedTextFragment(ctx, text, args.index)
                : inline,
            fragmentCount: text?.fragmentHashes.length ?? 1,
            contentHash: text?.contentHash ?? sha256Hex(inline),
            sizeBytes:
                text?.sizeBytes ?? new TextEncoder().encode(inline).length,
            characters: text?.characters ?? inline.length,
            hasDelivery: source.delivery !== null,
            textId: text?._id,
        };
    },
});

export const stageLegacyMissionText = internalMutation({
    args: {
        ...textualMigrationScope,
        sourceIdentity: v.string(),
        fragment: textFragmentValidator,
    },
    returns: v.id("retainedTexts"),
    handler: async (ctx, args) => {
        const { mission, delivery, sourceIdentity } = await legacyTextualSource(
            ctx,
            args,
        );
        if (
            sourceIdentity !== args.sourceIdentity ||
            delivery ||
            (mission.legacyTextualResultCopy &&
                mission.legacyTextualResultCopy.sourceIdentity !==
                    sourceIdentity)
        )
            throw executionError("mission_migration_source_changed");
        const textId = await stageRetainedText(
            ctx,
            missionTextualResultKey(mission._id),
            args.fragment,
        );
        if (
            mission.legacyTextualResultCopy &&
            mission.legacyTextualResultCopy.textId !== textId
        )
            throw executionError("mission_migration_source_changed");
        if (!mission.legacyTextualResultCopy)
            await ctx.db.patch(mission._id, {
                legacyTextualResultCopy: { sourceIdentity, textId },
            });
        return textId;
    },
});

export const switchLegacyMissionResult = internalMutation({
    args: {
        ...textualMigrationScope,
        sourceIdentity: v.string(),
        bodyHash: v.string(),
        textId: v.id("retainedTexts"),
    },
    returns: v.id("retainedTexts"),
    handler: async (ctx, args) => {
        const { mission, delivery, sourceIdentity, kind } =
            await legacyTextualSource(ctx, args);
        if (sourceIdentity !== args.sourceIdentity)
            throw executionError("mission_migration_source_changed");
        const copy = mission.legacyTextualResultCopy;
        const text = delivery
            ? await retainedDeliveryBody(ctx, delivery)
            : copy?.sourceIdentity === sourceIdentity
              ? await completeRetainedText(ctx, copy.textId)
              : undefined;
        if (
            !text ||
            text._id !== args.textId ||
            text.contentHash !== args.bodyHash ||
            text.key !==
                (delivery && mission.conversationTurnId
                    ? retainedReplyKey(mission.conversationTurnId)
                    : missionTextualResultKey(mission._id))
        )
            throw executionError("mission_migration_body_mismatch");
        if (mission.textualOutcome) {
            if (
                mission.textualOutcome.textId !== text._id ||
                mission.textualOutcome.contentHash !== text.contentHash ||
                mission.textualOutcome.kind !== kind
            )
                throw executionError("mission_migration_body_mismatch");
            return text._id;
        }
        await ctx.db.patch(mission._id, {
            textualOutcome: {
                version: 1,
                kind,
                textId: text._id,
                contentHash: text.contentHash,
                ...(!delivery ? { ownership: "mission" as const } : {}),
            },
        });
        return text._id;
    },
});

async function readLegacyMissionText(
    ctx: ActionCtx,
    args: {
        runId: Id<"researchRuns">;
        missionId: Id<"agentMissions">;
        sourceIdentity?: string;
        switchedTextId?: Id<"retainedTexts">;
        deliveryBody?: true;
    },
) {
    const read = internal.execution.missionData.legacyMissionResultFragment;
    const first = await ctx.runQuery(read, { ...args, index: 0 });
    const fragments = [first.content];
    for (let index = 1; index < first.fragmentCount; index++) {
        const fragment = await ctx.runQuery(read, {
            ...args,
            sourceIdentity: first.sourceIdentity,
            index,
        });
        if (
            fragment.textId !== first.textId ||
            fragment.contentHash !== first.contentHash
        )
            throw executionError("mission_migration_source_changed");
        fragments.push(fragment.content);
    }
    return { first, content: verifyRetainedText(first, fragments.join("")) };
}

/** Renders historical prose using the pinned result contract without replaying effects. */
export function renderLegacyTextualResult(
    persisted: string,
    kind: Doc<"agentMissions">["definitionId"],
    definitionVersion: number,
) {
    const result: unknown = JSON.parse(persisted);
    const definition = getAgentDefinition(kind, definitionVersion);
    if (
        !validate(definition.resultValidator, result) ||
        result.kind !== kind ||
        !definition.conversationReply
    )
        throw executionError("invalid_completion");
    return definition.conversationReply(result);
}

async function legacyMissionReply(
    ctx: ActionCtx,
    args: { runId: Id<"researchRuns">; missionId: Id<"agentMissions"> },
) {
    const { first, content: persisted } = await readLegacyMissionText(
        ctx,
        args,
    );
    const scope = { ...args, sourceIdentity: first.sourceIdentity };
    const body = renderLegacyTextualResult(
        persisted,
        first.kind,
        first.definitionVersion,
    );
    if (!body.trim()) throw executionError("invalid_completion");
    return { first, scope, body };
}

/** Compares the switched outcome to the historical result without writing either copy. */
export const verifySwitchedMissionResult = internalAction({
    args: {
        ...textualMigrationScope,
        textId: v.id("retainedTexts"),
        contentHash: v.string(),
    },
    returns: v.string(),
    handler: async (ctx, { textId, contentHash, ...args }): Promise<string> => {
        const { scope, body } = await legacyMissionReply(ctx, args);
        const { first, content: retained } = await readLegacyMissionText(ctx, {
            ...scope,
            switchedTextId: textId,
        });
        if (retained !== body || first.contentHash !== contentHash)
            throw executionError("mission_migration_body_mismatch");
        return scope.sourceIdentity;
    },
});

/** Decodes the historical result off-transaction, then adopts only its exact rendered identity. */
export const migrateLegacyMissionResult = internalAction({
    args: textualMigrationScope,
    returns: v.id("retainedTexts"),
    handler: async (ctx, args): Promise<Id<"retainedTexts">> => {
        const { first, scope, body } = await legacyMissionReply(ctx, args);
        let textId: Id<"retainedTexts"> | undefined;
        if (first.hasDelivery) {
            const received = await readLegacyMissionText(ctx, {
                ...scope,
                deliveryBody: true,
            });
            if (received.content !== body)
                throw executionError("mission_migration_body_mismatch");
            textId = received.first.textId;
        } else {
            const { parts, manifest } = retainedTextParts(body);
            for (const [index, content] of parts.entries())
                textId = await ctx.runMutation(
                    internal.execution.missionData.stageLegacyMissionText,
                    {
                        ...scope,
                        fragment: { ...manifest, index, content },
                    },
                );
        }
        if (!textId) throw executionError("mission_migration_body_mismatch");
        return ctx.runMutation(
            internal.execution.missionData.switchLegacyMissionResult,
            {
                ...scope,
                bodyHash: sha256Hex(body),
                textId,
            },
        );
    },
});
