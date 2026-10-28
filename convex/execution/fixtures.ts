import { internal } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import {
    internalAction,
    internalMutation,
    internalQuery,
} from "@convex/_generated/server";
import {
    claimCorpusApprovedRunExecution,
    claimPausedRunExecution,
} from "@convex/domain/executionClaim";
import { upsertSourceReviewItem } from "@convex/domain/sourceReviewProjection";
import {
    BROWSER_TEST_SLOT,
    requireBrowserFixtureContext,
    requireBrowserTestOwner,
} from "@convex/runWorkspace";
import { workflow } from "@convex/workflow";
import type { WorkflowId } from "@convex-dev/workflow";
import { v } from "convex/values";

/** Uses the admitted local test workspace; an approved corpus is deliberately unnecessary. */
export const startValidation = internalAction({
    args: { fixtureKey: v.string() },
    returns: v.id("agentMissions"),
    handler: async (ctx, args): Promise<Id<"agentMissions">> => {
        await ctx.runQuery(internal.execution.fixtures.authorize, {});
        const base = await ctx.runAction(
            internal.e2eFixtures.seedInspectedSourceReviewScenario,
            { slotKey: BROWSER_TEST_SLOT, fixtureKey: args.fixtureKey },
        );
        return ctx.runMutation(internal.execution.fixtures.activateValidation, {
            runId: base.runId,
            fixtureKey: args.fixtureKey,
        });
    },
});

export const activateValidation = internalMutation({
    args: { runId: v.id("researchRuns"), fixtureKey: v.string() },
    returns: v.id("agentMissions"),
    handler: async (ctx, args): Promise<Id<"agentMissions">> => {
        const visitor = await requireBrowserTestOwner(ctx, BROWSER_TEST_SLOT);
        const contextId = await requireBrowserFixtureContext(ctx, visitor);
        const run = await ctx.db.get(args.runId);
        if (
            !/^[a-z0-9-]{1,80}$/.test(args.fixtureKey) ||
            run?.purpose !== "browser_test" ||
            run.ownerVisitorId !== visitor._id ||
            run.browserTestContextId !== contextId ||
            !run.reservationKey?.endsWith(`:${args.fixtureKey}`)
        )
            throw new Error("Local validation fixture required");
        const existing = await ctx.db
            .query("agentMissions")
            .withIndex("by_run_and_request_key", (q) =>
                q.eq("runId", run._id).eq("requestKey", "local-validation"),
            )
            .unique();
        if (existing) return existing._id;
        const generation = await claimPausedRunExecution(ctx, {
            visitor,
            run,
            checkpoint: {
                lifecycleState: "awaiting_source_review",
                pauseReason: "source_review",
            },
            now: Date.now(),
        });
        if (run.workflowId)
            await workflow.cancel(ctx, run.workflowId as WorkflowId);
        await ctx.db.patch(run._id, {
            workflowId: undefined,
            lifecycleState: "extracting_evidence",
            companySnapshot: run.companySnapshot
                ? {
                      ...run.companySnapshot,
                      legalName:
                          "Agent contract validation · Simulation · Not live",
                  }
                : undefined,
            nextEventSequence: run.nextEventSequence + 1,
        });
        await ctx.db.insert("runEvents", {
            runId: run._id,
            sequence: run.nextEventSequence + 1,
            type: "run_transitioned",
            lifecycleState: "extracting_evidence",
            executionStatus: "running",
            occurredAt: Date.now(),
        });
        const missionId: Id<"agentMissions"> = await ctx.runMutation(
            internal.execution.missions.start,
            {
                runId: run._id,
                definitionId: "execution_validation_v1",
                scope: { kind: "execution_validation_v1", values: [3, 7] },
                requestKey: "local-validation",
                expectedGeneration: generation,
            },
        );
        await ctx.runMutation(internal.execution.missions.resume, {
            missionId,
            expectedGeneration: generation,
            simulation: true,
        });
        return missionId;
    },
});

