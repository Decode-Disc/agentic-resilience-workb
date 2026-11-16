import { auditActorValidator } from "@convex/domain/validators";
import { type Infer, v } from "convex/values";

export const approvalActionValidator = v.union(
    v.literal("pause_research"),
    v.literal("resume_research"),
    v.literal("continue_sources_preparation"),
    v.literal("settle_sources_preparation"),
);
export type ApprovalAction = Infer<typeof approvalActionValidator>;

export const approvalRequesterValidator = v.union(
    v.object({ type: v.literal("system") }),
    v.object({
        type: v.literal("agent"),
        missionId: v.id("agentMissions"),
        messageId: v.id("agentMessageDeliveries"),
    }),
);
export type ApprovalRequester = Infer<typeof approvalRequesterValidator>;

/** Stored statuses. "superseded" is never stored: `approvalStatus` derives it from the run's generation. */
export const storedApprovalStatusValidator = v.union(
    v.literal("pending"),
    v.literal("approved"),
    v.literal("denied"),
);
export const approvalStatusValidator = v.union(
    storedApprovalStatusValidator,
    v.literal("superseded"),
);
export type ApprovalStatus = Infer<typeof approvalStatusValidator>;

/** "alternative" applies the request's named alternative action. */
export const approvalChoiceValidator = v.union(
    v.literal("once"),
    v.literal("always"),
    v.literal("alternative"),
    v.literal("deny"),
);
export type ApprovalChoice = Infer<typeof approvalChoiceValidator>;

export const approvalOutcomeValidator = v.union(
    v.object({ kind: v.literal("applied"), action: approvalActionValidator }),
    v.object({ kind: v.literal("none") }),
);

export const approvalDecisionValidator = v.object({
    choice: approvalChoiceValidator,
    /** How the choice was made: on a card, by a standing grant (recorded as "always"), or by an exact command (recorded as "once"). */
    via: v.union(v.literal("card"), v.literal("grant"), v.literal("command")),
    decidedBy: auditActorValidator,
    decidedAt: v.number(),
    outcome: approvalOutcomeValidator,
});
export type ApprovalDecision = Infer<typeof approvalDecisionValidator>;

export type AuditActor = Infer<typeof auditActorValidator>;

export const approvalRequestViewValidator = v.object({
    id: v.id("approvalRequests"),
    runId: v.id("researchRuns"),
    action: approvalActionValidator,
    alternative: v.union(approvalActionValidator, v.null()),
    requestedBy: approvalRequesterValidator,
    status: approvalStatusValidator,
    /** Why the action cannot run now; null when it can. Only meaningful while pending. */
    block: v.union(v.string(), v.null()),
    decision: v.union(approvalDecisionValidator, v.null()),
    grantActive: v.boolean(),
    createdAt: v.number(),
});
export type ApprovalRequestView = Infer<typeof approvalRequestViewValidator>;
