import { internal } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { historyPageValidator } from "@convex/execution/operationContracts";
import { MAX_OPERATION_RESULT_BYTES } from "@convex/resourcePolicy";
import { validate } from "convex-helpers/validators";
import { afterEach, assert, expect, test, vi } from "vitest";
import {
    beginFixtureInvocation,
    dispatchFixtureOperation,
} from "@/__tests__/setup/pi-mission";
import { readRetainedBody } from "@/__tests__/setup/retained-history";
import { seedCapturedSources } from "@/__tests__/setup/sources-mission";

afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
});
async function refusedProposal(
    text = "Rejected proposal must remain inspectable",
) {
    const f = await seedCapturedSources();
    const begun = await beginFixtureInvocation(f.t, {
        missionId: f.missionId,
        expectedGeneration: 4,
        taskKey: "recover-refusal",
        provenance: "simulation",
    });
    assert(begun.kind === "ready");
    const response = {
        kind: "complete" as const,

        needs: [{ needId: "nonexistent", unfinished: [text] }],
    };
    const result = await f.t.mutation(internal.execution.invocations.finish, {
        invocationId: begun.invocationId,
        expectedGeneration: 4,
        response,
    });
    expect(result).toMatchObject({
        kind: "blocked",
        code: "completion_correction_required",
    });
    const event = await f.t.run((ctx) =>
        ctx.db
            .query("agentExecutionEvents")
            .withIndex("by_invocation_and_kind", (q) =>
                q
                    .eq("invocationId", begun.invocationId)
                    .eq("kind", "invocation_refused"),
            )
            .first(),
    );
    assert(event);
    return { ...f, event, response };
}
async function consult(
    f: Awaited<ReturnType<typeof refusedProposal>>,
    args: { reference?: Id<"agentExecutionEvents">; cursor?: string } = {},
) {
    const requestId = await f.t.mutation(
        internal.execution.operations.enqueue,
        {
            missionId: f.missionId,
            expectedGeneration: 4,
            cause: "inspect-refusal",
            input: { kind: "consult_mission_state", ...args },
        },
    );
    return dispatchFixtureOperation(f.t, {
        requestId,
        expectedGeneration: 4,
    });
}

test("mission history exposes the refused proposal and its correction without rewriting original bytes", async () => {
    const f = await refusedProposal();
    const read = await consult(f);
    assert(read.kind === "success");
    expect(read.valueJson).toContain(
        "Rejected proposal must remain inspectable",
    );
    expect(read.valueJson).toContain("sources_needs_unaccounted");
    const invocationId = f.event.invocationId;
    assert(invocationId);
    const stored = await f.t.run((ctx) => ctx.db.get(invocationId));
    expect(JSON.parse(stored?.outputJson ?? "null")).toEqual(f.response);
});

test("current state points to a directly readable refused observation", async () => {
    const f = await refusedProposal();
    const context = await f.t.query(internal.execution.context.build, {
        missionId: f.missionId,
        expectedGeneration: 4,
    });
    assert(context.kind === "ready");
    expect(
        JSON.parse(context.inputJson).lastObservableInvocation.historyReference,
    ).toBe(f.event._id);
    const read = await consult(f, { reference: f.event._id });
    assert(read.kind === "success");
    expect(read.valueJson).toContain(
        "Rejected proposal must remain inspectable",
    );
});

test("targeted recovery fragments a large refused proposal and repeated fragments earn no new progress", async () => {
    // Each unit costs eight bytes in response JSON, ten when embedded in a history page.
    const f = await refusedProposal(
        `${'é🙂"'.repeat(Math.floor(MAX_OPERATION_RESULT_BYTES / 10))}END-OF-REFUSED-PROPOSAL`,
    );
    let result = await consult(f, { reference: f.event._id });
    assert(result.kind === "success");
    const first: unknown = JSON.parse(result.valueJson).history;
    assert(validate(historyPageValidator, first));
    assert(
        first.continueCursor,
        "The fixture must require a genuine continuation",
    );
    const firstEntry = first.entries[0];
    assert(firstEntry);
    const before = await f.t.run((ctx) => ctx.db.get(f.missionId));
    const repeated = await consult(f, { reference: f.event._id });
    assert(repeated.kind === "success");
    expect(
        (await f.t.run((ctx) => ctx.db.get(f.missionId)))?.progressKeys,
    ).toEqual(before?.progressKeys);
    expect(JSON.parse(repeated.valueJson).history.entries).toEqual(
        first.entries,
    );
    let content = "";
    const cursors = new Set<string>();
    let history = first;
    while (true) {
        expect(
            new TextEncoder().encode(result.valueJson).length,
        ).toBeLessThanOrEqual(MAX_OPERATION_RESULT_BYTES);
        expect(history.entries.length).toBeGreaterThan(0);
        for (const entry of history.entries) {
            expect(entry).toMatchObject({
                sequence: f.event.sequence,
                offset: content.length,
                totalCharacters: firstEntry.totalCharacters,
            });
            expect(entry.content.length).toBeGreaterThan(0);
            content += entry.content;
        }
        expect(content.length).toBeLessThanOrEqual(firstEntry.totalCharacters);
        const cursor = history.continueCursor;
        if (cursor === null) break;
        expect(cursors.has(cursor)).toBe(false);
        cursors.add(cursor);
        result = await consult(f, { cursor });
        assert(result.kind === "success");
        const next: unknown = JSON.parse(result.valueJson).history;
        assert(validate(historyPageValidator, next));
        history = next;
    }
    expect(cursors.size).toBeGreaterThan(0);
    expect(content.length).toBe(firstEntry.totalCharacters);
    const restored = JSON.parse(content);
    expect(restored.event._id).toBe(f.event._id);
    expect(restored.observation.state).toBe("complete");
    expect(restored.observation.value.response).toEqual(f.response);
});