/** Seeds the approved-corpus precondition for a labelled simulation; the separate review gate verifies human approval. */
export const start = internalAction({
    args: { fixtureKey: v.string() },
    returns: v.id("agentMissions"),
    handler: async (ctx, args): Promise<Id<"agentMissions">> => {
        await ctx.runQuery(internal.execution.fixtures.authorize, {});
        const base = await ctx.runAction(
            internal.e2eFixtures.seedInspectedSourceReviewScenario,
            { slotKey: BROWSER_TEST_SLOT, fixtureKey: args.fixtureKey },
        );
        return ctx.runMutation(internal.execution.fixtures.activate, {
            runId: base.runId,
            fixtureKey: args.fixtureKey,
        });
    },
});

export const authorize = internalQuery({
    args: {},
    returns: v.null(),
    handler: async (ctx) => {
        const visitor = await requireBrowserTestOwner(ctx, BROWSER_TEST_SLOT);
        await requireBrowserFixtureContext(ctx, visitor);
        return null;
    },
});

export const activate = internalMutation({
    args: { runId: v.id("researchRuns"), fixtureKey: v.string() },
    returns: v.id("agentMissions"),
    handler: async (ctx, args): Promise<Id<"agentMissions">> => {
        const visitor = await requireBrowserTestOwner(ctx, BROWSER_TEST_SLOT);
        const contextId = await requireBrowserFixtureContext(ctx, visitor);
        const run = await ctx.db.get(args.runId);
        if (
            !/^[a-z0-9-]{1,80}$/.test(args.fixtureKey) ||
            run?.purpose !== "browser_test" ||
            run.ownerVisitorId !== visitor._id ||
            run.browserTestContextId !== contextId ||
            !run.reservationKey?.endsWith(`:${args.fixtureKey}`) ||
            !run.activeCorpusRevisionId
        )
            throw new Error("Local simulation scope required");
        const existing = await ctx.db
            .query("agentMissions")
            .withIndex("by_run_and_request_key", (q) =>
                q.eq("runId", run._id).eq("requestKey", "local-simulation"),
            )
            .unique();
        if (existing) return existing._id;
        const revision = await ctx.db.get(run.activeCorpusRevisionId);
        if (
            run.lifecycleState !== "awaiting_source_review" ||
            run.executionStatus !== "paused" ||
            revision?.status !== "draft" ||
            !revision.sourceSelectionProposalId
        )
            throw new Error("Fresh simulation fixture required");
        const proposalId = revision.sourceSelectionProposalId;
        const items = await ctx.db
            .query("sourceSelectionProposalItems")
            .withIndex("by_proposal_and_source", (q) =>
                q.eq("proposalId", proposalId),
            )
            .take(9);
        if (items.length > 8 || !items.some((item) => item.sourceCaptureId))
            throw new Error("Bounded captured fixture required");
        const now = Date.now();
        for (const item of items) {
            if (!item.sourceCaptureId) continue;
            const source = await ctx.db.get(item.sourceId);
            if (!source || source.runId !== run._id)
                throw new Error("Fixture source unavailable");
            const decisionId = await ctx.db.insert("sourceDecisions", {
                runId: run._id,
                corpusRevisionId: revision._id,
                sourceId: source._id,
                decisionKey: `simulation:${source._id}`,
                decision: "accepted",
                reason: "Simulation precondition; no analyst judgment is asserted.",
                occurredAt: now,
            });
            await upsertSourceReviewItem(ctx, {
                runId: run._id,
                corpusRevisionId: revision._id,
                sourceId: source._id,
                decision: "accepted",
                sourceCreatedAt: source.createdAt,
                latestDecisionId: decisionId,
                decisionOccurredAt: now,
            });
        }
        if (run.workflowId) {
            await ctx.db.patch(run._id, { workflowId: undefined });
            await workflow.cancel(ctx, run.workflowId as WorkflowId);
        }
        await ctx.db.patch(revision._id, {
            status: "approved",
            approvedAt: now,
        });
        await ctx.db.patch(run._id, {
            lifecycleState: "corpus_approved",
            executionStatus: "idle",
            pauseReason: undefined,
            companySnapshot: run.companySnapshot
                ? {
                      ...run.companySnapshot,
                      legalName: "Agent harness simulation · Not live",
                  }
                : undefined,
        });
        const prepared = await ctx.db.get(run._id);
        if (!prepared) throw new Error("Fixture unavailable");
        const generation = await claimCorpusApprovedRunExecution(ctx, {
            visitor,
            run: prepared,
            now,
        });
        await ctx.db.patch(run._id, {
            nextEventSequence: run.nextEventSequence + 1,
        });
        await ctx.db.insert("runEvents", {
            runId: run._id,
            sequence: run.nextEventSequence + 1,
            type: "run_transitioned",
            lifecycleState: "extracting_evidence",
            executionStatus: "running",
            occurredAt: now,
        });
        const missionId: Id<"agentMissions"> = await ctx.runMutation(
            internal.execution.missions.start,
            {
                runId: run._id,
                corpusRevisionId: revision._id,
                definitionId: "saved_material_inspection_v1",
                requestKey: "local-simulation",
                expectedGeneration: generation,
            },
        );
        await ctx.runMutation(internal.execution.missions.resume, {
            missionId,
            expectedGeneration: generation,
            simulation: true,
        });
        return missionId;
    },
});

