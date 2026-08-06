import { evaluatePublicEvidenceAvailability } from "@convex/domain/evidenceAvailabilityPolicy";
import type { Id } from "@convex/_generated/dataModel";
import schema from "@convex/schema";
import { makeFunctionReference } from "convex/server";
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";

describe("evaluatePublicEvidenceAvailability", () => {
    test.each([
        {
            input: {
                secFilingCount: 1,
                investorRelationsPresent: false,
                manualCandidateCount: 0,
            },
            evidence: "sec_filing_available",
        },
        {
            input: {
                secFilingCount: 0,
                investorRelationsPresent: true,
                manualCandidateCount: 0,
            },
            evidence: "investor_relations_available",
        },
        {
            input: {
                secFilingCount: 0,
                investorRelationsPresent: false,
                manualCandidateCount: 1,
            },
            evidence: "manual_candidate_available",
        },
    ])("continues when $evidence", ({ input }) => {
        expect(evaluatePublicEvidenceAvailability(input)).toEqual({
            policyVersion: "public-evidence-v1",
            ...input,
            outcome: "sufficient",
            reasons: [],
        });
    });

    test("pauses when no public evidence is available", () => {
        expect(
            evaluatePublicEvidenceAvailability({
                secFilingCount: 0,
                investorRelationsPresent: false,
                manualCandidateCount: 0,
            }),
        ).toEqual({
            policyVersion: "public-evidence-v1",
            secFilingCount: 0,
            investorRelationsPresent: false,
            manualCandidateCount: 0,
            outcome: "insufficient",
            reasons: ["no_public_evidence_candidates"],
        });
    });
});

const modules = import.meta.glob("/convex/**/*.ts");
const createDraft = makeFunctionReference<
    "mutation",
    Record<string, never>,
    Id<"researchRuns">
>("researchRuns:createDraft");
const evaluateForRun = makeFunctionReference<
    "mutation",
    {
        runId: Id<"researchRuns">;
        expectedExecutionGeneration: number;
        secFilingCount: number;
        investorRelationsPresent: boolean;
    },
    { outcome: "sufficient" | "insufficient" }
>("evidenceSufficiency:evaluateForRun");
const transition = makeFunctionReference<
    "mutation",
    {
        runId: Id<"researchRuns">;
        expectedExecutionGeneration: number;
        lifecycleState: "checking_public_evidence";
        executionStatus: "running";
        stepKey: "check_public_evidence";
    },
    null
>("researchRuns:transition");
const decideSufficiency = makeFunctionReference<
    "mutation",
    {
        runId: Id<"researchRuns">;
        decision: { kind: "recheck"; decisionKey: string };
    },
    { accepted: boolean }
>("evidenceSufficiency:decide");

test("persists an insufficient evaluation for the workflow", async () => {
    const t = convexTest(schema, modules);
    const runId = await t.mutation(createDraft, {});
    await t.mutation(transition, {
        runId,
        expectedExecutionGeneration: 0,
        lifecycleState: "checking_public_evidence",
        executionStatus: "running",
        stepKey: "check_public_evidence",
    });

    await expect(
        t.mutation(evaluateForRun, {
            runId,
            expectedExecutionGeneration: 0,
            secFilingCount: 0,
            investorRelationsPresent: false,
        }),
    ).resolves.toMatchObject({ outcome: "insufficient" });
    await expect(
        t.run(async (ctx) =>
            ctx.db.query("evidenceAvailabilityEvaluations").collect(),
        ),
    ).resolves.toEqual([
        expect.objectContaining({
            runId,
            policyVersion: "public-evidence-v1",
            manualCandidateCount: 0,
            outcome: "insufficient",
        }),
    ]);
});

test("rejects a stale sufficiency evaluation without persisted progress", async () => {
    const t = convexTest(schema, modules);
    const runId = await t.mutation(createDraft, {});
    await t.mutation(transition, {
        runId,
        expectedExecutionGeneration: 0,
        lifecycleState: "checking_public_evidence",
        executionStatus: "running",
        stepKey: "check_public_evidence",
    });

    await expect(
        t.mutation(evaluateForRun, {
            runId,
            expectedExecutionGeneration: 1,
            secFilingCount: 1,
            investorRelationsPresent: true,
        }),
    ).rejects.toThrow("Stale research execution generation");
    await expect(
        t.run(async (ctx) =>
            ctx.db.query("evidenceAvailabilityEvaluations").collect(),
        ),
    ).resolves.toHaveLength(0);
});

test("does not resume while another visitor workflow is running", async () => {
    const t = convexTest(schema, modules);
    const { userId, pausedRunId } = await t.run(async (ctx) => {
        const userId = await ctx.db.insert("users", { isAnonymous: true });
        const invitationId = await ctx.db.insert("invitations", {
            slotKey: "resume-analyst",
            role: "analyst",
            codeDigest: "resume-digest",
            status: "claimed",
            createdAt: 1,
        });
        const visitorId = await ctx.db.insert("visitors", {
            authUserId: userId,
            invitationId,
            role: "analyst",
            status: "active",
            analysesReserved: 2,
            admittedAt: 1,
        });
        const pausedRunId = await ctx.db.insert("researchRuns", {
            ownerVisitorId: visitorId,
            lifecycleState: "awaiting_evidence_sufficiency_review",
            executionStatus: "paused",
            pauseReason: "evidence_sufficiency_review",
            executionGeneration: 1,
            workflowId: "paused-workflow",
            nextEventSequence: 1,
            createdAt: 1,
            updatedAt: 1,
        });
        await ctx.db.insert("researchRuns", {
            ownerVisitorId: visitorId,
            lifecycleState: "discovering_sources",
            executionStatus: "running",
            executionGeneration: 1,
            workflowId: "running-workflow",
            nextEventSequence: 1,
            createdAt: 2,
            updatedAt: 2,
        });
        return { userId, pausedRunId };
    });
    const analyst = t.withIdentity({ subject: `${userId}|resume-session` });

    await expect(
        analyst.mutation(decideSufficiency, {
            runId: pausedRunId,
            decision: {
                kind: "recheck",
                decisionKey: "resume-paused-run",
            },
        }),
    ).rejects.toThrow("already running");
});
