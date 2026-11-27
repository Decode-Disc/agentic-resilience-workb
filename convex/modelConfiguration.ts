import {
    DEFAULT_RESPONSE_CONTROL_POLICY,
    responseControlConfiguration,
    responseControlPolicy,
    validResponseControlConfiguration,
} from "@convex/domain/workbenchResponseControlContracts";
import {
    MODEL_MAX_INPUT_PRICE_PER_MILLION,
    MODEL_MAX_OUTPUT_PRICE_PER_MILLION,
    NATIVE_PROFILE_BATCH_SIZE,
    PERSISTENCE_PAGE_SIZE,
} from "@convex/resourcePolicy";
import { type Infer, v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import {
    internalMutation,
    internalQuery,
    type MutationCtx,
    mutation,
    type QueryCtx,
    query,
} from "./_generated/server";
import { requireAdmin } from "./administrationAuthority";
import { sha256Hex, stableStringify } from "./domain/sourcePassages";
import { assertPreparationExecutionFence } from "./domain/sourcePreparationAuthority";
import { requireDossierAuthority } from "./execution/authority";
import { executionError, executionFailureCode } from "./execution/errors";
import {
    modelConfigurationKey,
    NATIVE_MODEL_SERIALIZER,
    NATIVE_PROFILE_CATALOG,
    reasoningChoices,
    recommendedReasoningEffort,
    resolveReasoningPreference,
} from "./integrations/modelRouting";
import {
    effectiveModelConfiguration,
    modelAgent,
    modelDescriptor,
    modelPreparationInput,
    nativeProfile,
    reasoningEffort,
    reasoningPreference,
} from "./modelConfigurationSchema";
import schema from "./schema";

export const MODEL_AGENTS: Record<
    Infer<typeof modelAgent>,
    { label: string; implemented: boolean }
> = {
    workbench: { label: "Workbench", implemented: true },
    sources: {
        label: "Sources · documentary preparation",
        implemented: true,
    },
    investigation: { label: "Investigation", implemented: false },
    synthesis: { label: "Synthesis", implemented: false },
    saved_material_inspection: {
        label: "Saved material inspection",
        implemented: true,
    },
};
const preparationResult = v.object({
    catalogId: v.id("modelCatalog"),
    revision: v.number(),
    ready: v.boolean(),
});
const claimedPreparationResult = preparationResult.extend({
    claimed: v.boolean(),
});
const modelView = schema.doc("modelCatalog");
function requireAgentCompatibility(
    agent: Infer<typeof modelAgent>,
    revision: Doc<"modelRevisions"> | null,
) {
    if (!revision) throw executionError("model_unavailable");
    if (agent !== "workbench" && !revision.descriptor.structuredOutputs)
        throw executionError("model_not_compatible");
    return revision;
}
const preparedModelView = v.object({
    ...schema.tables.modelCatalog.validator.fields,
    _id: v.id("modelCatalog"),
    _creationTime: v.number(),
    compatible: v.boolean(),
    reasoning: v.object({
        preference: v.union(reasoningPreference, v.null()),
        recommended: v.union(reasoningEffort, v.null()),
        effective: v.union(reasoningEffort, v.null()),
        choices: v.array(reasoningEffort),
    }),
});
export function modelPrepared(model: Doc<"modelCatalog">) {
    return (
        model.status === "ready" &&
        model.preparedSerializer === NATIVE_MODEL_SERIALIZER &&
        model.preparedProfileCatalog === NATIVE_PROFILE_CATALOG
    );
}

export const list = query({
    args: {},
    returns: v.object({
        responseControl: responseControlPolicy,
        models: v.array(preparedModelView),
        assignments: v.array(schema.doc("agentModelSettings")),
        agents: v.array(
            v.object({
                agent: modelAgent,
                label: v.string(),
                implemented: v.boolean(),
            }),
        ),
    }),
    handler: async (ctx) => {
        await requireAdmin(ctx);
        return {
            responseControl: await readResponseControlPolicy(ctx),
            models: await Promise.all(
                (await ctx.db.query("modelCatalog").take(101)).map(
                    async (model) => {
                        const revision = model.currentRevisionId
                            ? await ctx.db.get(model.currentRevisionId)
                            : null;
                        return {
                            ...model,
                            compatible: modelPrepared(model),
                            reasoning: {
                                preference:
                                    revision?.reasoningPreference ??
                                    revision?.reasoningEffort ??
                                    null,
                                effective: revision?.reasoningEffort ?? null,
                                recommended: revision
                                    ? (recommendedReasoningEffort(
                                          revision.descriptor,
                                      ) ?? null)
                                    : null,
                                choices: revision
                                    ? reasoningChoices(revision.descriptor)
                                    : [],
                            },
                        };
                    },
                ),
            ),
            assignments: await ctx.db
                .query("agentModelSettings")
                .withIndex("by_agent")
                .take(10),
            agents: Object.entries(MODEL_AGENTS).map(([agent, info]) => ({
                agent: agent as Infer<typeof modelAgent>,
                ...info,
            })),
        };
    },
});
export const authorize = internalQuery({
    args: {},
    returns: v.null(),
    handler: async (ctx) => {
        await requireAdmin(ctx);
        return null;
    },
});
export const findCatalog = internalQuery({
    args: { model: v.string(), provider: v.optional(v.string()) },
    returns: v.union(modelView, v.null()),
    handler: async (ctx, args) => {
        await requireAdmin(ctx);
        const models = await ctx.db
            .query("modelCatalog")
            .withIndex("by_model_and_provider", (q) =>
                q.eq("model", args.model),
            )
            .take(101);
        return (
            models.find((model) => model.provider === args.provider) ??
            (args.provider === undefined ? (models[0] ?? null) : null)
        );
    },
});

export const initializePrepared = internalMutation({
    args: { catalogId: v.id("modelCatalog"), primary: v.boolean() },
    returns: v.null(),
    handler: async (ctx, args) => {
        const admin = await requireAdmin(ctx);
        const model = await ctx.db.get(args.catalogId);
        if (!model || !modelPrepared(model) || !model.currentRevisionId)
            throw executionError("model_unavailable");
        if (args.primary)
            requireAgentCompatibility(
                "sources",
                await ctx.db.get(model.currentRevisionId),
            );
        if (!model.defaultsInitialized) {
            if (args.primary) {
                const conversations = await ctx.db
                    .query("agentConversations")
                    .take(501);
                if (conversations.length > 500)
                    throw executionError("model_initialization_capacity");
                for (const conversation of conversations)
                    if (
                        conversation.definitionId === "workbench_v1" &&
                        !conversation.modelCatalogId
                    )
                        await ctx.db.patch(conversation._id, {
                            modelCatalogId: model._id,
                        });
            }
            await ctx.db.patch(model._id, {
                defaultsInitialized: true,
                ...(!model.lastUpdateKey
                    ? {
                          enabled: true,
                          workbenchSelectable: true,
                          revision: model.revision + 1,
                      }
                    : {}),
            });
            await ctx.db.insert("auditEvents", {
                actor: { type: "visitor", visitorId: admin._id },
                action: "model_configuration_changed",
                targetType: "model_catalog",
                targetId: model._id,
                reason: "Initial model settings established without replacing saved selections.",
                occurredAt: Date.now(),
            });
        }
        if (args.primary && (!model.lastUpdateKey || model.enabled))
            for (const agent of Object.keys(MODEL_AGENTS) as Infer<
                typeof modelAgent
            >[]) {
                const existing = await ctx.db
                    .query("agentModelSettings")
                    .withIndex("by_agent", (q) => q.eq("agent", agent))
                    .unique();
                if (!existing)
                    await ctx.db.insert("agentModelSettings", {
                        agent,
                        catalogId: model._id,
                        revision: 1,
                        requestKey: `initial:${agent}`,
                        requestHash: sha256Hex(model._id),
                        updatedAt: Date.now(),
                    });
            }
        return null;
    },
});

export const beginPreparation = internalMutation({
    args: modelPreparationInput.fields,
    returns: claimedPreparationResult,
    handler: async (ctx, args) => {
        await requireAdmin(ctx);
        if (
            !/^[\w.-]+\/[\w.:-]+$/.test(args.model) ||
            args.model.length > 200 ||
            (args.provider !== undefined &&
                (!/^[\w./-]+$/.test(args.provider) ||
                    args.provider.length > 100)) ||
            !args.label.trim() ||
            args.label.length > 100 ||
            !args.requestKey ||
            args.requestKey.length > 200
        )
            throw executionError("invalid_model_configuration");
        const hash = sha256Hex(stableStringify(args));
        const previous = await ctx.db
            .query("modelCatalog")
            .withIndex("by_preparation_key", (q) =>
                q.eq("preparationKey", args.requestKey),
            )
            .unique();
        if (previous) {
            if (previous.preparationHash !== hash)
                throw executionError("model_configuration_conflict");
            return {
                catalogId: previous._id,
                revision: previous.revision,
                ready: modelPrepared(previous),
                claimed: false,
            };
        }
        const current = args.catalogId
            ? await ctx.db.get(args.catalogId)
            : await ctx.db
                  .query("modelCatalog")
                  .withIndex("by_model_and_provider", (q) =>
                      q.eq("model", args.model).eq("provider", args.provider),
                  )
                  .unique();
        if (args.catalogId && (!current || current.model !== args.model))
            throw executionError("model_configuration_conflict");
        if (current && args.expectedRevision !== current.revision)
            throw executionError("model_configuration_conflict");
        if (
            !current &&
            (await ctx.db.query("modelCatalog").take(100)).length >= 100
        )
            throw executionError("model_catalog_capacity");
        const fields = {
            model: args.model,
            provider: args.provider,
            label: args.label.trim(),
            revision: (current?.revision ?? 0) + 1,
            status: "preparing" as const,
            enabled: false,
            workbenchSelectable: false,
            preparationKey: args.requestKey,
            preparationHash: hash,
            updatedAt: Date.now(),
        };
        if (current) {
            await ctx.db.patch(current._id, { ...fields, failure: undefined });
            return {
                catalogId: current._id,
                revision: fields.revision,
                ready: false,
                claimed: true,
            };
        }
        return {
            catalogId: await ctx.db.insert("modelCatalog", fields),
            revision: fields.revision,
            ready: false,
            claimed: true,
        };
    },
});

/** Profile rows are additive and shared by immutable model revisions. */
async function retainNativeProfiles(
    ctx: MutationCtx,
    profiles: Infer<typeof nativeProfile>[],
) {
    if (!profiles.length || profiles.length > NATIVE_PROFILE_BATCH_SIZE)
        throw executionError("model_not_compatible");
    for (const profile of profiles) {
        if (
            !profile.key ||
            !Number.isSafeInteger(profile.bytes) ||
            profile.bytes < 1 ||
            profile.bytes > 1000000 ||
            (profile.effectiveMaxOutputTokens !== undefined &&
                (!Number.isSafeInteger(profile.effectiveMaxOutputTokens) ||
                    profile.effectiveMaxOutputTokens < 1))
        )
            throw executionError("model_not_compatible");
        const old = await ctx.db
            .query("nativeInputProfiles")
            .withIndex("by_key", (q) => q.eq("key", profile.key))
            .unique();
        if (old) {
            if (
                old.bytes !== profile.bytes ||
                (old.effectiveMaxOutputTokens !== undefined &&
                    profile.effectiveMaxOutputTokens !== undefined &&
                    old.effectiveMaxOutputTokens !==
                        profile.effectiveMaxOutputTokens)
            )
                throw executionError("model_profile_conflict");
            if (
                old.effectiveMaxOutputTokens === undefined &&
                profile.effectiveMaxOutputTokens !== undefined
            )
                await ctx.db.patch(old._id, {
                    effectiveMaxOutputTokens: profile.effectiveMaxOutputTokens,
                });
        } else await ctx.db.insert("nativeInputProfiles", profile);
    }
}

/** Revisions with identical route, descriptor and covered effort produce identical nativeInputProfiles keys. */
function revisionCalibrationSignature(revision: Doc<"modelRevisions">): string {
    const covered = new Set([
        recommendedReasoningEffort(revision.descriptor),
        ...reasoningChoices(revision.descriptor),
    ]);
    const extraEffort =
        revision.reasoningEffort !== undefined &&
        !covered.has(revision.reasoningEffort)
            ? revision.reasoningEffort
            : null;
    return sha256Hex(
        stableStringify({
            model: revision.model,
            provider: revision.provider ?? null,
            profileKey: modelConfigurationKey(revision.descriptor),
            extraEffort,
        }),
    );
}

function parseRevisionCursor(cursor: string | null | undefined): number | null {
    if (cursor === undefined || cursor === null) return null;
    const match = /^rev:(-?\d+)$/.exec(cursor);
    if (!match) throw executionError("invalid_model_configuration");
    const value = Number(match[1]);
    if (!Number.isSafeInteger(value))
        throw executionError("invalid_model_configuration");
    return value;
}

/** Bounded offline refresh yields one distinct calibration revision per page, skipping contiguous identical descriptors. */
export const profileRevisions = internalQuery({
    args: {
        catalogId: v.id("modelCatalog"),
        cursor: v.optional(v.union(v.string(), v.null())),
    },
    returns: v.object({
        page: v.array(schema.doc("modelRevisions")),
        isDone: v.boolean(),
        continueCursor: v.union(v.string(), v.null()),
        currentRevisionId: v.union(v.id("modelRevisions"), v.null()),
        catalogPrepared: v.boolean(),
    }),
    handler: async (ctx, args) => {
        await requireAdmin(ctx);
        const catalog = await ctx.db.get(args.catalogId);
        if (!catalog) throw executionError("model_unavailable");
        const beforeRevision = parseRevisionCursor(args.cursor);
        const scanLimit = PERSISTENCE_PAGE_SIZE.modelRevisionRefreshScan;
        const rows = await ctx.db
            .query("modelRevisions")
            .withIndex("by_catalog_and_revision", (q) =>
                beforeRevision === null
                    ? q.eq("catalogId", args.catalogId)
                    : q
                          .eq("catalogId", args.catalogId)
                          .lt("revision", beforeRevision),
            )
            .order("desc")
            .take(scanLimit + 1);
        const target = rows[0];
        if (!target)
            return {
                page: [],
                isDone: true,
                continueCursor: null,
                currentRevisionId: catalog.currentRevisionId ?? null,
                catalogPrepared: modelPrepared(catalog),
            };
        const targetSignature = revisionCalibrationSignature(target);
        let nextRevision: number | null = null;
        for (let i = 1; i < Math.min(rows.length, scanLimit); i++) {
            const candidate = rows[i];
            if (
                candidate &&
                revisionCalibrationSignature(candidate) !== targetSignature
            ) {
                nextRevision = candidate.revision;
                break;
            }
        }
        if (nextRevision === null && rows.length > scanLimit)
            nextRevision = rows[scanLimit]?.revision ?? null;
        return {
            page: [target],
            isDone: nextRevision === null,
            continueCursor:
                nextRevision === null ? null : `rev:${nextRevision + 1}`,
            currentRevisionId: catalog.currentRevisionId ?? null,
            catalogPrepared: modelPrepared(catalog),
        };
    },
});

/** Exact profile keys include route, descriptor, tools and installed serializer identity. */
export const profiles = internalQuery({
    args: { keys: v.array(v.string()) },
    returns: v.array(nativeProfile),
    handler: async (ctx, args) => {
        await requireAdmin(ctx);
        if (args.keys.length > NATIVE_PROFILE_BATCH_SIZE)
            throw executionError("model_not_compatible");
        const rows = await Promise.all(
            args.keys.map((key) =>
                ctx.db
                    .query("nativeInputProfiles")
                    .withIndex("by_key", (q) => q.eq("key", key))
                    .unique(),
            ),
        );
        return rows.flatMap((row) =>
            row
                ? [
                      {
                          key: row.key,
                          bytes: row.bytes,
                          effectiveMaxOutputTokens:
                              row.effectiveMaxOutputTokens,
                      },
                  ]
                : [],
        );
    },
});
export const retainNativeProfileBatch = internalMutation({
    args: { profileCatalog: v.string(), profiles: v.array(nativeProfile) },
    returns: v.null(),
    handler: async (ctx, args) => {
        await requireAdmin(ctx);
        if (args.profileCatalog !== NATIVE_PROFILE_CATALOG)
            throw executionError("model_profile_version_conflict");
        await retainNativeProfiles(ctx, args.profiles);
        return null;
    },
});
export const retainRefreshedProfiles = internalMutation({
    args: {
        revisionId: v.id("modelRevisions"),
        profileCatalog: v.string(),
        profiles: v.array(nativeProfile),
    },
    returns: v.null(),
    handler: async (ctx, args) => {
        await requireAdmin(ctx);
        if (args.profileCatalog !== NATIVE_PROFILE_CATALOG)
            throw executionError("model_profile_version_conflict");
        const revision = await ctx.db.get(args.revisionId);
        const catalog = revision ? await ctx.db.get(revision.catalogId) : null;
        if (!revision || !catalog) throw executionError("model_unavailable");
        if (args.profiles.length > 0)
            await retainNativeProfiles(ctx, args.profiles);
        if (
            catalog.currentRevisionId === revision._id &&
            catalog.status === "ready"
        )
            await ctx.db.patch(catalog._id, {
                preparedSerializer: NATIVE_MODEL_SERIALIZER,
                preparedProfileCatalog: NATIVE_PROFILE_CATALOG,
            });
        return null;
    },
});

export const finishPreparation = internalMutation({
    args: {
        catalogId: v.id("modelCatalog"),
        revision: v.number(),
        descriptor: modelDescriptor,
        profiles: v.array(nativeProfile),
        profileCatalog: v.string(),
    },
    returns: preparationResult,
    handler: async (ctx, args) => {
        const admin = await requireAdmin(ctx);
        if (args.profileCatalog !== NATIVE_PROFILE_CATALOG)
            throw executionError("model_profile_version_conflict");
        const current = await ctx.db.get(args.catalogId);
        const preparationHash = sha256Hex(
            stableStringify({
                descriptor: args.descriptor,
                profiles: args.profiles,
            }),
        );
        if (
            current?.revision === args.revision &&
            current.status === "ready" &&
            current.currentRevisionId
        ) {
            const saved = await ctx.db.get(current.currentRevisionId);
            if (saved?.preparationHash !== preparationHash)
                throw executionError("model_configuration_conflict");
            return {
                catalogId: current._id,
                revision: current.revision,
                ready: true,
            };
        }
        if (
            !current ||
            current.revision !== args.revision ||
            current.status !== "preparing"
        )
            throw executionError("model_configuration_conflict");
        const d = args.descriptor;
        if (
            !Number.isSafeInteger(d.contextWindow) ||
            d.contextWindow < 32768 ||
            !Number.isSafeInteger(d.maxTokens) ||
            d.maxTokens < 1 ||
            [d.inputPrice, d.outputPrice, d.cacheReadPrice].some(
                (p) => !Number.isFinite(p) || p < 0,
            ) ||
            d.inputPrice > MODEL_MAX_INPUT_PRICE_PER_MILLION ||
            d.outputPrice > MODEL_MAX_OUTPUT_PRICE_PER_MILLION
        )
            throw executionError("model_not_compatible");
        await retainNativeProfiles(ctx, args.profiles);
        const previous = current.currentRevisionId
            ? await ctx.db.get(current.currentRevisionId)
            : null;
        const preference = previous
            ? previous.reasoningPreference
            : "recommended";
        const effort =
            preference === undefined
                ? previous?.reasoningEffort
                : resolveReasoningPreference(d, preference);
        if (
            effort &&
            (!d.reasoning ||
                !d.reasoningEfforts?.includes(effort) ||
                (effort === "none" && d.reasoningMandatory))
        )
            throw executionError("model_effort_unavailable");
        const revisionId = await ctx.db.insert("modelRevisions", {
            catalogId: current._id,
            revision: current.revision,
            model: current.model,
            provider: current.provider,
            descriptor: d,
            preparationHash,
            reasoningPreference: preference,
            reasoningEffort: effort,
            createdAt: Date.now(),
        });
        await ctx.db.patch(current._id, {
            status: "ready",
            currentRevisionId: revisionId,
            failure: undefined,
            preparedSerializer: NATIVE_MODEL_SERIALIZER,
            preparedProfileCatalog: NATIVE_PROFILE_CATALOG,
        });
        await ctx.db.insert("auditEvents", {
            actor: { type: "visitor", visitorId: admin._id },
            action: "model_configuration_changed",
            targetType: "model_catalog",
            targetId: current._id,
            reason: "Model preparation completed without inference.",
            occurredAt: Date.now(),
        });
        return {
            catalogId: current._id,
            revision: current.revision,
            ready: true,
        };
    },
});
export const failPreparation = internalMutation({
    args: {
        catalogId: v.id("modelCatalog"),
        revision: v.number(),
        failure: v.string(),
    },
    returns: v.null(),
    handler: async (ctx, args) => {
        await requireAdmin(ctx);
        const current = await ctx.db.get(args.catalogId);
        if (
            current?.revision === args.revision &&
            current.status === "preparing"
        )
            await ctx.db.patch(current._id, {
                status: "failed",
                failure: args.failure.slice(0, 100),
            });
        return null;
    },
});

export const updateAvailability = mutation({
    args: {
        catalogId: v.id("modelCatalog"),
        expectedRevision: v.number(),
        enabled: v.boolean(),
        workbenchSelectable: v.boolean(),
        requestKey: v.string(),
    },
    returns: v.object({ revision: v.number() }),
    handler: async (ctx, args) => {
        const admin = await requireAdmin(ctx);
        const row = await ctx.db.get(args.catalogId);
        const hash = sha256Hex(stableStringify(args));
        if (row?.lastUpdateKey === args.requestKey) {
            if (row.lastUpdateHash !== hash)
                throw executionError("model_configuration_conflict");
            return { revision: row.revision };
        }
        if (!row || row.revision !== args.expectedRevision)
            throw executionError("model_configuration_conflict");
        if (row.status === "preparing")
            throw executionError("model_preparation_pending");
        if (args.enabled && (!modelPrepared(row) || !row.currentRevisionId))
            throw executionError("model_not_compatible");
        if (!args.requestKey || args.requestKey.length > 200)
            throw executionError("invalid_model_configuration");
        await ctx.db.patch(row._id, {
            enabled: args.enabled,
            workbenchSelectable: args.workbenchSelectable,
            revision: row.revision + 1,
            lastUpdateKey: args.requestKey,
            lastUpdateHash: hash,
            updatedAt: Date.now(),
        });
        await ctx.db.insert("auditEvents", {
            actor: { type: "visitor", visitorId: admin._id },
            action: "model_configuration_changed",
            targetType: "model_catalog",
            targetId: row._id,
            reason: args.enabled ? "Model enabled." : "Model disabled.",
            occurredAt: Date.now(),
        });
        return { revision: row.revision + 1 };
    },
});
/** A preference change creates a new default revision; engaged missions retain their pins. */
export const setReasoningPreference = mutation({
    args: {
        catalogId: v.id("modelCatalog"),
        expectedRevision: v.number(),
        requestKey: v.string(),
        preference: reasoningPreference,
    },
    returns: v.object({ revision: v.number() }),
    handler: async (ctx, args) => {
        const admin = await requireAdmin(ctx);
        const catalog = await ctx.db.get(args.catalogId);
        const hash = sha256Hex(stableStringify(args));
        if (catalog?.lastUpdateKey === args.requestKey) {
            if (catalog.lastUpdateHash !== hash)
                throw executionError("model_configuration_conflict");
            return { revision: catalog.revision };
        }
        if (
            !catalog ||
            catalog.revision !== args.expectedRevision ||
            !catalog.currentRevisionId
        )
            throw executionError("model_configuration_conflict");
        if (catalog.status === "preparing")
            throw executionError("model_preparation_pending");
        if (!args.requestKey || args.requestKey.length > 200)
            throw executionError("invalid_model_configuration");
        const current = await ctx.db.get(catalog.currentRevisionId);
        if (!current) throw executionError("model_unavailable");
        const effort = resolveReasoningPreference(
            current.descriptor,
            args.preference,
        );
        requireReasoningEffort(current, effort);
        const { _id, _creationTime, ...configuration } = current;
        const revision = catalog.revision + 1;
        const revisionId = await ctx.db.insert("modelRevisions", {
            ...configuration,
            revision,
            reasoningPreference: args.preference,
            reasoningEffort: effort,
            createdAt: Date.now(),
        });
        await ctx.db.patch(catalog._id, {
            revision,
            currentRevisionId: revisionId,
            lastUpdateKey: args.requestKey,
            lastUpdateHash: hash,
            updatedAt: Date.now(),
        });
        await ctx.db.insert("auditEvents", {
            actor: { type: "visitor", visitorId: admin._id },
            action: "model_configuration_changed",
            targetType: "model_catalog",
            targetId: catalog._id,
            reason: "Reasoning preference changed; existing mission pins preserved.",
            occurredAt: Date.now(),
        });
        return { revision };
    },
});
export const assign = mutation({
    args: {
        agent: modelAgent,
        catalogId: v.id("modelCatalog"),
        expectedRevision: v.number(),
        requestKey: v.string(),
    },
    returns: v.object({ revision: v.number() }),
    handler: async (ctx, args) => {
        const admin = await requireAdmin(ctx);
        const current = await ctx.db
            .query("agentModelSettings")
            .withIndex("by_agent", (q) => q.eq("agent", args.agent))
            .unique();
        const hash = sha256Hex(stableStringify(args));
        if (current?.requestKey === args.requestKey) {
            if (current.requestHash !== hash)
                throw executionError("model_configuration_conflict");
            return { revision: current.revision };
        }
        if (
            (current?.revision ?? 0) !== args.expectedRevision ||
            !args.requestKey ||
            args.requestKey.length > 200
        )
            throw executionError("model_configuration_conflict");
        const model = await ctx.db.get(args.catalogId);
        if (
            !model?.enabled ||
            !modelPrepared(model) ||
            !model.currentRevisionId ||
            (args.agent === "workbench" && !model.workbenchSelectable)
        )
            throw executionError("model_unavailable");
        requireAgentCompatibility(
            args.agent,
            await ctx.db.get(model.currentRevisionId),
        );
        const data = {
            agent: args.agent,
            catalogId: args.catalogId,
            revision: args.expectedRevision + 1,
            requestKey: args.requestKey,
            requestHash: hash,
            updatedAt: Date.now(),
        };
        if (current) await ctx.db.patch(current._id, data);
        else await ctx.db.insert("agentModelSettings", data);
        await ctx.db.insert("auditEvents", {
            actor: { type: "visitor", visitorId: admin._id },
            action: "model_configuration_changed",
            targetType: "agent_model",
            targetId: args.agent,
            reason: "Agent model assigned.",
            occurredAt: Date.now(),
        });
        return { revision: data.revision };
    },
});

/** The model is resolved once at admission; disabled catalogue entries cannot start new work. */
export async function resolveAgentModel(
    ctx: QueryCtx,
    agent: Infer<typeof modelAgent>,
    selected?: Id<"modelCatalog">,
) {
    const setting = selected
        ? null
        : await ctx.db
              .query("agentModelSettings")
              .withIndex("by_agent", (q) => q.eq("agent", agent))
              .unique();
    const id = selected ?? setting?.catalogId;
    const catalog = id ? await ctx.db.get(id) : null;
    if (
        !catalog?.enabled ||
        !modelPrepared(catalog) ||
        !catalog.currentRevisionId ||
        (selected && !catalog.workbenchSelectable)
    )
        throw executionError("model_unavailable");
    const revision = await ctx.db.get(catalog.currentRevisionId);
    return requireAgentCompatibility(agent, revision);
}

export function revisionRoute(
    revision: Infer<typeof effectiveModelConfiguration>,
) {
    return {
        model: revision.model,
        provider: revision.provider,
        reasoningEffort: revision.reasoningEffort,
        descriptor: revision.descriptor,
        profileKey: modelConfigurationKey(revision.descriptor),
        authorizedForAgent: true as const,
    };
}

/** Explicit dossier choices must remain valid for the selected immutable configuration. */
export function requireReasoningEffort(
    model: Doc<"modelRevisions">,
    effort: Infer<typeof reasoningEffort> | undefined,
) {
    if (effort === undefined) return;
    const available = model.descriptor.reasoningEfforts;
    if (
        (available
            ? !available.includes(effort)
            : effort !== model.reasoningEffort) ||
        (effort === "none" && model.descriptor.reasoningMandatory)
    )
        throw executionError("model_effort_unavailable");
}

/** Admission and recovery share one immutable routing decision, independent of worker lifetimes. */
export async function pinMissionModel(
    ctx: MutationCtx,
    mission: Doc<"agentMissions">,
) {
    if (mission.modelRevisionId) return;
    const agent =
        mission.definitionId === "workbench_v1"
            ? "workbench"
            : mission.definitionId === "sources_v1"
              ? "sources"
              : mission.definitionId === "saved_material_inspection_v1"
                ? "saved_material_inspection"
                : null;
    if (
        !agent ||
        (agent === "workbench" &&
            process.env.WORKBENCH_AGENT_ENABLED !== "true")
    )
        return;
    const conversation =
        agent === "workbench"
            ? await ctx.db
                  .query("agentConversations")
                  .withIndex("by_run", (q) => q.eq("runId", mission.runId))
                  .unique()
            : null;
    let model: Doc<"modelRevisions">;
    let effort: Infer<typeof reasoningEffort> | undefined;
    try {
        model = await resolveAgentModel(
            ctx,
            agent,
            conversation?.modelCatalogId,
        );
        effort = conversation?.reasoningEffort ?? model.reasoningEffort;
        requireReasoningEffort(model, effort);
    } catch (error) {
        // The executor records the existing typed missing-route outcome without dispatch.
        if (
            ["model_unavailable", "model_effort_unavailable"].includes(
                executionFailureCode(error) ?? "",
            )
        )
            return;
        throw error;
    }
    await ctx.db.patch(mission._id, {
        modelRevisionId: model._id,
        ...(effort ? { reasoningEffort: effort } : {}),
    });
    if (conversation && !conversation.modelCatalogId)
        await ctx.db.patch(conversation._id, {
            modelCatalogId: model.catalogId,
        });
}

export async function missionModel(
    ctx: QueryCtx,
    mission: Doc<"agentMissions">,
) {
    if (
        mission.definitionId === "workbench_v1" &&
        process.env.WORKBENCH_AGENT_ENABLED !== "true"
    )
        return undefined;
    const revision = mission.modelRevisionId
        ? await ctx.db.get(mission.modelRevisionId)
        : null;
    return revision
        ? {
              model: revision.model,
              provider: revision.provider,
              descriptor: revision.descriptor,
              reasoningEffort:
                  mission.reasoningEffort ?? revision.reasoningEffort,
          }
        : undefined;
}

export const forMission = internalQuery({
    args: { missionId: v.id("agentMissions") },
    returns: v.union(effectiveModelConfiguration, v.null()),
    handler: async (ctx, args) => {
        const mission = await ctx.db.get(args.missionId);
        if (!mission) return null;
        await requireDossierAuthority(ctx, mission.runId);
        return (await missionModel(ctx, mission)) ?? null;
    },
});
export const forPreparation = internalMutation({
    args: {
        preparationId: v.id("sourceSelectionProposalRebuilds"),
        expectedGeneration: v.number(),
    },
    returns: schema.doc("modelRevisions"),
    handler: async (ctx, args) => {
        const { preparation } = await assertPreparationExecutionFence(ctx.db, {
            preparationId: args.preparationId,
            now: Date.now(),
        });
        await requireDossierAuthority(ctx, preparation.runId);
        if (preparation.executionGeneration !== args.expectedGeneration)
            throw executionError("stale_execution");
        if (preparation.modelRevisionId) {
            const pinned = await ctx.db.get(preparation.modelRevisionId);
            if (!pinned) throw executionError("model_unavailable");
            return pinned;
        }
        const revision = await resolveAgentModel(ctx, "sources");
        await ctx.db.patch(preparation._id, { modelRevisionId: revision._id });
        return revision;
    },
});
export const profile = internalQuery({
    args: { key: v.string() },
    returns: v.union(v.number(), v.null()),
    handler: async (ctx, args) => {
        return (
            (
                await ctx.db
                    .query("nativeInputProfiles")
                    .withIndex("by_key", (q) => q.eq("key", args.key))
                    .unique()
            )?.bytes ?? null
        );
    },
});

/** Immutable turn snapshots use the same defaults and validation as administrative changes. */
export async function readResponseControlPolicy(ctx: QueryCtx) {
    const row = await ctx.db
        .query("responseControlSettings")
        .withIndex("by_key", (q) => q.eq("key", "global"))
        .unique();
    if (!row) return { ...DEFAULT_RESPONSE_CONTROL_POLICY };
    const {
        _id,
        _creationTime,
        key: _key,
        updatedAt: _updatedAt,
        ...policy
    } = row;
    return policy;
}
export const setResponseControl = mutation({
    args: {
        expectedRevision: v.number(),
        ...responseControlConfiguration.fields,
    },
    returns: responseControlPolicy,
    handler: async (ctx, { expectedRevision, ...configuration }) => {
        await requireAdmin(ctx);
        if (
            !Number.isSafeInteger(expectedRevision) ||
            expectedRevision < 0 ||
            !validResponseControlConfiguration(configuration)
        )
            throw executionError("response_control_policy_invalid");
        const row = await ctx.db
            .query("responseControlSettings")
            .withIndex("by_key", (q) => q.eq("key", "global"))
            .unique();
        if ((row?.revision ?? 0) !== expectedRevision)
            throw executionError("version_conflict");
        const policy = { ...configuration, revision: expectedRevision + 1 };
        const value = {
            ...policy,
            key: "global" as const,
            updatedAt: Date.now(),
        };
        if (row) await ctx.db.replace(row._id, value);
        else await ctx.db.insert("responseControlSettings", value);
        return policy;
    },
});
