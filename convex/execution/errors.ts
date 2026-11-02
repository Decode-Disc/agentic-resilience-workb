import type { Infer } from "convex/values";
import { ConvexError } from "convex/values";
import { sha256Hex } from "@convex/domain/sourcePassages";
import type {
    dispatchFailureValidator,
    protectedDiagnosticValidator,
} from "./operationContracts";

type Diagnostic = Infer<typeof protectedDiagnosticValidator>;

/** Retain a bounded cause without copying credentials or arbitrary exception objects. */
export function protectedDiagnostic(
    error: unknown,
    phase: Diagnostic["phase"],
): Diagnostic {
    const name = error instanceof Error ? error.name : "UnknownError";
    const message =
        error instanceof Error ? error.message : "Non-Error exception";
    const redact = (value: string, limit: number) =>
        value
            .replace(/\bBearer\s+[^\s;,]+/gi, "Bearer [redacted]")
            .replace(/\b(?:sk|pk)-[a-z0-9_-]+/gi, "[redacted]")
            .replace(
                /(["']?(?:api[_-]?key|token|secret|password|authorization)["']?\s*[=:]\s*)(?:"[^"]*"|'[^']*'|[^\s;,]+)/gi,
                "$1[redacted]",
            )
            .replace(/https?:\/\/[^\s]+/gi, "[url redacted]")
            .slice(0, limit);
    return {
        phase,
        name: redact(name, 80),
        message: redact(message, 512),
        causeHash: sha256Hex(`${name}\n${message}`),
    };
}

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
    const diagnostic = protectedDiagnostic(error, phase);
    return phase === "effect_callback"
        ? {
              category: "uncertain_effect",
              code: "operation_outcome_unknown",
              diagnostic,
          }
        : {
              category: "incident",
              code: "operation_execution_failed",
              diagnostic,
          };
}
