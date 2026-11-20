import { api, internal } from "@convex/_generated/api";
import { getAgentDefinition } from "@convex/execution/agentCatalog";
import { MAX_NO_PROGRESS_TURNS } from "@convex/resourcePolicy";
import { afterEach, assert, expect, test, vi } from "vitest";
import { activateSourcesMission } from "@/__tests__/setup/sources-mission";
import {
    seedWorkbench,
    workbenchAdmissionInput,
} from "@/__tests__/setup/workbench";
import {
    workbenchFailureCopy,
    workbenchTurn,
} from "@/lib/presentation/workbench";

afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
});

async function initialFraming(
    pinnedVersion?: 4 | 5 | 6 | 7,
    angle = "Can insurers bypass CCC during estimate review after the latest announcement?",
) {
    const version = pinnedVersion ?? getAgentDefinition("workbench_v1").version;
    assert(version === 4 || version === 5 || version === 6 || version === 7);
    const f = await seedWorkbench(
        true,
        undefined,
        undefined,
        angle,
        undefined,
        pinnedVersion ?? null,
    );
    const turn = await f.t.mutation(
        internal.execution.conversations.startTurn,
        {
            runId: f.runId,
            definitionId: "workbench_v1",
            scope: { kind: "workbench_v1" },
            simulation: true,
        },
    );
    assert(turn);
    expect(
        (await f.t.run((ctx) => ctx.db.get(turn.missionId)))?.definitionVersion,
    ).toBe(version);
    return { ...f, ...turn };
}

async function complete(
    f: Awaited<ReturnType<typeof initialFraming>>,
    taskKey = "prose-only",
) {
    const invocation = await f.t.mutation(
        internal.execution.invocations.begin,
        {
            missionId: f.missionId,
            expectedGeneration: 1,
            taskKey,
            provenance: "simulation",
            nativeInput: await workbenchAdmissionInput(f.t, f.missionId),
        },
    );
    assert(invocation.kind === "ready");
    return f.t.mutation(internal.execution.invocations.finish, {
        invocationId: invocation.invocationId,
        expectedGeneration: 1,
        response: {
            kind: "complete",
            text: "I propose examining workflow control, alternatives and the announcement. Which announcement do you mean?",
        },
    });
}

test("initial framing cannot publish a prose-only program", async () => {
    const f = await initialFraming();
    const before = await f.t.run((ctx) => ctx.db.get(f.runId));
    const finished = await complete(f);
    expect(finished).toMatchObject({
        kind: "blocked",
        code: "completion_correction_required",
        correction: { code: "framing_program_required" },
    });
    expect(
        await f.client.query(api.framing.get, { runId: f.runId }),
    ).toMatchObject({ revision: 1, content: { scope: "", questions: [] } });
    const messages = await f.client.query(
        api.execution.conversations.listMessages,
        { runId: f.runId, paginationOpts: { numItems: 20, cursor: null } },
    );
    expect(
        messages.page.filter((message) => message.role === "assistant"),
    ).toEqual([]);
    const run = await f.t.run((ctx) => ctx.db.get(f.runId));
    expect(run?.reservationStatus).toBe(before?.reservationStatus);
    expect(run?.researchStartedAt).toBeUndefined();
    expect(run?.fixedFramingRevisionId).toBeUndefined();
});

const content = {
    scope: "Insurer estimate review",
    questions: [
        {
            id: "control",
            shortLabel: "Control",
            text: "Who can change validation rules?",
            rationale: "Locate workflow authority.",
        },
    ],
};

test.each([
    4, 5,
] as const)("retained v%s permits the original prose-only completion", async (version) => {
    const f = await initialFraming(version);
    expect(await complete(f)).toMatchObject({ kind: "completed" });
});

test("initial completion preserves an already saved analyst program", async () => {
    const f = await initialFraming();
    await f.client.mutation(api.framing.save, {
        runId: f.runId,
        expectedRevision: 1,
        requestKey: "analyst-program",
        content,
    });
    expect(await complete(f)).toMatchObject({ kind: "completed" });
    expect(
        await f.client.query(api.framing.get, { runId: f.runId }),
    ).toMatchObject({ revision: 2, content });
});

test("explicit initial preservation does not force a write on an empty draft", async () => {
    const f = await initialFraming(6, "Keep the research program unchanged.");
    expect(await complete(f)).toMatchObject({ kind: "completed" });
    expect(
        await f.client.query(api.framing.get, { runId: f.runId }),
    ).toMatchObject({ revision: 1, content: { scope: "", questions: [] } });
});

