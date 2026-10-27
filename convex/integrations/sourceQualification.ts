"use node";

import {
    createSourceComparisonResponseSchema,
    materializeSourceComparisonOutput,
    type PreparedSourceComparisonInput,
    type SourceComparisonOutput,
} from "@convex/domain/sourceComparison";
import {
    createQualificationResponseSchema,
    materializeQualificationOutput,
    type prepareQualificationInput,
    type SourceQualification,
} from "@convex/domain/sourceQualification";
import {
    type AttemptDependencies,
    type AttemptReceipt,
    invokeOneShot,
    rejectedOutputDiagnostic,
} from "./modelInvocation";
import type { SourceQualificationRoute } from "./sourceQualificationConfig";

export type QualificationAttemptResult = AttemptReceipt &
    (
        | { status: "succeeded"; qualification: SourceQualification }
        | { status: "failed"; errorCode: string; retryable: boolean }
    );

/** Performs one bounded provider attempt; orchestration owns fallback and persistence. */
export async function qualifySourceDocument(
    input: ReturnType<typeof prepareQualificationInput>,
    route: SourceQualificationRoute,
    dependencies: AttemptDependencies,
): Promise<QualificationAttemptResult> {
    const { instructions, ...state } = input.request;
    const attempt = await invokeOneShot({
        route,
        dependencies,
        instructions,
        prompt: JSON.stringify(state),
        schema: createQualificationResponseSchema(
            input.request.document.passages,
            input.request.protocolVersion,
        ),
        schemaName: "source_qualification",
    });
    if (attempt.status === "failed") return attempt;
    const { value, assistantOutput, ...receipt } = attempt;
    const validation = materializeQualificationOutput(input, value);
    if (validation.status !== "valid")
        return {
            ...receipt,
            status: "failed",
            errorCode: "invalid_output",
            retryable: true,
            outputDiagnostic: rejectedOutputDiagnostic(
                validation.reason,
                assistantOutput,
                "stop",
            ),
        };
    return {
        ...receipt,
        status: "succeeded",
        qualification: validation.qualification,
    };
}

export type SourceComparisonAttemptResult = AttemptReceipt &
    (
        | { status: "succeeded"; output: SourceComparisonOutput }
        | {
              status: "not_run";
              reason: "no_comparable_primary_evidence";
              output: SourceComparisonOutput;
          }
        | { status: "failed"; errorCode: string; retryable: boolean }
    );

/** Compares one grouped target capture; no provider call is made without primary evidence. */
export async function compareSourceContributions(
    input: PreparedSourceComparisonInput,
    route: SourceQualificationRoute,
    dependencies: AttemptDependencies,
): Promise<SourceComparisonAttemptResult> {
    const hasComparablePrimaryPassage = input.request.findings.some(
        (finding) => finding.primaryPassageKeys.length > 0,
    );
    if (!hasComparablePrimaryPassage) {
        const materialized = materializeSourceComparisonOutput(
            input,
            {
                findings: [],
            },
            "not_run",
        );
        if (materialized.status !== "valid")
            return {
                model: route.model,
                latencyMs: 0,
                status: "failed",
                errorCode: "invalid_local_result",
                retryable: false,
            };
        return {
            model: route.model,
            latencyMs: 0,
            status: "not_run",
            reason: "no_comparable_primary_evidence",
            output: materialized.output,
        };
    }
    const { instructions, ...state } = input.request;
    const attempt = await invokeOneShot({
        route,
        dependencies,
        instructions,
        prompt: JSON.stringify(state),
        schema: createSourceComparisonResponseSchema(input),
        schemaName: "source_comparison",
    });
    if (attempt.status === "failed") return attempt;
    const { value, assistantOutput, ...receipt } = attempt;
    const materialized = materializeSourceComparisonOutput(input, value);
    if (materialized.status !== "valid")
        return {
            ...receipt,
            status: "failed",
            errorCode: "invalid_output",
            retryable: true,
            outputDiagnostic: rejectedOutputDiagnostic(
                materialized.reason,
                assistantOutput,
                "stop",
            ),
        };
    return { ...receipt, status: "succeeded", output: materialized.output };
}
