import { internal } from "@convex/_generated/api";
import { getAgentDefinition } from "@convex/execution/agentCatalog";
import { recordMissionEvent } from "@convex/execution/authority";
import { projectMissionHistoryEvent } from "@convex/execution/journal";
import { afterEach, assert, expect, test, vi } from "vitest";
import {
    dispatchHistory,
    runHistoryTurn,
    seedHistoryMission,
} from "@/__tests__/setup/execution-history";
import {
    beginFixtureInvocation,
    claimFixtureOperation,
} from "@/__tests__/setup/pi-mission";

afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    vi.useRealTimers();
});

test("progress_capacity_is_atomic_and_replays_add_nothing", async () => {
    const { adoptProgress } = await import("@convex/execution/progress");
    const current = Array.from({ length: 256 }, (_, i) => `fact:${i}`);
    expect(adoptProgress(current, ["fact:0"])).toEqual({
        kind: "ready",
        keys: current,
        added: 0,
    });
    expect(adoptProgress(current, ["fact:256"])).toEqual({
        kind: "blocked",
        code: "context_capacity",
    });
    expect(current).toHaveLength(256);
});

test("three_fresh_mission_pages_do_not_trigger_repetition and replayed content adds no credit", async () => {
    const f = await seedHistoryMission();
    const sequence = await f.t.run(async (ctx) => {
        const mission = await ctx.db.get(f.missionId);
        assert(mission);
        await recordMissionEvent(ctx, mission, {
            kind: "retained_evidence",
            cause: "preserved",
            historySource: "material",
            observation: { text: "Original evidence 😀".repeat(8000) },
        });
        return mission.nextEventSequence;
    });
    let cursor: string | undefined;
    let lastCursor: string | undefined;
    let previousCount = 0;
    const offsets = new Map<number, number>();
    let observedTargetPages = 0;
    for (let page = 0; page < 3; page++) {
        lastCursor = cursor;
        const result = await runHistoryTurn(f, {
            kind: "consult_mission_state",
            cursor,
        });
        assert(result.outcome.kind === "success");
        const history = JSON.parse(result.outcome.valueJson).history;
        expect(history.entries.length).toBeGreaterThan(0);
        for (const entry of history.entries as {
            sequence: number;
            offset: number;
            content: string;
        }[]) {
            expect(entry.offset).toBe(offsets.get(entry.sequence) ?? 0);
            offsets.set(entry.sequence, entry.offset + entry.content.length);
            if (entry.sequence === sequence) observedTargetPages++;
        }
        expect(result.settlement).toMatchObject({ kind: "ready" });
        cursor = history.continueCursor;
        const current = await f.t.run((ctx) => ctx.db.get(f.missionId));
        assert(current);
        const count = current.progressKeys.length;
        expect(count).toBeGreaterThan(previousCount);
        previousCount = count;
    }
    expect(observedTargetPages).toBeGreaterThanOrEqual(2);
    const reread = await runHistoryTurn(f, {
        kind: "consult_mission_state",
        cursor: lastCursor,
    });
    assert(reread.outcome.kind === "success");
    expect(
        (await f.t.run((ctx) => ctx.db.get(f.missionId)))?.progressKeys,
    ).toHaveLength(previousCount);
    await Promise.all(
        [1, 2].map(() =>
            f.t.mutation(internal.execution.operations.recordResult, {
                requestId: reread.requestId,
                expectedGeneration: 1,
                outcome: reread.outcome,
            }),
        ),
    );
    expect(
        (await f.t.run((ctx) => ctx.db.get(f.missionId)))?.progressKeys,
    ).toHaveLength(previousCount);
});

test("capacity retains the observation without partial accounting or adoption", async () => {
    const f = await seedHistoryMission();
    const keys = Array.from({ length: 256 }, (_, i) => `existing:${i}`);
    await f.t.run((ctx) => ctx.db.patch(f.missionId, { progressKeys: keys }));
    const result = await dispatchHistory(f, { kind: "consult_conversation" });
    expect(result.outcome.kind).toBe("success");
    expect(await f.t.run((ctx) => ctx.db.get(result.requestId))).toMatchObject({
        outcome: result.outcome,
        adoptionRefusalCode: "context_capacity",
    });
    expect(await f.t.run((ctx) => ctx.db.get(f.missionId))).toMatchObject({
        progressKeys: keys,
        status: "blocked",
        blockCode: "context_capacity",
    });
});

