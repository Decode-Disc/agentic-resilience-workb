import { v } from "convex/values";

export const CLAIM_CLASSIFICATIONS = [
    "Fact",
    "Inference",
    "Hypothesis",
    "Unknown",
] as const;

export type ClaimClassification = (typeof CLAIM_CLASSIFICATIONS)[number];

export const claimClassificationValidator = v.union(
    v.literal("Fact"),
    v.literal("Inference"),
    v.literal("Hypothesis"),
    v.literal("Unknown"),
);

export const EVIDENCE_RELATIONS = ["supporting", "counter", "context"] as const;

export type EvidenceRelation = (typeof EVIDENCE_RELATIONS)[number];

export const evidenceRelationValidator = v.union(
    v.literal("supporting"),
    v.literal("counter"),
    v.literal("context"),
);

export const claimDimensionLinkOriginValidator = v.union(
    v.literal("generated"),
    v.literal("analyst"),
);

export const aiTaskExecutionModeValidator = v.union(
    v.literal("showcase"),
    v.literal("live"),
);