export const inspect = internalQuery({
    args: { missionId: v.id("agentMissions") },
    handler: async (ctx, args) => {
        const visitor = await requireBrowserTestOwner(ctx, BROWSER_TEST_SLOT);
        const contextId = await requireBrowserFixtureContext(ctx, visitor);
        const mission = await ctx.db.get(args.missionId);
        const run = mission ? await ctx.db.get(mission.runId) : null;
        if (
            !mission ||
            run?.purpose !== "browser_test" ||
            run.ownerVisitorId !== visitor._id ||
            run.browserTestContextId !== contextId ||
            !["local-simulation", "local-validation"].includes(
                mission.requestKey,
            )
        )
            throw new Error("Local simulation scope required");
        const invocations = await ctx.db
            .query("agentInvocations")
            .withIndex("by_mission", (q) => q.eq("missionId", mission._id))
            .take(21);
        const requests = await ctx.db
            .query("agentOperationRequests")
            .withIndex("by_mission", (q) => q.eq("missionId", mission._id))
            .take(21);
        const calls = await ctx.db
            .query("providerCalls")
            .withIndex("by_run", (q) => q.eq("runId", run._id))
            .take(2);
        if (invocations.length > 20 || requests.length > 20)
            throw new Error("Simulation inspection capacity exceeded");
        const quoted = requests.find(
            (request) => request.input.kind === "read_in_context",
        );
        const quotation =
            quoted?.outcome?.kind === "success"
                ? (
                      JSON.parse(quoted.outcome.valueJson) as {
                          passage?: { exactQuote?: string };
                      }
                  ).passage?.exactQuote
                : undefined;
        return {
            runId: run._id,
            status: mission.status,
            blockCode: mission.blockCode ?? null,
            provenance: mission.provenance,
            operations: requests.map((request) => request.input.kind),
            outcomes: requests.map((request) => request.outcome?.kind ?? null),
            invocationCount: invocations.length,
            observedInvocationCount: invocations.filter(
                (invocation) => invocation.receivedOutputJson,
            ).length,
            contextIncludesReturnedQuotation:
                !!quotation &&
                invocations.some((invocation) =>
                    invocation.inputJson.includes(
                        JSON.stringify(quotation).slice(1, -1),
                    ),
                ),
            providerCallCount: calls.length,
            completionCount:
                "protocolVersion" in mission
                    ? mission.result?.kind === "saved_material_inspection_v1"
                        ? mission.result.captureIds.length
                        : 0
                    : mission.completionRefs.length,
        };
    },
});