test.each([
    "validator",
    "reducer",
] as const)("a throwing %s preserves the known observation and blocks adoption", async (phase) => {
    const f = await seedHistoryMission();
    const { conversationValidationDefinition } = await import(
        "@convex/domain/conversationValidation"
    );
    const { fixtureResult } = await import(
        "@convex/domain/conversationValidationOperations"
    );
    const definition = getAgentDefinition("conversation_validation_v1");
    const input =
        phase === "validator"
            ? { kind: "consult_run_state" as const }
            : { kind: "wait_fixture_result" as const, value: 7 };
    const requestId = await f.t.mutation(
        internal.execution.operations.enqueue,
        {
            missionId: f.missionId,
            expectedGeneration: 1,
            cause: "fault",
            input,
        },
    );
    const known = {
        kind: "success" as const,
        valueJson:
            phase === "validator"
                ? JSON.stringify(
                      await f.t.query(
                          internal.execution.operations.readRunState,
                          {
                              runId: f.runId,
                              missionId: f.missionId,
                              expectedGeneration: 1,
                          },
                      ),
                  )
                : fixtureResult(7),
    };
    await claimFixtureOperation(f.t, {
        requestId,
        expectedGeneration: 1,
    });
    const operation = definition.operations.consult_run_state;
    assert(operation);
    if (phase === "validator")
        vi.spyOn(operation, "validateOutcome").mockImplementation(() => {
            throw new TypeError(
                "private validator detail; Authorization: Bearer synthetic-secret-4382; api_key=synthetic-key-4123; " +
                    JSON.stringify({ apiKey: "synthetic-json-1337" }) +
                    " https://user:synthetic-url-pass@example.test/?token=synthetic-query " +
                    "x".repeat(1000),
            );
        });
    else
        vi.spyOn(
            conversationValidationDefinition,
            "progress",
        ).mockImplementation(() => {
            throw new TypeError(
                "private reducer detail; Authorization: Bearer synthetic-secret-4382; api_key=synthetic-key-4123; " +
                    JSON.stringify({ apiKey: "synthetic-json-1337" }) +
                    " https://user:synthetic-url-pass@example.test/?token=synthetic-query " +
                    "x".repeat(1000),
            );
        });
    expect(
        await f.t.mutation(internal.execution.operations.recordResult, {
            requestId,
            expectedGeneration: 1,
            outcome: known,
        }),
    ).toEqual({ kind: "refused", code: "operation_adoption_failed" });
    expect(await f.t.run((ctx) => ctx.db.get(requestId))).toMatchObject({
        status: "completed",
        outcome: known,
        adoptionRefusalCode: "operation_adoption_failed",
    });
    expect(await f.t.run((ctx) => ctx.db.get(f.missionId))).toMatchObject({
        status: "blocked",
        blockCode: "operation_adoption_failed",
        progressKeys: [],
    });
    const diagnostic = await f.t.run(async (ctx) => {
        const event = await ctx.db
            .query("agentExecutionEvents")
            .withIndex("by_mission_and_kind", (q) =>
                q
                    .eq("missionId", f.missionId)
                    .eq("kind", "operation_adoption_failed"),
            )
            .unique();
        assert(event);
        return {
            event,
            projection: await projectMissionHistoryEvent(ctx, event),
        };
    });
    expect(diagnostic.event).toMatchObject({
        protectedDiagnostic: {
            phase:
                phase === "validator" ? "validate_outcome" : "reduce_progress",
            name: "TypeError",
            message: expect.stringContaining(`private ${phase} detail`),
            causeHash: expect.stringMatching(/^[a-f0-9]{64}$/),
        },
    });
    const detail = JSON.stringify(diagnostic.event.protectedDiagnostic);
    expect(detail.length).toBeLessThan(900);
    expect(detail).not.toContain("synthetic-secret-4382");
    expect(detail).not.toContain("synthetic-key-4123");
    expect(detail).not.toContain("synthetic-json-1337");
    expect(detail).not.toContain("synthetic-url-pass");
    expect(detail).not.toContain("synthetic-query");
    expect(diagnostic.projection.json).not.toContain("protectedDiagnostic");
    expect(diagnostic.projection.json).not.toContain(`private ${phase} detail`);
});

