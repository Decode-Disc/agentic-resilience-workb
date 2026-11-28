export {
    preparationModelOutputLimit,
    reasoningChoices,
    recommendedReasoningEffort,
    resolveReasoningPreference,
} from "./modelCapacity";

import { sha256Hex, stableStringify } from "@convex/domain/sourcePassages";
import { executionError } from "@convex/execution/errors";
import type {
    modelDescriptor,
    reasoningEffort,
} from "@convex/modelConfigurationSchema";
import {
    MODEL_MAX_INPUT_PRICE_PER_MILLION,
    MODEL_MAX_OUTPUT_PRICE_PER_MILLION,
} from "@convex/resourcePolicy";
import type { Infer } from "convex/values";
import profileCatalogMetadata from "./piInputProfileCatalog.json";

export type ModelRoute = Readonly<{
    model: string;
    /** An optional explicit provider pin is retained in the admitted configuration. */
    provider?: string;
    descriptor?: Infer<typeof modelDescriptor>;
    reasoningEffort?: Infer<typeof reasoningEffort>;
    reasoningEnabled?: boolean;
    profileKey?: string;
}>;
/** Serializer identity is generated with the calibrated profile catalog. */
export const NATIVE_MODEL_SERIALIZER = `pi-ai@${profileCatalogMetadata.versions["pi-ai"]}/pi-durable@${profileCatalogMetadata.versions["pi-durable"]}/chord@${profileCatalogMetadata.versions.chord}:3`;
/** Additions do not invalidate existing exact profiles; removals or changed profiles require refresh. */
export function nativeProfileCatalogueRevision(
    previous: { profiles: Record<string, number>; profileCatalog?: string },
    profiles: Record<string, number>,
) {
    const additive = Object.entries(previous.profiles).every(
        ([key, bytes]) => profiles[key] === bytes,
    );
    if (additive)
        return (
            previous.profileCatalog ??
            sha256Hex(stableStringify(Object.keys(previous.profiles).sort()))
        );
    return sha256Hex(
        stableStringify(
            Object.entries(profiles).sort(([a], [b]) => a.localeCompare(b)),
        ),
    );
}

/** Retains unchanged baseline keys only under the exact installed SDK tuple; changed schemas keep newly measured keys. */
export function mergeRetainedPiInputProfiles(args: {
    baseline: {
        versions: Record<string, string>;
        profiles: Record<string, number>;
        retainedProfiles?: Record<string, number>;
    };
    installedVersions: Record<string, string>;
    measured: Record<string, number>;
}): Record<string, number> {
    const baselineKeys = Object.keys(args.baseline.versions).sort();
    const installedKeys = Object.keys(args.installedVersions).sort();
    if (
        baselineKeys.length !== installedKeys.length ||
        baselineKeys.some(
            (key, index) =>
                key !== installedKeys[index] ||
                args.baseline.versions[key] !== args.installedVersions[key],
        )
    )
        throw executionError("model_input_profile_sdk_mismatch");
    const merged: Record<string, number> = {};
    for (const profiles of [
        args.baseline.retainedProfiles ?? {},
        args.baseline.profiles,
        args.measured,
    ]) {
        for (const [key, bytes] of Object.entries(profiles)) {
            if (!Number.isSafeInteger(bytes) || bytes < 1)
                throw executionError("model_input_profile_invalid");
            if (merged[key] !== undefined && merged[key] !== bytes)
                throw executionError("model_input_profile_conflict");
            merged[key] = bytes;
        }
    }
    return merged;
}
export const NATIVE_PROFILE_CATALOG = profileCatalogMetadata.profileCatalog;
export function modelConfigurationKey(descriptor: object) {
    return sha256Hex(
        stableStringify({ serializer: NATIVE_MODEL_SERIALIZER, descriptor }),
    );
}
/** Declared capabilities of the controlled, zero-provider fixture, never live-model defaults. */
export const SIMULATION_CONTEXT_WINDOW = 32000;
export const SIMULATION_MAX_OUTPUT_TOKENS = 6144;
export const SIMULATION_MODEL_ROUTE: ModelRoute = {
    model: "simulation/controlled",
    provider: "simulation",
    descriptor: {
        contextWindow: SIMULATION_CONTEXT_WINDOW,
        maxTokens: SIMULATION_MAX_OUTPUT_TOKENS,
        reasoning: false,
        inputPrice: 0,
        outputPrice: 0,
        cacheReadPrice: 0,
        structuredOutputs: true,
    },
};

export const INITIAL_MODEL_CATALOG = [
    {
        model: "z-ai/glm-5.3-flash",
        label: "GLM-5.3-Flash",
    },
    {
        model: "deepseek/deepseek-v4.1-flash-1017",
        label: "DeepSeek V4.1 Flash 1017",
    },
] as const;
/** Candidate configuration is calibrated without enabling provider calls. */
export const WORKBENCH_MODEL_ROUTE: ModelRoute & { authorizedForAgent: true } =
    {
        model: INITIAL_MODEL_CATALOG[0].model,
        reasoningEffort: "low",
        authorizedForAgent: true,
    };

/** Derives wire preferences and bounded generation options from the admitted model capabilities. */
export function modelCallSettings(route: ModelRoute, deadlineAt?: number) {
    const timeout =
        deadlineAt === undefined ? undefined : deadlineAt - Date.now();
    if (
        timeout !== undefined &&
        (!Number.isSafeInteger(timeout) || timeout <= 0)
    )
        throw executionError("execution_deadline");
    const descriptor = route.descriptor;
    const reasoningEnabled = descriptor?.reasoning ?? route.reasoningEnabled;
    const generation = {
        maxOutputTokens: descriptor?.maxTokens,
        temperature:
            descriptor?.supportedParameters &&
            !descriptor.supportedParameters.includes("temperature")
                ? undefined
                : 0,
        maxRetries: 0,
        timeout,
    };
    const request = {
        provider: {
            ...(route.provider
                ? { only: [route.provider], allow_fallbacks: false }
                : {}),
            require_parameters: true,
            max_price: {
                prompt: MODEL_MAX_INPUT_PRICE_PER_MILLION,
                completion: MODEL_MAX_OUTPUT_PRICE_PER_MILLION,
            },
        },
        reasoning:
            reasoningEnabled === false
                ? undefined
                : route.reasoningEffort
                  ? {
                        enabled: route.reasoningEffort !== "none",
                        effort: route.reasoningEffort,
                        exclude: true,
                    }
                  : reasoningEnabled
                    ? { enabled: true, exclude: true }
                    : {
                          enabled: false,
                          effort: "none" as const,
                          exclude: true,
                      },
        usage: { include: true },
    };
    return { request, generation };
}
