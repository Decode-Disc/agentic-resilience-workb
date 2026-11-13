import "@convex/execution/agentCatalog";
import { internal } from "@convex/_generated/api";
import { sourcesDefinition } from "@convex/domain/sourcesAgent";
import type { SourcesPreparation } from "@convex/domain/sourcesContracts";
import { MAX_OPERATION_RESULT_BYTES } from "@convex/resourcePolicy";
import { afterEach, assert, expect, test, vi } from "vitest";
import { seedCapturedSources } from "@/__tests__/setup/sources-mission";

afterEach(() => {
    delete sourcesDefinition.simulate;
    vi.useRealTimers();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
});

test("a completion using another definition's schema receives field feedback before fresh completion", async () => {
    const f = await seedCapturedSources();
    const begun = await f.t.mutation(internal.execution.invocations.begin, {
        missionId: f.missionId,
        expectedGeneration: 4,
        taskKey: "wrong-completion-schema",
        provenance: "simulation",
    });
    assert(begun.kind === "ready");
    const response = {
        kind: "complete" as const,
        text: "Finished.",
        workingNotes: "Refused notes must not survive.",
    };
    const refused = await f.t.mutation(internal.execution.invocations.finish, {
        invocationId: begun.invocationId,
        expectedGeneration: 4,
        response,
    });
    expect(refused).toMatchObject({
        code: "completion_correction_required",
        correction: {
            code: "invalid_completion",
            issues: [
                expect.objectContaining({
                    path: expect.stringContaining("needs"),
                    expected: "array",
                }),
            ],
        },
    });
    expect(await f.t.run((ctx) => ctx.db.get(f.missionId))).toMatchObject({
        status: "ready",
        workingNotes: "",
        noProgressTurns: 1,
    });
    expect(
        await f.t.mutation(internal.execution.invocations.finish, {
            invocationId: begun.invocationId,
            expectedGeneration: 4,
            response,
        }),
    ).toEqual(refused);
    const next = await f.t.mutation(internal.execution.invocations.begin, {
        missionId: f.missionId,
        expectedGeneration: 4,
        taskKey: "fresh-completion-schema",
        provenance: "simulation",
    });
    assert(next.kind === "ready");
    const context = JSON.parse(next.inputJson);
    expect(context.lastObservableInvocation.correction).toEqual(
        refused.correction,
    );
    const complete = await f.t.mutation(internal.execution.invocations.finish, {
        invocationId: next.invocationId,
        expectedGeneration: 4,
        response: {
            kind: "complete",
            needs: context.activeWork.needs.map((need: { id: string }) => ({
                needId: need.id,
                unfinished: ["Not examined"],
            })),
        },
    });
    expect(complete.kind).toBe("completed");
    expect(
        await f.t.run((ctx) => ctx.db.get(begun.invocationId)),
    ).toMatchObject({
        outputJson: expect.any(String),
        correction: refused.correction,
    });
});

test.each([
    800, 1000,
])("an oversized need array receives bounded correction without rewriting its response: %s", async (rowCount) => {
    const f = await seedCapturedSources();
    const begun = await f.t.mutation(internal.execution.invocations.begin, {
        missionId: f.missionId,
        expectedGeneration: 4,
        taskKey: "excess-need-feedback",
        provenance: "simulation",
    });
    assert(begun.kind === "ready");
    const response = {
        kind: "complete" as const,

        workingNotes: "These notes must not enter working memory.",
        needs: Array.from({ length: rowCount }, () => ({
            needId: "x",

            unfinished: [" "],
            gap: " ",
        })),
    };
    expect(
        new TextEncoder().encode(JSON.stringify(response)).byteLength,
    ).toBeLessThanOrEqual(MAX_OPERATION_RESULT_BYTES);
    const result = await f.t.mutation(internal.execution.invocations.finish, {
        invocationId: begun.invocationId,
        expectedGeneration: 4,
        response,
    });
    expect(result).toMatchObject({
        kind: "blocked",
        code: "completion_correction_required",
    });
    assert("correction" in result && result.correction);
    expect(
        new TextEncoder().encode(JSON.stringify(result.correction)).byteLength,
    ).toBeLessThanOrEqual(MAX_OPERATION_RESULT_BYTES);
    const invocation = await f.t.run((ctx) => ctx.db.get(begun.invocationId));
    expect(JSON.parse(invocation?.outputJson ?? "null")).toEqual(response);
    expect(
        (await f.t.run((ctx) => ctx.db.get(f.missionId)))?.workingNotes,
    ).toBe("");
});

