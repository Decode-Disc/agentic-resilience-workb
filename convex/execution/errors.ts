import type { Infer } from "convex/values";
import { ConvexError } from "convex/values";
import type { dispatchFailureValidator } from "./operationContracts";

export function executionError(code: string) {
    return new ConvexError({ code });
}

export function executionFailureCode(error: unknown): string | undefined {
    if (
        !(error instanceof ConvexError) ||
        typeof error.data !== "object" ||
        !error.data ||
        !("code" in error.data)
    )
        return undefined;
    return typeof error.data.code === "string" ? error.data.code : undefined;
}

const AUTHORITY_FAILURES = new Set([
    "not_authorized",
    "stale_execution",
    "stale_instructions",
    "active_turn_required",
    "execution_deadline",
    "execution_not_running",
    "execution_interrupted",
    "mission_cancelled",
    "mission_completed",
    "mission_blocked",
    "operation_outcome_unknown",
]);

/** An exception after an effectful callback starts cannot establish that nothing happened. */
export function classifyDispatchFailure(
    error: unknown,
    phase: "before_callback" | "read_callback" | "effect_callback",
): Infer<typeof dispatchFailureValidator> {
    const code = executionFailureCode(error);
    if (code && AUTHORITY_FAILURES.has(code))
        return { category: "authority", code };
    return phase === "effect_callback"
        ? { category: "uncertain_effect", code: "operation_outcome_unknown" }
        : { category: "incident", code: "operation_execution_failed" };
}
