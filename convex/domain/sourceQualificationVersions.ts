import { v } from "convex/values";
export const SOURCE_QUALIFICATION_VERSION = "source-qualification-v4";
export const SOURCE_QUALIFICATION_CANDIDATE_VERSION = "source-qualification-v5";
export const SOURCE_QUALIFICATION_EXECUTION_VERSIONS = [
    "source-qualification-v3",
    SOURCE_QUALIFICATION_VERSION,
    SOURCE_QUALIFICATION_CANDIDATE_VERSION,
] as const;
export type QualificationExecutionVersion =
    (typeof SOURCE_QUALIFICATION_EXECUTION_VERSIONS)[number];

/** Only these protocols have an executable provider adapter. */
export function isExecutableQualificationVersion(
    version: string,
): version is QualificationExecutionVersion {
    return SOURCE_QUALIFICATION_EXECUTION_VERSIONS.some(
        (value) => value === version,
    );
}

/** Read compatibility does not authorize dispatch under an older protocol. */
export function isReadableQualificationVersion(version: string): boolean {
    return (
        version === "source-qualification-v2" ||
        isExecutableQualificationVersion(version)
    );
}

/** Resumes keep their recorded protocol; only a first preparation defaults to the current one. */
export function qualificationExecutionVersion(
    version: string = SOURCE_QUALIFICATION_VERSION,
): QualificationExecutionVersion {
    const supported = SOURCE_QUALIFICATION_EXECUTION_VERSIONS.find(
        (value) => value === version,
    );
    if (!supported)
        throw new Error("Unsupported qualification execution version");
    return supported;
}
export const SOURCE_QUALIFICATION_INPUT_POLICY = "full_document_first_v1";
export const qualificationSelectionStrategyValidator = v.union(
    v.literal("full_document"),
    v.literal("retrieved_passages"),
);
