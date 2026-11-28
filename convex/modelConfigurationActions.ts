"use node";

import { executionError } from "@convex/execution/errors";
import {
    modelPrepared,
    revisionRoute,
} from "@convex/execution/modelConfigurationCore";
import { browserModelMetadata } from "@convex/fixtures/browserModelMetadata";
import { verifyResponseControlModel as verifyDecisionsModel } from "@convex/integrations/responseCoherence";
import {
    MODEL_CATALOG_MAX_ENDPOINTS,
    MODEL_CATALOG_MAX_RESPONSE_BYTES,
    MODEL_CATALOG_MAX_ROWS,
    MODEL_CATALOG_REFRESH_TIMEOUT_MS,
    MODEL_MAX_INPUT_PRICE_PER_MILLION,
    MODEL_MAX_OUTPUT_PRICE_PER_MILLION,
    MODEL_METADATA_REQUEST_TIMEOUT_MS,
    NATIVE_PROFILE_BATCH_SIZE,
    NATIVE_PROFILE_PREPARATION_TIMEOUT_MS,
} from "@convex/resourcePolicy";
import type { FunctionReturnType } from "convex/server";
import { type Infer, v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import { type ActionCtx, action } from "./_generated/server";
import {
    INITIAL_MODEL_CATALOG,
    NATIVE_PROFILE_CATALOG,
    recommendedReasoningEffort,
} from "./integrations/modelRouting";
import { prepareNativeProfiles } from "./integrations/piModelProfiles";
import {
    modelPreparationInput,
    type nativeProfile,
    reasoningEffortValues,
} from "./modelConfigurationSchema";

const result = v.object({
    catalogId: v.id("modelCatalog"),
    revision: v.number(),
    ready: v.boolean(),
});

async function readMetadata(
    url: string,
    signal: AbortSignal,
): Promise<unknown> {
    const fixture = browserModelMetadata(url);
    if (fixture !== undefined) return fixture;
    const response = await fetch(url, {
        redirect: "error",
        signal: AbortSignal.any([
            signal,
            AbortSignal.timeout(MODEL_METADATA_REQUEST_TIMEOUT_MS),
        ]),
        headers: { accept: "application/json" },
    });
    if (!response.ok || !response.body) throw new Error("catalog_unavailable");
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let bytes = 0;
    try {
        while (true) {
            const next = await reader.read();
            if (next.done) break;
            bytes += next.value.byteLength;
            if (bytes > MODEL_CATALOG_MAX_RESPONSE_BYTES)
                throw new Error("catalog_capacity");
            chunks.push(next.value);
        }
    } finally {
        await reader.cancel();
    }
    const body = new Uint8Array(bytes);
    let offset = 0;
    for (const chunk of chunks) {
        body.set(chunk, offset);
        offset += chunk.byteLength;
    }
    return JSON.parse(new TextDecoder().decode(body));
}
function object(value: unknown): Record<string, unknown> {
    if (!value || typeof value !== "object" || Array.isArray(value))
        throw new Error("catalog_invalid");
    return value as Record<string, unknown>;
}

async function readProfileBatches(
    ctx: ActionCtx,
    keys: string[],
): Promise<Infer<typeof nativeProfile>[]> {
    const profiles: Infer<typeof nativeProfile>[] = [];
    for (
        let offset = 0;
        offset < keys.length;
        offset += NATIVE_PROFILE_BATCH_SIZE
    ) {
        profiles.push(
            ...(await ctx.runQuery(internal.modelConfiguration.profiles, {
                keys: keys.slice(offset, offset + NATIVE_PROFILE_BATCH_SIZE),
            })),
        );
    }
    return profiles;
}
async function stageProfilePrefixBatches(
    ctx: ActionCtx,
    profiles: Infer<typeof nativeProfile>[],
): Promise<Infer<typeof nativeProfile>[]> {
    let offset = 0;
    for (
        ;
        offset + NATIVE_PROFILE_BATCH_SIZE < profiles.length;
        offset += NATIVE_PROFILE_BATCH_SIZE
    ) {
        await ctx.runMutation(
            internal.modelConfiguration.retainNativeProfileBatch,
            {
                profileCatalog: NATIVE_PROFILE_CATALOG,
                profiles: profiles.slice(
                    offset,
                    offset + NATIVE_PROFILE_BATCH_SIZE,
                ),
            },
        );
    }
    return profiles.slice(offset);
}

async function prepareModel(
    ctx: ActionCtx,
    args: Infer<typeof modelPreparationInput>,
): Promise<Infer<typeof result>> {
    await ctx.runQuery(internal.modelConfiguration.authorize, {});
    const pending: Infer<typeof result> & { claimed: boolean } =
        await ctx.runMutation(
            internal.modelConfiguration.beginPreparation,
            args,
        );
    const outcome = {
        catalogId: pending.catalogId,
        revision: pending.revision,
        ready: pending.ready,
    };
    if (!pending.claimed) return outcome;
    try {
        const signal = AbortSignal.timeout(MODEL_CATALOG_REFRESH_TIMEOUT_MS);
        const catalog = object(
            await readMetadata("https://openrouter.ai/api/v1/models", signal),
        );
        if (
            !Array.isArray(catalog.data) ||
            catalog.data.length > MODEL_CATALOG_MAX_ROWS
        )
            throw new Error("catalog_invalid");
        let model = catalog.data
            .map(object)
            .find((row) => row.id === args.model);
        if (!model) throw new Error("model_unavailable");
        if (args.provider) {
            const metadata = object(
                await readMetadata(
                    `https://openrouter.ai/api/v1/models/${args.model.split("/").map(encodeURIComponent).join("/")}/endpoints`,
                    signal,
                ),
            );
            const data = object(metadata.data);
            if (
                data.id !== args.model ||
                !Array.isArray(data.endpoints) ||
                data.endpoints.length > MODEL_CATALOG_MAX_ENDPOINTS
            )
                throw new Error("catalog_invalid");
            const endpoint = data.endpoints
                .map(object)
                .find((row) => row.tag === args.provider);
            if (endpoint?.status !== 0) throw new Error("provider_unavailable");
            model = {
                ...model,
                ...endpoint,
                top_provider: {
                    max_completion_tokens: endpoint.max_completion_tokens,
                },
            };
        }
        const parameters = model.supported_parameters;
        if (
            !Array.isArray(parameters) ||
            parameters.length > 128 ||
            parameters.some(
                (value) => typeof value !== "string" || value.length > 100,
            ) ||
            !parameters.includes("tools") ||
            !parameters.includes("max_tokens")
        )
            throw new Error("model_not_compatible");
        const pricing = object(model.pricing);
        for (const value of [pricing.prompt, pricing.completion])
            if (
                (typeof value !== "string" && typeof value !== "number") ||
                String(value).trim() === ""
            )
                throw new Error("model_not_compatible");
        const top = model.top_provider ? object(model.top_provider) : {};
        const reasoning = model.reasoning ? object(model.reasoning) : {};
        const advertised = reasoning.supported_efforts;
        if (
            advertised !== undefined &&
            advertised !== null &&
            (!Array.isArray(advertised) ||
                advertised.some(
                    (value) =>
                        !reasoningEffortValues.some(
                            (effort) => effort === value,
                        ),
                ))
        )
            throw new Error("model_not_compatible");
        const reasoningMandatory =
            parameters.includes("reasoning") && reasoning.mandatory === true;
        const reasoningEfforts = parameters.includes("reasoning")
            ? reasoningEffortValues.filter(
                  (effort) =>
                      (advertised === null ||
                          (Array.isArray(advertised) &&
                              advertised.includes(effort))) &&
                      !(reasoningMandatory && effort === "none"),
              )
            : [];
        const reasoningDefault = reasoningEffortValues.find(
            (effort) =>
                effort === reasoning.default_effort &&
                reasoningEfforts.includes(effort),
        );
        const descriptor = {
            contextWindow: Number(model.context_length),
            maxTokens: Number(top.max_completion_tokens),
            reasoning: parameters.includes("reasoning"),
            reasoningEfforts,
            reasoningMandatory,
            ...(reasoningDefault ? { reasoningDefault } : {}),
            inputPrice: Number(pricing.prompt) * 1000000,
            outputPrice: Number(pricing.completion) * 1000000,
            cacheReadPrice:
                Number(pricing.input_cache_read ?? pricing.prompt) * 1000000,
            structuredOutputs: parameters.includes("structured_outputs"),
            supportedParameters: parameters,
        };
        if (
            !Number.isFinite(descriptor.inputPrice) ||
            !Number.isFinite(descriptor.outputPrice) ||
            descriptor.inputPrice > MODEL_MAX_INPUT_PRICE_PER_MILLION ||
            descriptor.outputPrice > MODEL_MAX_OUTPUT_PRICE_PER_MILLION ||
            !Number.isSafeInteger(descriptor.contextWindow) ||
            descriptor.contextWindow < 32768 ||
            !Number.isSafeInteger(descriptor.maxTokens) ||
            descriptor.maxTokens < 1
        )
            throw new Error("model_not_compatible");
        const profiles = await prepareNativeProfiles(
            {
                model: args.model,
                provider: args.provider,
                reasoningEffort: recommendedReasoningEffort(descriptor),
            },
            descriptor,
            signal,
            (keys) => readProfileBatches(ctx, keys),
        );
        return await ctx.runMutation(
            internal.modelConfiguration.finishPreparation,
            {
                catalogId: pending.catalogId,
                revision: pending.revision,
                descriptor,
                profiles: await stageProfilePrefixBatches(ctx, profiles),
                profileCatalog: NATIVE_PROFILE_CATALOG,
            },
        );
    } catch (error) {
        const known =
            error instanceof Error &&
            [
                "catalog_unavailable",
                "catalog_capacity",
                "catalog_invalid",
                "model_unavailable",
                "provider_unavailable",
                "model_not_compatible",
            ].includes(error.message)
                ? error.message
                : "model_preparation_failed";
        await ctx.runMutation(internal.modelConfiguration.failPreparation, {
            catalogId: pending.catalogId,
            revision: pending.revision,
            failure: known,
        });
        return { ...outcome, ready: false };
    }
}

export const prepare = action({
    args: modelPreparationInput.fields,
    returns: result,
    handler: prepareModel,
});

/** Verifies a response-controller model against OpenRouter's Decisions catalogue before campaign admission. */
export const verifyResponseControlModel = action({
    args: { model: v.string() },
    returns: v.object({
        model: v.string(),
        contextWindowTokens: v.number(),
    }),
    handler: async (
        ctx,
        { model },
    ): Promise<{ model: string; contextWindowTokens: number }> => {
        await ctx.runQuery(internal.modelConfiguration.authorize, {});
        const verified = await verifyDecisionsModel({ model });
        if (!verified.ok) throw executionError(verified.reason);
        return {
            model: verified.model,
            contextWindowTokens: verified.contextWindowTokens,
        };
    },
});

async function refreshRevision(
    ctx: ActionCtx,
    revision: Doc<"modelRevisions">,
    needsCatalogStamp: boolean,
) {
    const retainedKeys = new Set<string>();
    const profiles = await prepareNativeProfiles(
        revisionRoute(revision),
        revision.descriptor,
        AbortSignal.timeout(NATIVE_PROFILE_PREPARATION_TIMEOUT_MS),
        async (keys) => {
            const existing = await readProfileBatches(ctx, keys);
            for (const profile of existing)
                if (profile.effectiveMaxOutputTokens !== undefined)
                    retainedKeys.add(profile.key);
            return existing;
        },
    );
    const missing = profiles.filter(
        (profile) => !retainedKeys.has(profile.key),
    );
    if (missing.length === 0 && !needsCatalogStamp) return;
    await ctx.runMutation(internal.modelConfiguration.retainRefreshedProfiles, {
        revisionId: revision._id,
        profileCatalog: NATIVE_PROFILE_CATALOG,
        profiles:
            missing.length > 0
                ? await stageProfilePrefixBatches(ctx, missing)
                : [],
    });
}

/** Recalibrates one distinct retained revision per call; the caller follows the bounded continuation to include old pins. */
export const refreshProfiles = action({
    args: {
        catalogId: v.id("modelCatalog"),
        cursor: v.optional(v.union(v.string(), v.null())),
    },
    returns: v.object({
        isDone: v.boolean(),
        continueCursor: v.union(v.string(), v.null()),
    }),
    handler: async (
        ctx,
        args,
    ): Promise<{ isDone: boolean; continueCursor: string | null }> => {
        const page = await ctx.runQuery(
            internal.modelConfiguration.profileRevisions,
            args,
        );
        for (const revision of page.page)
            await refreshRevision(
                ctx,
                revision,
                revision._id === page.currentRevisionId &&
                    !page.catalogPrepared,
            );
        return {
            isDone: page.isDone,
            continueCursor: page.isDone ? null : page.continueCursor,
        };
    },
});

/** Creates the approved defaults once; existing administrative choices are never overwritten. */
export const initialize = action({
    args: {},
    returns: v.object({ ready: v.boolean() }),
    handler: async (ctx): Promise<{ ready: boolean }> => {
        await ctx.runQuery(internal.modelConfiguration.authorize, {});
        const initial = INITIAL_MODEL_CATALOG;
        for (const model of initial) {
            const existing: FunctionReturnType<
                typeof internal.modelConfiguration.findCatalog
            > = await ctx.runQuery(internal.modelConfiguration.findCatalog, {
                model: model.model,
            });
            if (existing?.status === "preparing") return { ready: false };
            if (existing?.status === "ready" && !modelPrepared(existing)) {
                const page = await ctx.runQuery(
                    internal.modelConfiguration.profileRevisions,
                    { catalogId: existing._id },
                );
                const revision = page.page[0];
                if (!revision || revision._id !== existing.currentRevisionId)
                    return { ready: false };
                await refreshRevision(ctx, revision, true);
            }
            const outcome =
                existing?.status === "ready"
                    ? {
                          catalogId: existing._id,
                          revision: existing.revision,
                          ready: true,
                      }
                    : await prepareModel(ctx, {
                          ...model,
                          requestKey: `initial:${model.model}:${existing?.revision ?? 0}`,
                          ...(existing
                              ? {
                                    catalogId: existing._id,
                                    expectedRevision: existing.revision,
                                }
                              : {}),
                      });
            if (!outcome.ready) return { ready: false };
            await ctx.runMutation(
                internal.modelConfiguration.initializePrepared,
                { catalogId: outcome.catalogId, primary: model === initial[0] },
            );
        }
        return { ready: true };
    },
});