test("new draft observations cannot renew a restoration window, while material progress can", async () => {
    const f = await seedHistoryMission();
    const first = await dispatchHistory(f, { kind: "consult_mission_state" });
    assert(first.outcome.kind === "success");
    const current = await f.t.run((ctx) => ctx.db.get(f.missionId));
    assert(current);
    const keys = current.progressKeys;
    const begun = await beginFixtureInvocation(f.t, {
        missionId: f.missionId,
        expectedGeneration: 1,
        taskKey: "new-draft",
        provenance: "simulation",
    });
    assert(begun.kind === "ready");
    await f.t.mutation(internal.execution.invocations.finish, {
        invocationId: begun.invocationId,
        expectedGeneration: 1,
        response: { kind: "operations", requests: [] },
        rawOutputJson: JSON.stringify({
            text: "NEW DRAFT WITHOUT DOMAIN WORK",
        }),
    });
    const repeated = await dispatchHistory(f, {
        kind: "consult_mission_state",
    });
    assert(repeated.outcome.kind === "success");
    expect(repeated.outcome.valueJson).not.toContain(
        "NEW DRAFT WITHOUT DOMAIN WORK",
    );
    expect(
        (await f.t.run((ctx) => ctx.db.get(f.missionId)))?.progressKeys,
    ).toEqual(keys);
    await f.t.run(async (ctx) => {
        const mission = await ctx.db.get(f.missionId);
        assert(mission);
        await recordMissionEvent(ctx, mission, {
            kind: "verified_fact",
            cause: "external-material",
            historySource: "material",
            observation: { text: "NEW VERIFIED FACT" },
        });
    });
    const renewed = await dispatchHistory(f, { kind: "consult_mission_state" });
    assert(renewed.outcome.kind === "success");
    expect(renewed.outcome.valueJson).toContain("NEW VERIFIED FACT");
    expect(
        (await f.t.run((ctx) => ctx.db.get(f.missionId)))?.progressKeys.length,
    ).toBeGreaterThan(keys.length);
});

test("outcome-validation diagnostics survive an authority refusal after observation", async () => {
    const f = await seedHistoryMission();
    const operation = getAgentDefinition("conversation_validation_v1")
        .operations.consult_run_state;
    assert(operation);
    const requestId = await f.t.mutation(
        internal.execution.operations.enqueue,
        {
            missionId: f.missionId,
            expectedGeneration: 1,
            cause: "late-validation",
            input: { kind: "consult_run_state" },
        },
    );
    await claimFixtureOperation(f.t, {
        requestId,
        expectedGeneration: 1,
    });
    const known = {
        kind: "success" as const,
        valueJson: JSON.stringify(
            await f.t.query(internal.execution.operations.readRunState, {
                runId: f.runId,
                missionId: f.missionId,
                expectedGeneration: 1,
            }),
        ),
    };
    vi.spyOn(operation, "validateOutcome").mockImplementation(() => {
        throw new TypeError("Unexpected retained-shape mismatch");
    });
    await f.t.run((ctx) => ctx.db.patch(f.missionId, { status: "cancelled" }));
    expect(
        await f.t.mutation(internal.execution.operations.recordResult, {
            requestId,
            expectedGeneration: 1,
            outcome: known,
        }),
    ).toEqual({ kind: "refused", code: "mission_cancelled" });
    const observed = await f.t.run((ctx) =>
        ctx.db
            .query("agentExecutionEvents")
            .withIndex("by_mission_and_kind", (q) =>
                q.eq("missionId", f.missionId).eq("kind", "operation_observed"),
            )
            .unique(),
    );
    expect(observed).toMatchObject({
        protectedDiagnostic: {
            phase: "validate_outcome",
            name: "TypeError",
            message: "Unexpected retained-shape mismatch",
        },
    });
    expect(await f.t.run((ctx) => ctx.db.get(requestId))).toMatchObject({
        outcome: known,
    });
});
