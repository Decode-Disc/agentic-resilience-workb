import { executionError } from "@convex/execution/errors";
import type {
    modelDescriptor,
    reasoningPreference,
} from "@convex/modelConfigurationSchema";
import { reasoningEffortValues } from "@convex/modelConfigurationValues";
import type { Infer } from "convex/values";
import type { ModelRoute } from "./modelRouting";

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
