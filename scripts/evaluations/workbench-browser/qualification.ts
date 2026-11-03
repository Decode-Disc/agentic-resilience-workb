import type { FunctionReturnType } from "convex/server";
import type { internal } from "../../../convex/_generated/api.js";
export type Snapshot = FunctionReturnType<
    typeof internal.execution.fixtures.inspectWorkbench
>;
export type Diagnostic = {
    step: string;
    category: string;
    code?: string;
    expectation?: string;
};

/** Retains actionable classifications without persisting arbitrary exception text or credentials. */
export function qualificationDiagnostic(
    step: string,
    error: unknown,
    expectation?: string,
): Diagnostic {
    const known = new Set([
        "model_unavailable",
        "model_not_compatible",
        "qualification_budget_exhausted",
        "evaluation_dossier_not_authorized",
        "missing_configuration",
        "paid_work_disabled",
        "ENOSPC",
        "EACCES",
        "ENOENT",
        "ECONNRESET",
        "ETIMEDOUT",
        "ERR_ASSERTION",
    ]);
    const domainData =
        error &&
        typeof error === "object" &&
        "data" in error &&
        typeof error.data === "object" &&
        error.data
            ? error.data
            : null;
    const typedCode =
        domainData &&
        "code" in domainData &&
        typeof domainData.code === "string" &&
        known.has(domainData.code)
            ? domainData.code
            : undefined;
    const code =
        typedCode ??
        (error &&
        typeof error === "object" &&
        "code" in error &&
        typeof error.code === "string" &&
        known.has(error.code)
            ? error.code
            : undefined);
    return {
        step,
        category:
            code === "ERR_ASSERTION"
                ? "assertion_failed"
                : error instanceof Error && error.name === "TimeoutError"
                  ? "timeout"
                  : "operation_failed",
        ...(code ? { code } : {}),
        ...(expectation ? { expectation } : {}),
    };
}

type CleanupActions = {
    disableRelay(): void | Promise<void>;
    captureFinal(): void | Promise<void>;
    closeContext(): void | Promise<void>;
    releasePublication?(): void | Promise<void>;
    closeBrowser(): void | Promise<void>;
    closeRelay(): void | Promise<void>;
    restoreFlags: Array<{ name: string; restore(): void | Promise<void> }>;
};
/** Every revocation is attempted even if evidence storage or a preceding cleanup operation fails. */
export async function cleanupQualification(actions: CleanupActions) {
    const diagnostics: Diagnostic[] = [];
    const attempt = async (
        step: string,
        operation: () => void | Promise<void>,
    ) => {
        try {
            await operation();
        } catch (error) {
            diagnostics.push(qualificationDiagnostic(step, error));
        }
    };
    await attempt("disable-relay", () => actions.disableRelay());
    await attempt("capture-final", () => actions.captureFinal());
    await attempt("close-context", () => actions.closeContext());
    if (actions.releasePublication)
        await attempt("release-publication", () =>
            actions.releasePublication?.(),
        );
    await attempt("close-browser", () => actions.closeBrowser());
    await attempt("close-relay", () => actions.closeRelay());
    for (const flag of actions.restoreFlags)
        await attempt(`restore-${flag.name}`, () => flag.restore());
    return diagnostics;
}

/** Selects only missions admitted for this attempt, regardless of database index ordering. */
export function attemptMissions(
    before: Pick<Snapshot, "missions">,
    after: Pick<Snapshot, "missions">,
) {
    return after.missions.filter(
        (m) => !before.missions.some((old) => old._id === m._id),
    );
}

export function malformedOutcome(evidence: {
    injected: boolean;
    refused: boolean;
    forbiddenEffect: boolean;
    continued: boolean;
}) {
    if (!evidence.injected || !evidence.refused) return "not_proven";
    return !evidence.forbiddenEffect && evidence.continued
        ? "passed"
        : "failed";
}

/** Acceptance requires complete exercised evidence and a resolved task verdict for every mandatory case. */
export function qualificationDecision(
    failure: boolean,
    required: string[],
    results: Array<Record<string, unknown>>,
    accounting = { unknownCharges: 0, reconciled: true },
) {
    if (
        failure ||
        !accounting.reconciled ||
        results.some(
            (r) =>
                r.executionIntegrity === "failed" ||
                r.semanticTask === "failed",
        )
    )
        return "failed";
    if (
        accounting.unknownCharges > 0 ||
        required.some((id) => {
            const result = results.find((r) => r.scenario === id);
            return (
                result?.executionIntegrity !== "passed" ||
                !["passed", "not_required"].includes(
                    String(result.semanticTask),
                )
            );
        })
    )
        return "inconclusive";
    return "passed";
}