test("recovery rejects foreign and mixed references without exposing their content", async () => {
    const f = await refusedProposal();
    const foreign = await f.t.run(async (ctx) => {
        const original = await ctx.db.get(f.missionId);
        assert(original);
        const { _id, _creationTime, ...record } = original;
        const missionId = await ctx.db.insert("agentMissions", {
            ...record,
            requestKey: "foreign-history",
        });
        return ctx.db.insert("agentExecutionEvents", {
            kind: "mission_started",
            cause: "foreign",
            missionId,
            runId: f.runId,
            sequence: 1,
            occurredAt: 1,
        });
    });
    expect(await consult(f, { reference: foreign })).toMatchObject({
        kind: "refused",
        code: "history_reference_unavailable",
    });
    expect(
        await consult(f, { reference: f.event._id, cursor: "history:forged" }),
    ).toMatchObject({ kind: "refused", code: "history_reference_invalid" });
});

test("reading a consultation's audit observation does not manufacture restoration credit", async () => {
    const f = await refusedProposal();
    await consult(f, { reference: f.event._id });
    const context = await f.t.query(internal.execution.context.build, {
        missionId: f.missionId,
        expectedGeneration: 4,
    });
    assert(context.kind === "ready");
    const request = JSON.parse(
        context.inputJson,
    ).triggeringRequestsAndResults.find(
        (r: { input: { kind: string } }) =>
            r.input.kind === "consult_mission_state",
    );
    assert(request?.historyReference);
    const before = await f.t.run((ctx) => ctx.db.get(f.missionId));
    const read = await consult(f, { reference: request.historyReference });
    assert(read.kind === "success");
    expect(
        (await f.t.run((ctx) => ctx.db.get(f.missionId)))?.progressKeys,
    ).toEqual(before?.progressKeys);
});

test("historical refusals without an immutable proposal explicitly disclose incomplete observation", async () => {
    const f = await refusedProposal();
    assert(f.event.sequence);
    const reference = await f.t.run((ctx) =>
        ctx.db.insert("agentExecutionEvents", {
            kind: "invocation_refused",
            cause: "historical-refusal",
            missionId: f.missionId,
            runId: f.runId,
            invocationId: f.event.invocationId,
            sequence: (f.event.sequence ?? 0) + 1,
            occurredAt: 1,
        }),
    );
    const read = await consult(f, { reference });
    assert(read.kind === "success");
    expect(read.valueJson).toContain("invocation_observation_unavailable");
});

test("Sources correction identifies the affected need with its exact domain identity", async () => {
    const f = await seedCapturedSources();
    const preparation = await f.t.run((ctx) => ctx.db.get(f.preparationId));
    assert(preparation?.sourcesMission);
    const data = preparation.sourcesMission;
    const begun = await beginFixtureInvocation(f.t, {
        missionId: f.missionId,
        expectedGeneration: 4,
        taskKey: "need-diagnostic",
        provenance: "simulation",
    });
    assert(begun.kind === "ready");
    const result = await f.t.mutation(internal.execution.invocations.finish, {
        invocationId: begun.invocationId,
        expectedGeneration: 4,
        response: {
            kind: "complete",

            needs: data.needs.map((need) => ({
                needId: need.id,

                unfinished: [],
            })),
        },
    });
    expect(result).toMatchObject({
        kind: "blocked",
        code: "completion_correction_required",
    });
    const affected = data.needs[0]?.id;
    assert(affected);
    expect(JSON.stringify(result.correction)).toContain(affected);
});