test("a later explanatory turn does not require an initial program", async () => {
    const f = await initialFraming(6, "Keep the research program unchanged.");
    expect(await complete(f)).toMatchObject({ kind: "completed" });
    await f.client.mutation(api.execution.conversations.submit, {
        runId: f.runId,
        requestKey: "explanation",
        text: "Explain how research questions work.",
        delivery: "queue",
    });
    const next = await f.t.mutation(
        internal.execution.conversations.startTurn,
        {
            runId: f.runId,
            definitionId: "workbench_v1",
            scope: { kind: "workbench_v1" },
            simulation: true,
        },
    );
    assert(next);
    expect(await complete({ ...f, ...next }, "later")).toMatchObject({
        kind: "completed",
    });
});

test("repeated missing-program completion stops through shared non-progress containment", async () => {
    const f = await initialFraming();
    for (let attempt = 0; attempt < MAX_NO_PROGRESS_TURNS; attempt++) {
        expect(await complete(f, `prose-${attempt}`)).toMatchObject({
            kind: "blocked",
            code:
                attempt === MAX_NO_PROGRESS_TURNS - 1
                    ? "repetition_stop"
                    : "completion_correction_required",
        });
    }
    const mission = await f.t.run((ctx) => ctx.db.get(f.missionId));
    expect(mission).toMatchObject({
        status: "blocked",
        blockCode: "repetition_stop",
    });
    const snapshot = await f.client.query(api.workbench.snapshot, {
        runId: f.runId,
    });
    assert(snapshot.activeWork);
    expect(workbenchTurn(snapshot.activeWork)).toMatchObject({
        state: "blocked",
        entries: [],
    });
    expect(snapshot.framing).toMatchObject({
        content: { scope: "", questions: [] },
    });
    expect(workbenchFailureCopy(mission?.blockCode)).toBe(
        "This response could not finish. Your messages and recorded work remain available. Send another message to continue.",
    );

    expect(
        (
            await f.client.query(api.execution.conversations.listMessages, {
                runId: f.runId,
                paginationOpts: { numItems: 20, cursor: null },
            })
        ).page.filter((message) => message.role === "assistant"),
    ).toEqual([]);
    expect(
        (await f.client.query(api.framing.get, { runId: f.runId }))?.revision,
    ).toBe(1);
});

test.each([
    "cancel",
    "start",
] as const)("%s wins over a pending initial completion correction", async (action) => {
    const f = await initialFraming();
    expect(await complete(f)).toMatchObject({
        code: "completion_correction_required",
    });
    const invocation = await f.t.mutation(
        internal.execution.invocations.begin,
        {
            missionId: f.missionId,
            expectedGeneration: 1,
            taskKey: "pending-correction",
            provenance: "simulation",
            nativeInput: await workbenchAdmissionInput(f.t, f.missionId),
        },
    );
    assert(invocation.kind === "ready");
    if (action === "cancel") {
        await f.client.mutation(api.execution.conversations.stopResponse, {
            runId: f.runId,
            turnId: f.turnId,
        });
    } else {
        activateSourcesMission();
        await f.client.mutation(api.framing.save, {
            runId: f.runId,
            expectedRevision: 1,
            requestKey: "analyst-before-start",
            content,
        });
        await f.client.mutation(api.framing.startResearch, {
            runId: f.runId,
            expectedRevision: 2,
            requestKey: "start-during-correction",
        });
    }
    const finished = await f.t.mutation(internal.execution.invocations.finish, {
        invocationId: invocation.invocationId,
        expectedGeneration: 1,
        response: { kind: "complete", text: "The obsolete proposal is ready." },
    });
    expect(finished).toMatchObject({ kind: "blocked" });
    expect(
        (
            await f.client.query(api.execution.conversations.listMessages, {
                runId: f.runId,
                paginationOpts: { numItems: 20, cursor: null },
            })
        ).page.filter((message) => message.role === "assistant"),
    ).toEqual([]);
    expect(
        await f.client.query(api.framing.get, { runId: f.runId }),
    ).toMatchObject(
        action === "start"
            ? { revision: 2, content }
            : { revision: 1, content: { scope: "", questions: [] } },
    );
    const run = await f.t.run((ctx) => ctx.db.get(f.runId));
    if (action === "start")
        expect(run?.fixedFramingRevisionId).toBe(run?.currentFramingRevisionId);
    else expect(run?.researchStartedAt).toBeUndefined();
});

test("preservation steering during initial correction leaves the empty draft untouched", async () => {
    const f = await initialFraming();
    expect(await complete(f)).toMatchObject({
        code: "completion_correction_required",
    });
    await f.client.mutation(api.execution.conversations.submit, {
        runId: f.runId,
        turnId: f.turnId,
        requestKey: "preserve-after-proposal",
        text: "Keep the research program unchanged.",
        delivery: "steer",
    });
    expect(await complete(f, "preservation")).toMatchObject({
        kind: "completed",
    });
    expect(
        await f.client.query(api.framing.get, { runId: f.runId }),
    ).toMatchObject({ revision: 1, content: { scope: "", questions: [] } });
});
