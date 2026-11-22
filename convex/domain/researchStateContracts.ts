import type { Doc } from "@convex/_generated/dataModel";
import { approvalActionValidator } from "@convex/execution/approvalContracts";
import { type Infer, v } from "convex/values";
import {
    executionStatusValidator,
    preparedMaterialOutcomeValidator,
    researchRunLifecycleValidator,
    runPauseReasonValidator,
    sourcesPhaseValidator,
    sourcesPreparationProgressValidator,
} from "./validators";

const action = v.object({
    actor: v.union(
        v.literal("analyst_only"),
        v.literal("analyst_or_authorized_workbench"),
    ),
    applicable: v.boolean(),
    reason: v.union(v.string(), v.null()),
});
export const researchStateValidator = v.object({
    phase: researchRunLifecycleValidator,
    status: executionStatusValidator,
    executionGeneration: v.number(),
    started: v.boolean(),
    controlAvailable: v.boolean(),
    pauseReason: v.union(runPauseReasonValidator, v.null()),
    pauseRequested: v.boolean(),
    approvals: v.object({
        pending: v.array(
            v.object({
                requestId: v.id("approvalRequests"),
                action: approvalActionValidator,
                alternative: v.union(approvalActionValidator, v.null()),
                block: v.union(v.string(), v.null()),
            }),
        ),
        grants: v.array(approvalActionValidator),
    }),
    actions: v.object({
        start: action,
        pause: action,
        resume: action,
        continuePreparation: action,
        usePrepared: action,
    }),
    sources: v.union(
        v.null(),
        v.object({
            preparationId: v.id("sourceSelectionProposalRebuilds"),
            phase: sourcesPhaseValidator,
            outcome: v.union(preparedMaterialOutcomeValidator, v.null()),
            settledAt: v.union(v.number(), v.null()),
            executionStop: v.union(
                v.null(),
                v.object({
                    missionId: v.id("agentMissions"),
                    blockCode: v.union(v.string(), v.null()),
                    invocationId: v.union(v.id("agentInvocations"), v.null()),
                }),
            ),
            retainedDocuments: v.array(
                v.object({
                    sourceId: v.id("sources"),
                    title: v.union(v.string(), v.null()),
                }),
            ),
            instructionTreatment: v.object({
                status: v.union(
                    v.literal("closed"),
                    v.literal("at_capacity"),
                    v.literal("open"),
                ),
                description: v.string(),
            }),
            progress: v.optional(sourcesPreparationProgressValidator),
        }),
    ),
    nextCapability: v.union(v.literal("investigation_unavailable"), v.null()),
});
export type ResearchState = Infer<typeof researchStateValidator>;

export function researchStatus(
    run: Pick<Doc<"researchRuns">, "lifecycleState" | "executionStatus">,
):
    | "not_started"
    | "running"
    | "paused"
    | "completed"
    | "cancelled"
    | "failed"
    | "idle" {
    if (run.executionStatus !== "idle") return run.executionStatus;
    return run.lifecycleState === "framing" ? "not_started" : "idle";
}
