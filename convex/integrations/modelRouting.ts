import { sha256Hex, stableStringify } from "@convex/domain/sourcePassages";
import { executionError } from "@convex/execution/errors";
import type {
    modelDescriptor,
    reasoningEffort,
    reasoningPreference,
} from "@convex/modelConfigurationSchema";
import { reasoningEffortValues } from "@convex/modelConfigurationValues";
import { SOURCE_PREPARATION_SOURCE_ACTIONS_VERSION } from "@convex/resourceLimits";
import chordPackage from "@earendil-works/chord/package.json";
import { PI_AI_VERSION } from "@earendil-works/pi-ai/utils/version";
import durablePackage from "@earendil-works/pi-durable/package.json";
import type { Infer } from "convex/values";
import inputProfiles from "./piInputProfiles.json";

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
export const NATIVE_PROFILE_CATALOG =
    "profileCatalog" in inputProfiles &&
    typeof inputProfiles.profileCatalog === "string"
        ? inputProfiles.profileCatalog
        : sha256Hex(
              stableStringify(Object.keys(inputProfiles.profiles).sort()),
          );
export function modelConfigurationKey(descriptor: object) {
    return sha256Hex(
        stableStringify({ serializer: NATIVE_MODEL_SERIALIZER, descriptor }),
    );
}
export const SIMULATION_MODEL_ROUTE: ModelRoute = {
    model: "simulation/controlled",
    provider: "simulation",
};
export const SIMULATION_CONTEXT_WINDOW = 32000;
export const MODEL_MAX_OUTPUT_TOKENS = 6144;

/** One admitted ceiling serves structured transport and its pre-call reservation. */
export function preparationModelOutputLimit(
    route: ModelRoute,
    executionPlanVersion?: string,
): number {
    if (executionPlanVersion !== SOURCE_PREPARATION_SOURCE_ACTIONS_VERSION)
        return Math.min(
            MODEL_MAX_OUTPUT_TOKENS,
            route.descriptor?.maxTokens ?? MODEL_MAX_OUTPUT_TOKENS,
        );
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
export const MODEL_ATTEMPT_TIMEOUT_MS = 60_000;
export const MODEL_MAX_INPUT_PRICE_PER_MILLION = 0.15;
export const MODEL_MAX_OUTPUT_PRICE_PER_MILLION = 0.6;
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
export function modelCallSettings(route: ModelRoute) {
    const descriptor = route.descriptor;
    const reasoningEnabled = descriptor?.reasoning ?? route.reasoningEnabled;
    const generation = {
        maxOutputTokens: Math.min(
            MODEL_MAX_OUTPUT_TOKENS,
            descriptor?.maxTokens ?? MODEL_MAX_OUTPUT_TOKENS,
        ),
        temperature:
            descriptor?.supportedParameters &&
            !descriptor.supportedParameters.includes("temperature")
                ? undefined
                : 0,
        maxRetries: 0,
        timeout: MODEL_ATTEMPT_TIMEOUT_MS,
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