test("the real Pi worker corrects Sources completion after non-progress consultations and preserves its gaps", async () => {
    const f = await seedCapturedSources({
        modelResponse(input) {
            const state = input as {
                triggeringRequestsAndResults: { input: { kind: string } }[];
                activeWork: {
                    noProgressTurns: number;
                    needsRevision: number;
                    needs: { id: string }[];
                    work: {
                        requestId: Id<"agentOperationRequests">;
                        needIds: string[];
                    }[];
                };
                lastObservableInvocation?: {
                    historyReference?: Id<"agentExecutionEvents">;
                    correction?: unknown;
                };
            };
            const restored = state.triggeringRequestsAndResults.some(
                (request) => request.input.kind === "consult_mission_state",
            );
            if (!restored) {
                if (state.lastObservableInvocation?.correction) {
                    assert(state.lastObservableInvocation.historyReference);
                    return {
                        kind: "operations",
                        requests: [
                            {
                                callId: "recover-proposal",
                                name: "consult_mission_state",
                                inputJson: JSON.stringify({
                                    reference:
                                        state.lastObservableInvocation
                                            .historyReference,
                                }),
                            },
                        ],
                    };
                }
                if (state.activeWork.noProgressTurns < 2)
                    return {
                        kind: "operations",
                        requests: [
                            {
                                callId: `state-${state.activeWork.noProgressTurns + 1}`,
                                name: "consult_run_state",
                                inputJson: "{}",
                            },
                        ],
                    };
                return {
                    kind: "complete",
                    needs: [
                        {
                            needId: "invented",
                            unfinished: ["REFUSED-PROPOSAL-TO-RECOVER"],
                        },
                    ],
                };
            }
            return {
                kind: "complete",

                needs: state.activeWork.needs.map((need) => ({
                    needId: need.id,

                    unfinished: [
                        "No controlled contributions were prepared in this simulated recovery.",
                    ],
                })),
                workingNotes: "Recovery completed once.",
            };
        },
    });
    vi.useFakeTimers();
    vi.stubEnv("E2E_FIXTURES_ENABLED", "true");
    vi.stubEnv("CONVEX_CLOUD_URL", "http://127.0.0.1:3210");
    await f.t.run((ctx) =>
        ctx.db.patch(f.invitationId, { slotKey: "analyst-4" }),
    );
    const contextId = await f.t.mutation(
        internal.runWorkspace.openBrowserTestContext,
        {
            slotKey: "analyst-4",
            contextKey: "shared-recovery-worker",
            durationMs: 60000,
        },
    );
    await f.t.run(async (ctx) => {
        const framingId = await ctx.db.insert("framingRevisions", {
            runId: f.runId,
            revision: 1,
            content: { scope: "Workflow economics", questions: [] },
            requestKey: "recovery-worker-framing",
            contentHash: "fixture",
            origin: "analyst",
            createdAt: 1,
        });
        await ctx.db.patch(f.runId, {
            purpose: "browser_test",
            browserTestContextId: contextId,
            startMode: "framed",
            agentExecutionVersion: 3,
            fixedFramingRevisionId: framingId,
        });
    });
    vi.stubGlobal(
        "fetch",
        vi.fn(() => {
            throw new Error("Unexpected external I/O");
        }),
    );
    const { seedPiHistory } = await import("@/__tests__/setup/pi-mission");
    await seedPiHistory(f.t, f.missionId, 4, 8, 16250);
    await f.t.mutation(internal.execution.missions.resume, {
        missionId: f.missionId,
        expectedGeneration: 4,
        simulation: true,
    });
    await f.t.finishAllScheduledFunctions(
        () => vi.advanceTimersByTime(10),
        500,
    );
    const mission = await f.t.run((ctx) => ctx.db.get(f.missionId));
    expect(mission?.blockCode).toBeUndefined();
    expect(mission?.status).toBe("completed");
    assert(mission && "protocolVersion" in mission && mission.resultTextId);
    expect(mission).not.toHaveProperty("result");
    const result = JSON.parse(
        await readRetainedBody(f.t, mission.resultTextId),
    );
    expect(result).toMatchObject({
        material: {
            outcome: "blocked",
            needs: [
                {
                    needId: "common-context",
                    unfinished: [
                        "No controlled contributions were prepared in this simulated recovery.",
                    ],
                },
            ],
        },
    });
    expect(
        mission?.workingNotes?.split("Recovery completed once."),
    ).toHaveLength(2);
    const requests = await f.t.run((ctx) =>
        ctx.db
            .query("agentOperationRequests")
            .withIndex("by_mission", (q) => q.eq("missionId", f.missionId))
            .collect(),
    );
    const recovery = requests.filter(
        (request) => request.input.kind === "consult_mission_state",
    );
    expect(recovery).toHaveLength(1);
    expect(JSON.stringify(recovery[0]?.outcome)).toContain(
        "REFUSED-PROPOSAL-TO-RECOVER",
    );
    expect(
        await f.t.run((ctx) => ctx.db.query("providerCalls").collect()),
    ).toEqual([]);
    const invocations = await f.t.run((ctx) =>
        ctx.db
            .query("agentInvocations")
            .withIndex("by_mission", (q) => q.eq("missionId", f.missionId))
            .collect(),
    );
    expect(
        invocations.filter((invocation) => !invocation.purpose),
    ).toHaveLength(5);
    const rejected = invocations.find((invocation) => invocation.correction);
    expect(rejected).toMatchObject({
        blockCode: "completion_correction_required",
    });
    expect(
        JSON.parse(rejected?.inputJson ?? "null").activeWork.noProgressTurns,
    ).toBe(2);
    expect(
        invocations.some((invocation) => invocation.purpose === "compaction"),
    ).toBe(true);
}, 30000);
