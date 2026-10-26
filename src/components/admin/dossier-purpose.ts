import type { api } from "@convex/_generated/api";
import type { FunctionArgs } from "convex/server";

export type RunPurpose = FunctionArgs<
    typeof api.adminOperations.listRunsPage
>["purpose"];

/**
 * Single source for the dossier purpose categories: the filter tabs and the
 * inspection details both read their labels from here.
 */
export const dossierPurposes = [
    { value: "research", label: "Research" },
    { value: "evaluation", label: "Benchmarks" },
    { value: "browser_test", label: "Browser tests" },
] as const satisfies ReadonlyArray<{ value: RunPurpose; label: string }>;

const purposeLabels = Object.fromEntries(
    dossierPurposes.map((purpose) => [purpose.value, purpose.label]),
) as Record<RunPurpose, string>;

/** Names a stored dossier purpose without exposing its key. */
export function dossierPurposeLabel(purpose: RunPurpose): string {
    return purposeLabels[purpose];
}
