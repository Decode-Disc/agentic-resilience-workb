"use node";

import type { FunctionReturnType } from "convex/server";
import { type Infer, v } from "convex/values";
import { internal } from "./_generated/api";
import { type ActionCtx, action } from "./_generated/server";
import {
    defaultReasoningEffort,
    INITIAL_MODEL_CATALOG,
    MODEL_MAX_INPUT_PRICE_PER_MILLION,
    MODEL_MAX_OUTPUT_PRICE_PER_MILLION,
} from "./integrations/modelRouting";
import { prepareNativeProfiles } from "./integrations/piModelProfiles";
import { modelPrepared } from "./modelConfiguration";
import { reasoningEffortValues } from "./modelConfigurationSchema";

const result = v.object({
    catalogId: v.id("modelCatalog"),
    revision: v.number(),
    ready: v.boolean(),
});
const input = {
    model: v.string(),
    provider: v.string(),
    label: v.string(),
    requestKey: v.string(),
    expectedRevision: v.optional(v.number()),
};

async function readMetadata(
    url: string,
    signal: AbortSignal,
): Promise<unknown> {
    const response = await fetch(url, {
        redirect: "error",
        signal: AbortSignal.any([signal, AbortSignal.timeout(15000)]),
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
            if (bytes > 8 * 1024 * 1024) throw new Error("catalog_capacity");
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

async function prepareModel(
    ctx: ActionCtx,
    args: {
        model: string;
        provider: string;
        label: string;
        requestKey: string;
        expectedRevision?: number;
    },
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
        const signal = AbortSignal.timeout(60000);
        const catalog = object(
            await readMetadata("https://openrouter.ai/api/v1/models", signal),
        );
        if (!Array.isArray(catalog.data) || catalog.data.length > 8192)
            throw new Error("catalog_invalid");
        const model = catalog.data
            .map(object)
            .find((row) => row.id === args.model);
        if (!model) throw new Error("model_unavailable");
        const endpointData = object(
            object(
                await readMetadata(
                    `https://openrouter.ai/api/v1/models/${args.model}/endpoints`,
                    signal,
                ),
            ).data,
        );
        if (!Array.isArray(endpointData.endpoints))
            throw new Error("catalog_invalid");
        const endpoint = endpointData.endpoints
            .map(object)
            .find((row) => row.tag === args.provider && row.status === 0);
        if (!endpoint) throw new Error("provider_unavailable");
        const parameters = endpoint.supported_parameters;
        if (
            !Array.isArray(parameters) ||
            !parameters.includes("tools") ||
            !parameters.includes("max_tokens")
        )
            throw new Error("model_not_compatible");
        const pricing = object(endpoint.pricing);
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
            contextWindow: Number(
                endpoint.context_length ?? model.context_length,
            ),
            maxTokens: Number(
                endpoint.max_completion_tokens ?? top.max_completion_tokens,
            ),
            reasoning: parameters.includes("reasoning"),
            reasoningEfforts,
            reasoningMandatory,
            ...(reasoningDefault ? { reasoningDefault } : {}),
            inputPrice: Number(pricing.prompt) * 1000000,
            outputPrice: Number(pricing.completion) * 1000000,
            cacheReadPrice:
                Number(pricing.input_cache_read ?? pricing.prompt) * 1000000,
            structuredOutputs: parameters.includes("structured_outputs"),
        };
        if (
            !Number.isFinite(descriptor.inputPrice) ||
            !Number.isFinite(descriptor.outputPrice) ||
            descriptor.inputPrice > MODEL_MAX_INPUT_PRICE_PER_MILLION ||
            descriptor.outputPrice > MODEL_MAX_OUTPUT_PRICE_PER_MILLION ||
            descriptor.contextWindow < 32768 ||
            descriptor.maxTokens < 6144
        )
            throw new Error("model_not_compatible");
        const profiles = await prepareNativeProfiles(
            {
                model: args.model,
                provider: args.provider,
                reasoningEffort: defaultReasoningEffort(descriptor),
                reasoningEnabled: descriptor.reasoning,
            },
            descriptor,
            signal,
        );
        return await ctx.runMutation(
            internal.modelConfiguration.finishPreparation,
            {
                catalogId: pending.catalogId,
                revision: pending.revision,
                descriptor,
                profiles,
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
    args: input,
    returns: result,
    handler: prepareModel,
});

/** Creates the approved defaults once; existing administrative choices are never overwritten. */
export const initialize = action({
    args: {},
    returns: v.object({ ready: v.boolean() }),
    handler: async (ctx): Promise<{ ready: boolean }> => {
        await ctx.runQuery(internal.modelConfiguration.authorize, {});
        const initial = INITIAL_MODEL_CATALOG;
        for (const model of initial) {
            const provider = model.provider;
            const existing: FunctionReturnType<
                typeof internal.modelConfiguration.findCatalog
            > = await ctx.runQuery(internal.modelConfiguration.findCatalog, {
                model: model.model,
                provider,
            });
            if (existing?.status === "ready" && !modelPrepared(existing))
                return { ready: false };
            const outcome =
                existing?.status === "ready"
                    ? {
                          catalogId: existing._id,
                          revision: existing.revision,
                          ready: true,
                      }
                    : await prepareModel(ctx, {
                          ...model,
                          provider,
                          requestKey: `initial:${model.model}`,
                          ...(existing
                              ? { expectedRevision: existing.revision }
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
