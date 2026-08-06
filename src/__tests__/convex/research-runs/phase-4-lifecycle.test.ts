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
            | "awaiting_source_review"
            | "corpus_approved";
        executionStatus: "running" | "paused" | "idle";
        stepKey: "check_public_evidence" | "discover_sources" | "source_review";
    },
    null
>("researchRuns:transition");
const getRun = makeFunctionReference<"query", { runId: string }, unknown>(
    "researchRuns:get",
);
const listSteps = makeFunctionReference<
    "query",
    { runId: string },
    Array<unknown>
>("researchRuns:listSteps");

test("ends discovery at the corpus-approved handoff", async () => {
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
    await t.mutation(transition, {
        runId,
        expectedExecutionGeneration: 0,
        lifecycleState: "corpus_approved",
        executionStatus: "idle",
        stepKey: "source_review",
    });

    await expect(t.query(getRun, { runId })).resolves.toMatchObject({
        lifecycleState: "corpus_approved",
        executionStatus: "idle",
    });
    await expect(t.query(listSteps, { runId })).resolves.toEqual(
        expect.arrayContaining([
            expect.objectContaining({
                key: "source_review",
                state: "completed",
            }),
        ]),
    );
});
