import { sha256Hex, stableStringify } from "@convex/domain/sourcePassages";
import type {
    modelDescriptor,
    reasoningEffort,
} from "@convex/modelConfigurationSchema";
import chordPackage from "@earendil-works/chord/package.json";
import { PI_AI_VERSION } from "@earendil-works/pi-ai/utils/version";
import durablePackage from "@earendil-works/pi-durable/package.json";
import type { Infer } from "convex/values";
export type ModelRoute = Readonly<{
    model: string;
    /** Only historical configurations carry an explicitly pinned upstream provider. */
    provider?: string;
    reasoningEffort?: Infer<typeof reasoningEffort>;
    reasoningEnabled?: boolean;
    profileKey?: string;
}>;
/** Installed SDK identity invalidates prepared profiles without a manually maintained version mirror. */
export const NATIVE_MODEL_SERIALIZER = `pi-ai@${PI_AI_VERSION}/pi-durable@${durablePackage.version}/chord@${chordPackage.version}:1`;
export function modelConfigurationKey(descriptor: object) {
    return sha256Hex(
        stableStringify({ serializer: NATIVE_MODEL_SERIALIZER, descriptor }),
    );
}
export const SIMULATION_MODEL_ROUTE: ModelRoute = {
    model: "simulation/controlled",
    provider: "simulation",
};
export const MODEL_MAX_OUTPUT_TOKENS = 6144;
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

/** Preserve the existing economical default when the provider explicitly supports it. */
export function defaultReasoningEffort(
    descriptor: Infer<typeof modelDescriptor>,
) {
    if (!descriptor.reasoning) return undefined;
    if (descriptor.reasoningEfforts === undefined) return "low" as const;
    return descriptor.reasoningEfforts.includes("low")
        ? ("low" as const)
        : descriptor.reasoningDefault;
}

export function routedModelSettings(route: ModelRoute) {
    return {
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
        reasoning: route.reasoningEffort
            ? {
                  enabled: route.reasoningEffort !== "none",
                  effort: route.reasoningEffort,
                  exclude: true,
              }
            : route.reasoningEnabled
              ? { enabled: true, exclude: true }
              : { enabled: false, effort: "none" as const, exclude: true },
        usage: { include: true },
    };
}
