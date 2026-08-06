import schema from "@convex/schema";
import { makeFunctionReference } from "convex/server";
import { convexTest } from "convex-test";
import { expect, test } from "vitest";

const modules = import.meta.glob("/convex/**/*.ts");

const createDraft = makeFunctionReference<
    "mutation",
    Record<string, never>,
    string
>("researchRuns:createDraft");
const transition = makeFunctionReference<
    "mutation",
    {
        runId: string;
        expectedExecutionGeneration: number;
        lifecycleState:
            | "checking_public_evidence"
            | "discovering_sources"
            | "awaiting_source_review";
        executionStatus: "running" | "paused";
        stepKey: "check_public_evidence" | "discover_sources" | "source_review";
    },
    null
>("researchRuns:transition");
const getRun = makeFunctionReference<"query", { runId: string }, unknown>(
    "researchRuns:get",
);
const listRunEvents = makeFunctionReference<
    "query",
    { runId: string },
    Array<unknown>
>("researchRuns:listEvents");
const listSteps = makeFunctionReference<
    "query",
    { runId: string },
    Array<unknown>
>("researchRuns:listSteps");
const appendAuditEvent = makeFunctionReference<
    "mutation",
    {
        action: "invitation_seeded" | "quota_restored";
        targetType: string;
        targetId: string;
        reason?: string;
    },
    string
>("audit:appendSystemEvent");
const listAuditEvents = makeFunctionReference<
    "query",
    { targetType: string; targetId: string },
    Array<unknown>
>("audit:listByTarget");

test("a draft research run begins with the public-evidence check", async () => {
    const t = convexTest(schema, modules);
    const runId = await t.mutation(createDraft, {});

    await t.mutation(transition, {
        runId,
        expectedExecutionGeneration: 0,
        lifecycleState: "checking_public_evidence",
        executionStatus: "running",
        stepKey: "check_public_evidence",
    });

    await expect(t.query(getRun, { runId })).resolves.toMatchObject({
        lifecycleState: "checking_public_evidence",
        executionStatus: "running",
    });
    await expect(t.query(listRunEvents, { runId })).resolves.toMatchObject([
        { sequence: 1, type: "run_created", lifecycleState: "draft" },
        {
            sequence: 2,
            type: "run_transitioned",
            lifecycleState: "checking_public_evidence",
            executionStatus: "running",
        },
    ]);
});

test("a research run can pause at the source-review checkpoint", async () => {
    const t = convexTest(schema, modules);
    const runId = await t.mutation(createDraft, {});
    await t.mutation(transition, {
        runId,
        expectedExecutionGeneration: 0,
        lifecycleState: "checking_public_evidence",
        executionStatus: "running",
        stepKey: "check_public_evidence",
    });
    await t.mutation(transition, {
        runId,
        expectedExecutionGeneration: 0,
        lifecycleState: "discovering_sources",
        executionStatus: "running",
        stepKey: "discover_sources",
    });

    await t.mutation(transition, {
        runId,
        expectedExecutionGeneration: 0,
        lifecycleState: "awaiting_source_review",
        executionStatus: "paused",
        stepKey: "source_review",
    });

    await expect(t.query(getRun, { runId })).resolves.toMatchObject({
        lifecycleState: "awaiting_source_review",
        executionStatus: "paused",
        pauseReason: "source_review",
    });
    await expect(t.query(listSteps, { runId })).resolves.toEqual(
        expect.arrayContaining([
            expect.objectContaining({
                key: "discover_sources",
                state: "completed",
            }),
            expect.objectContaining({
                key: "source_review",
                state: "needs_review",
            }),
        ]),
    );
});

test("an invalid lifecycle transition is rejected without appending progress", async () => {
    const t = convexTest(schema, modules);
    const runId = await t.mutation(createDraft, {});

    await expect(
        t.mutation(transition, {
            runId,
            expectedExecutionGeneration: 0,
            lifecycleState: "awaiting_source_review",
            executionStatus: "paused",
            stepKey: "source_review",
        }),
    ).rejects.toThrow("Invalid research run transition");
    await expect(t.query(listRunEvents, { runId })).resolves.toHaveLength(1);
});

test("a stale execution generation is rejected without appending progress", async () => {
    const t = convexTest(schema, modules);
    const runId = await t.mutation(createDraft, {});

    await expect(
        t.mutation(transition, {
            runId,
            expectedExecutionGeneration: 1,
            lifecycleState: "checking_public_evidence",
            executionStatus: "running",
            stepKey: "check_public_evidence",
        }),
    ).rejects.toThrow("Stale research execution generation");
    await expect(t.query(listRunEvents, { runId })).resolves.toHaveLength(1);
});

test("audit history preserves every administrative event", async () => {
    const t = convexTest(schema, modules);

    await t.mutation(appendAuditEvent, {
        action: "invitation_seeded",
        targetType: "invitation_set",
        targetId: "prototype",
    });
    await t.mutation(appendAuditEvent, {
        action: "quota_restored",
        targetType: "research_run",
        targetId: "run-1",
        reason: "Provider outage before paid work started",
    });

    await expect(
        t.query(listAuditEvents, {
            targetType: "research_run",
            targetId: "run-1",
        }),
    ).resolves.toMatchObject([
        {
            action: "quota_restored",
            reason: "Provider outage before paid work started",
        },
    ]);
});