test.each([
    false,
    true,
])("Pi corrects missing need accounting, bounded when repeated: %s", async (repeat) => {
    vi.useFakeTimers();
    vi.stubEnv("E2E_FIXTURES_ENABLED", "true");
    vi.stubEnv("CONVEX_CLOUD_URL", "http://127.0.0.1:3212");
    const network = vi.fn(() => {
        throw new Error("Provider forbidden");
    });
    vi.stubGlobal("fetch", network);
    const f = await seedCapturedSources();
    await f.t.run(async (ctx) => {
        const id = await ctx.db.insert("framingRevisions", {
            runId: f.runId,
            revision: 1,
            content: { scope: "Workflow", questions: [] },
            requestKey: "correction",
            contentHash: "fixture",
            origin: "analyst",
            createdAt: 1,
        });
        await ctx.db.patch(f.runId, {
            startMode: "framed",
            agentExecutionVersion: 3,
            fixedFramingRevisionId: id,
        });
        await ctx.db.patch(f.invitationId, { slotKey: "analyst-4" });
    });
    const contextId = await f.t.mutation(
        internal.runWorkspace.openBrowserTestContext,
        { slotKey: "analyst-4", contextKey: "correction", durationMs: 120000 },
    );
    await f.t.run((ctx) =>
        ctx.db.patch(f.runId, {
            purpose: "browser_test",
            browserTestContextId: contextId,
        }),
    );
    sourcesDefinition.simulate = (input: unknown) => {
        const { activeWork } = input as {
            activeWork: SourcesPreparation & { noProgressTurns: number };
        };
        return {
            kind: "complete",

            workingNotes: "Completion note.",
            needs:
                repeat || activeWork.noProgressTurns === 0
                    ? []
                    : activeWork.needs.map((n) => ({
                          needId: n.id,
                          unfinished: ["Not yet examined"],
                      })),
        };
    };
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
    assert(mission);
    const invocations = await f.t.run((ctx) =>
        ctx.db
            .query("agentInvocations")
            .withIndex("by_mission", (q) => q.eq("missionId", f.missionId))
            .collect(),
    );
    expect(mission.status).toBe(repeat ? "blocked" : "completed");
    expect(invocations).toHaveLength(repeat ? 3 : 2);
    assert(invocations[0]);
    expect(invocations[0].outputJson).toContain('"needs":[]');
    const correctiveInputs = await f.t.run(async (ctx) =>
        Promise.all(
            invocations.slice(1).map(async (invocation, index) => {
                const previous = invocations[index];
                assert(previous);
                const reply = await ctx.db
                    .query("agentInvocationPayloads")
                    .withIndex("by_invocation_and_part", (q) =>
                        q.eq("invocationId", previous._id).eq("part", "reply"),
                    )
                    .unique();
                const request = await ctx.db
                    .query("agentInvocationPayloads")
                    .withIndex("by_invocation_and_part", (q) =>
                        q
                            .eq("invocationId", invocation._id)
                            .eq("part", "request"),
                    )
                    .unique();
                assert(reply?.state === "complete" && reply.json);
                assert(request?.state === "complete" && request.json);
                return {
                    replyJson: reply.json,
                    requestJson: request.json,
                    correction: previous.correction,
                };
            }),
        ),
    );
    for (const { replyJson, requestJson, correction } of correctiveInputs) {
        const reply = JSON.parse(replyJson);
        const request = JSON.parse(requestJson);
        const texts: string[] = request.messages.flatMap(
            (message: {
                content: string | { type: string; text?: string }[];
                sections?: Record<string, string | null>;
            }) => [
                ...(typeof message.content === "string"
                    ? [message.content]
                    : message.content.flatMap((part) =>
                          part.type === "text" && typeof part.text === "string"
                              ? [part.text]
                              : [],
                      )),
                ...Object.values(message.sections ?? {}).filter(
                    (value): value is string => value !== null,
                ),
            ],
        );
        for (const part of reply.content) {
            if (part.type === "text") expect(texts).toContain(part.text);
        }
        assert(correction);
        expect(
            texts.some((text) => text.includes(JSON.stringify(correction))),
        ).toBe(true);
        expect(
            texts.some((text) => text.includes('"id":"common-context"')),
        ).toBe(true);
    }
    expect(mission.workingNotes).toBe(repeat ? "" : "Completion note.");
    if (repeat) expect(mission.blockCode).toBe("repetition_stop");
    const requests = await f.t.run((ctx) =>
        ctx.db
            .query("agentOperationRequests")
            .withIndex("by_mission", (q) => q.eq("missionId", f.missionId))
            .take(3),
    );
    expect(requests.map((request) => request._id)).toEqual([f.readRequestId]);
    expect(network).not.toHaveBeenCalled();
});
