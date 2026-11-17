/** Ordered reasoning vocabulary shared by runtime validation, recommendation and evaluation manifests. */
export const reasoningEffortValues = [
    "none",
    "minimal",
    "low",
    "medium",
    "high",
    "xhigh",
    "max",
] as const;
export const reasoningPreferenceValues = [
    "recommended",
    ...reasoningEffortValues,
] as const;
