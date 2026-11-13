import { type Infer, v } from "convex/values";
import { sourceFindingNeedsComparison } from "./domain/sourceComparison";
import type { SourceQualification } from "./domain/sourceQualification";

export const PREPARATION_STUDY_MAX_ATTEMPTS = 128;
/** Frozen version-1 quote identity, not a live token allowance or dispatch limit. */
const maximumAttemptUsd = 0.0239616;
export const PREPARATION_STUDY_MAX_RESERVATION_USD =
    PREPARATION_STUDY_MAX_ATTEMPTS * maximumAttemptUsd;

const conditionValidator = v.object({
    phase: v.union(
        v.literal("replay"),
        v.literal("reading"),
        v.literal("comparison"),
    ),
    modelSources: v.number(),
});
export const preparationStudyEnvelopeValidator = v.object({
    version: v.literal(1),
    conditionIndex: v.number(),
    conditions: v.array(conditionValidator),
    maximumAttempts: v.number(),
    maximumReservationUsd: v.number(),
});
export type PreparationStudyEnvelope = Infer<
    typeof preparationStudyEnvelopeValidator
>;

/** Counts source operations, not findings or deterministic comparison checks. */
export function qualificationNeedsStudyComparison(
    qualification: SourceQualification,
    schemaVersion: string,
) {
    return qualification.findings.some((finding) =>
        sourceFindingNeedsComparison(
            finding,
            qualification.limitations,
            schemaVersion,
        ),
    );
}

/** Includes the initial attempt and one technical fallback for every eligible operation. */
export function quotePreparationStudy(
    conditions: PreparationStudyEnvelope["conditions"],
) {
    if (!conditions.length || conditions.length > 64)
        throw new Error("Invalid study conditions");
    let maximumAttempts = 0;
    for (const condition of conditions) {
        if (
            !Number.isSafeInteger(condition.modelSources) ||
            condition.modelSources < 0 ||
            condition.modelSources > 24 ||
            (condition.phase === "reading" && condition.modelSources !== 24) ||
            (condition.phase === "replay" && condition.modelSources !== 0)
        )
            throw new Error("Invalid model source count");
        maximumAttempts += condition.modelSources * 2;
    }
    if (maximumAttempts > PREPARATION_STUDY_MAX_ATTEMPTS)
        throw new Error("Split paid conditions into separate approved lots");
    return {
        maximumAttempts,
        maximumReservationUsd: maximumAttempts * maximumAttemptUsd,
    };
}

export function validatePreparationStudyEnvelope(
    envelope: PreparationStudyEnvelope,
) {
    const quote = quotePreparationStudy(envelope.conditions);
    const condition = envelope.conditions[envelope.conditionIndex];
    if (
        envelope.version !== 1 ||
        !Number.isSafeInteger(envelope.conditionIndex) ||
        !condition ||
        quote.maximumAttempts !== envelope.maximumAttempts ||
        quote.maximumReservationUsd !== envelope.maximumReservationUsd
    )
        throw new Error("Frozen study envelope mismatch");
    return condition;
}
