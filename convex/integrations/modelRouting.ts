import { sha256Hex, stableStringify } from "@convex/domain/sourcePassages";
import { executionError } from "@convex/execution/errors";
import type {
    modelDescriptor,
    reasoningEffort,
    reasoningPreference,
} from "@convex/modelConfigurationSchema";
import { reasoningEffortValues } from "@convex/modelConfigurationValues";
import {
    MODEL_MAX_INPUT_PRICE_PER_MILLION,
    MODEL_MAX_OUTPUT_PRICE_PER_MILLION,
} from "@convex/resourcePolicy";
import chordPackage from "@earendil-works/chord/package.json";
import { PI_AI_VERSION } from "@earendil-works/pi-ai/utils/version";
import durablePackage from "@earendil-works/pi-durable/package.json";
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
/** Installed SDK identity invalidates prepared profiles without a manually maintained version mirror. */
export const NATIVE_MODEL_SERIALIZER = `pi-ai@${PI_AI_VERSION}/pi-durable@${durablePackage.version}/chord@${chordPackage.version}:3`;
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
    for (const [key, bytes] of Object.entries(args.baseline.profiles)) {
        if (!Number.isSafeInteger(bytes) || bytes < 1)
            throw executionError("model_input_profile_invalid");
        merged[key] = bytes;
    }
    for (const [key, bytes] of Object.entries(args.measured)) {
        if (!Number.isSafeInteger(bytes) || bytes < 1)
            throw executionError("model_input_profile_invalid");
        if (merged[key] !== undefined && merged[key] !== bytes)
            throw executionError("model_input_profile_conflict");
        merged[key] = bytes;
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

/** One admitted ceiling serves structured transport and its pre-call reservation. */
export function preparationModelOutputLimit(route: ModelRoute): number {
    const descriptor = route.descriptor;
    if (
        !descriptor ||
        !Number.isSafeInteger(descriptor.maxTokens) ||
        descriptor.maxTokens < 1 ||
        !Number.isSafeInteger(descriptor.contextWindow) ||
        descriptor.contextWindow < 1
    )
        throw executionError("invalid_model_output_limit");
    return Math.min(descriptor.maxTokens, descriptor.contextWindow);
}
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

/** Only advertised levels can be offered or recommended; mandatory reasoning excludes off. */
export function reasoningChoices(descriptor: Infer<typeof modelDescriptor>) {
    return descriptor.reasoning
        ? (descriptor.reasoningEfforts ?? []).filter(
              (effort) => effort !== "none" || !descriptor.reasoningMandatory,
          )
        : [];
}

/** Medium is a recommendation, never an admission floor or an invented capability. */
export function recommendedReasoningEffort(
    descriptor: Infer<typeof modelDescriptor>,
) {
    if (!descriptor.reasoning) return undefined;
    const supported = reasoningChoices(descriptor);
    const order = reasoningEffortValues;
    return (
        order
            .slice(order.indexOf("medium"))
            .find((effort) => supported.includes(effort)) ??
        [...order.slice(0, order.indexOf("medium"))]
            .reverse()
            .find((effort) => supported.includes(effort))
    );
}

/** Resolves an administrative or frozen evaluation choice against its saved capabilities. */
export function resolveReasoningPreference(
    descriptor: Infer<typeof modelDescriptor>,
    preference: Infer<typeof reasoningPreference>,
) {
    return preference === "recommended"
        ? recommendedReasoningEffort(descriptor)
        : preference;
}

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
