import { api, internal } from "@convex/_generated/api";
import { sha256Hex } from "@convex/domain/sourcePassages";
import { getAgentDefinition } from "@convex/execution/agentCatalog";
import { skillResource } from "@convex/execution/agentSkills";
import packages from "@convex/integrations/agentSkillPackages.json";
import { afterEach, assert, expect, test, vi } from "vitest";
import {
    nativePiFixtureRoute,
    nativeTextReply,
    nativeToolReply,
} from "@/__tests__/setup/pi-native";
import { seedWorkbench } from "@/__tests__/setup/workbench";

vi.mock("node:dns/promises", async (importOriginal) => {
    const original = await importOriginal<typeof import("node:dns/promises")>();
    const lookup = async () => [{ address: "93.184.216.34", family: 4 }];
    return { ...original, default: { ...original, lookup }, lookup };
});

const originalPackages = [...packages.packages];

afterEach(() => {
    packages.packages.splice(0, packages.packages.length, ...originalPackages);
    vi.useRealTimers();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
});

test("current bindings expose only their native mission catalogue and preserve retained bindings", () => {
    for (const [id, version, retainedVersion, name] of [
        ["workbench_v1", 12, 6, "workbench-framing"],
        ["sources_v1", 8, 4, "source-preparation"],
    ] as const) {
        const current = getAgentDefinition(id);
        expect(current.version).toBe(version);
        expect(current.instructions).toContain(`<name>${name}</name>`);
        expect(current.instructions).not.toContain("# Worked");
        expect(current.operations.read).toBeDefined();
        const retained = getAgentDefinition(id, retainedVersion);
        expect(retained.operations.read).toBeUndefined();
        expect(retained.instructions).not.toContain("<available_skills>");
    }
});

test("native read runs through scheduled settlement and retains its exact package identity", async () => {
    const f = await seedWorkbench(
        false,
        undefined,
        undefined,
        "Prepare a useful program.",
        undefined,
        null,
    );
    const active = await f.t.mutation(
        internal.execution.conversations.startTurn,
        {
            runId: f.runId,
            definitionId: "workbench_v1",
            scope: { kind: "workbench_v1" },
            simulation: false,
        },
    );
    assert(active);
    const requestId = await f.t.mutation(
        internal.execution.operations.enqueue,
        {
            missionId: active.missionId,
            expectedGeneration: 1,
            cause: "consult-method",
            input: {
                kind: "read",
                path: "/agent-skills/research-methods-v3/workbench-framing/SKILL.md",
            },
        },
    );
    await f.t.action(internal.execution.operations.dispatch, {
        requestId,
        expectedGeneration: 1,
    });
    await f.t.action(internal.integrations.agentSkillReader.execute, {
        requestId,
        expectedGeneration: 1,
    });
    const request = await f.t.run((ctx) => ctx.db.get(requestId));
    expect(request?.status).toBe("completed");
    assert(request?.outcome?.kind === "success", JSON.stringify(request));
    const value = JSON.parse(request.outcome.valueJson);
    expect(value).toMatchObject({
        packageId: "research-methods-v3",
        path: "/agent-skills/research-methods-v3/workbench-framing/SKILL.md",
        text: expect.stringContaining("# Framing an economic inquiry"),
    });
    expect(value.resourceHash).toMatch(/^[a-f0-9]{64}$/);
    const replay = await f.t.action(internal.execution.operations.dispatch, {
        requestId,
        expectedGeneration: 1,
    });
    expect(replay).toEqual(request.outcome);
    const before = await f.t.run((ctx) => ctx.db.get(active.missionId));
    const pageId = await f.t.mutation(internal.execution.operations.enqueue, {
        missionId: active.missionId,
        expectedGeneration: 1,
        cause: "consult-annex",
        input: {
            kind: "read",
            path: "examples/worked-cases.md",
            offset: 3,
            limit: 2,
        },
    });
    await f.t.action(internal.execution.operations.dispatch, {
        requestId: pageId,
        expectedGeneration: 1,
    });
    await f.t.action(internal.integrations.agentSkillReader.execute, {
        requestId: pageId,
        expectedGeneration: 1,
    });
    const page = await f.t.run((ctx) => ctx.db.get(pageId));
    assert(page?.outcome?.kind === "success", JSON.stringify(page));
    expect(JSON.parse(page.outcome.valueJson).text).toContain(
        "An identified event leaves economic consequences open",
    );
    expect(JSON.parse(page.outcome.valueJson).text).toContain("offset=5");
    const { createReadTool } = await import("@earendil-works/pi-coding-agent");
    const { skillResource } = await import("@convex/execution/agentSkills");
    const binding = getAgentDefinition("workbench_v1").skills;
    assert(binding);
    const native = createReadTool(
        "/agent-skills/research-methods-v3/workbench-framing/",
        {
            operations: {
                access: async (path) => {
                    skillResource(binding, path);
                },
                readFile: async (path) =>
                    Buffer.from(skillResource(binding, path).resource.content),
                detectImageMimeType: async () => null,
            },
        },
    );
    const nativePage = await native.execute("parity", {
        path: "examples/worked-cases.md",
        offset: 3,
        limit: 2,
    });
    expect(JSON.parse(page.outcome.valueJson).text).toBe(
        nativePage.content
            .map((item) => (item.type === "text" ? item.text : ""))
            .join("\n"),
    );

    const after = await f.t.run((ctx) => ctx.db.get(active.missionId));
    expect(after?.progressKeys).toEqual(before?.progressKeys);
    for (const path of [
        "/etc/passwd",
        "../source-preparation/SKILL.md",
        "../../../../etc/passwd",
        "/agent-skills/research-methods-v3/source-preparation/SKILL.md",
    ]) {
        const deniedId = await f.t.mutation(
            internal.execution.operations.enqueue,
            {
                missionId: active.missionId,
                expectedGeneration: 1,
                cause: path,
                input: { kind: "read", path },
            },
        );
        expect(
            await f.t.action(internal.execution.operations.dispatch, {
                requestId: deniedId,
                expectedGeneration: 1,
            }),
        ).toMatchObject({
            kind: "refused",
            code: "skill_resource_not_allowed",
        });
    }
    const invalidPage = await f.t.mutation(
        internal.execution.operations.enqueue,
        {
            missionId: active.missionId,
            expectedGeneration: 1,
            cause: "invalid-native-offset",
            input: {
                kind: "read",
                path: "/agent-skills/research-methods-v3/workbench-framing/SKILL.md",
                offset: 0,
            },
        },
    );
    expect(
        await f.t.action(internal.execution.operations.dispatch, {
            requestId: invalidPage,
            expectedGeneration: 1,
        }),
    ).toMatchObject({ kind: "refused", code: "invalid_operation_input" });
});

test("native provider requests retain consulted method and annex text", async () => {
    vi.stubEnv(
        "WORKBENCH_PUBLIC_CONTEXT_ALLOWANCE",
        JSON.stringify({ searches: 2, readings: 2 }),
    );
    const activity = "Investigate routing control in logistics workflows.";
    const f = await seedWorkbench(
        false,
        nativePiFixtureRoute,
        undefined,
        activity,
        undefined,
        7,
    );
    vi.stubEnv("OPENROUTER_API_KEY", "fixture-only");
    vi.stubEnv("EXA_API_KEY", "fixture-only");
    const requests: string[] = [];
    vi.stubGlobal(
        "fetch",
        vi.fn(async (url, init) => {
            if (String(url).endsWith("/search"))
                return Response.json({
                    results: [
                        {
                            id: "dated",
                            url: "https://example.com/release",
                            title: "Release",
                            publishedDate: "2026-10-28",
                        },
                    ],
                });
            if (String(url).endsWith("/contents"))
                return Response.json({
                    results: [
                        {
                            id: "dated",
                            url: "https://example.com/release",
                            text: "BOSTON, Oct. 29, 2026 (GLOBE NEWSWIRE) -- Routing remains subject to approval.",
                        },
                    ],
                });
            requests.push(String(init.body));
            if (requests.length === 1)
                return nativeToolReply("read", {
                    path: "/agent-skills/research-methods-v1/workbench-framing/SKILL.md",
                });
            if (requests.length === 2)
                return nativeToolReply("read", {
                    path: "examples/worked-cases.md",
                });
            if (requests.length === 3)
                return nativeToolReply("search_public_context", {
                    query: "routing announcement",
                });
            if (requests.length === 4) {
                const tools = JSON.parse(String(init.body)).messages.filter(
                    (message: { role: string }) => message.role === "tool",
                );
                const searchId = JSON.parse(tools.at(-1).content).value
                    .searchId;
                return nativeToolReply("read_public_context", {
                    target: { kind: "candidate", searchId, index: 0 },
                });
            }
            if (requests.length === 5)
                return nativeToolReply("adjust_framing", {
                    eventBasis: { kind: "open", activityExcerpt: activity },
                    content: {
                        scope: activity,
                        questions: [
                            {
                                id: "control",
                                shortLabel: "Control",
                                text: "Who authorizes routing decisions?",
                                rationale: "Investigate execution authority.",
                            },
                        ],
                    },
                });
            if (requests.length === 6)
                return nativeTextReply(
                    "The provisional program is saved; the event remains open.",
                );
            throw new Error("Unexpected generation");
        }),
    );
    await f.t.finishAllScheduledFunctions(
        () => vi.advanceTimersByTime(10),
        120,
    );
    expect(requests).toHaveLength(6);
    const datedTools = JSON.parse(requests[4] ?? "{}").messages.filter(
        (message: { role: string }) => message.role === "tool",
    );
    const observed = JSON.parse(datedTools.at(-1).content).value;
    expect(observed.reference.dates.publication.status).toBe("conflict");
    expect(
        observed.reference.dates.publication.evidence.map(
            (item: { precision: string }) => item.precision,
        ),
    ).toEqual(["day", "day"]);
    expect(observed.reference.publishedAt).toBeUndefined();
    expect(requests[0]).toContain("<name>workbench-framing</name>");
    expect(requests[0]).not.toContain("# Worked framing cases");
    expect(requests[1]).toContain("# Framing an economic inquiry");
    expect(requests[2]).toContain("# Worked framing cases");
    expect(requests[2]).not.toContain(
        "# Preparing useful documentary material",
    );
    expect(requests[2]).not.toContain(".agents/skills");
});

test.each([
    {
        selected: null,
        version: 12,
        packageId: "research-methods-v3",
        candidate: true,
    },
    {
        selected: 11 as const,
        version: 11,
        packageId: "research-methods-v2",
        candidate: false,
    },
])("native framing method and receipt remain pinned to Workbench $version", async ({
    selected,
    version,
    packageId,
    candidate,
}) => {
    const definition = getAgentDefinition(
        "workbench_v1",
        selected ?? undefined,
    );
    expect(definition.version).toBe(version);
    const activity = "Investigate authorization in industrial ordering.";
    const f = await seedWorkbench(
        false,
        nativePiFixtureRoute,
        undefined,
        activity,
        undefined,
        selected,
    );
    vi.stubEnv("OPENROUTER_API_KEY", "fixture-only");
    const requests: string[] = [];
    vi.stubGlobal(
        "fetch",
        vi.fn(async (_url, init) => {
            requests.push(String(init?.body));
            if (requests.length === 1)
                return nativeToolReply("read", {
                    path: `/agent-skills/${packageId}/workbench-framing/SKILL.md`,
                });
            if (requests.length === 2)
                return nativeToolReply("read", {
                    path: "examples/worked-cases.md",
                });
            if (requests.length === 3)
                return nativeToolReply("adjust_framing", {
                    eventBasis: { kind: "open", activityExcerpt: activity },
                    content: {
                        scope: activity,
                        questions: [
                            {
                                id: "authority",
                                shortLabel: "Authority",
                                text: "Who approves orders?",
                                rationale: "Identify execution authority.",
                            },
                        ],
                    },
                });
            if (requests.length === 4)
                return nativeTextReply("The provisional program is saved.");
            throw new Error("Unexpected native generation");
        }),
    );
    await f.t.finishAllScheduledFunctions(
        () => vi.advanceTimersByTime(10),
        120,
    );
    expect(requests).toHaveLength(4);
    expect(requests[0]).toContain(
        `/agent-skills/${packageId}/workbench-framing/SKILL.md`,
    );
    const tools = (index: number) => {
        const request = requests[index];
        assert(request);
        return JSON.parse(request)
            .messages.filter(
                (message: { role: string }) => message.role === "tool",
            )
            .map((message: { content: string }) => JSON.parse(message.content));
    };
    expect(tools(1)[0].value).toMatchObject({
        packageId,
        text: expect.stringContaining("# Framing an economic inquiry"),
    });
    const annex = tools(2).at(-1).value;
    expect(annex.packageId).toBe(packageId);
    expect(
        annex.text.includes(
            "An identified event leaves economic consequences open",
        ),
    ).toBe(candidate);
    expect(tools(3).at(-1).value).toMatchObject({
        revision: 2,
        eventBasis: "open",
        publicCitations: { event: [], conditions: [] },
    });
    const run = await f.t.run((ctx) => ctx.db.get(f.runId));
    assert(run?.currentFramingRevisionId);
    const revisionId = run.currentFramingRevisionId;
    expect(
        (await f.t.run((ctx) => ctx.db.get(revisionId)))?.content.questions.map(
            (q) => q.id,
        ),
    ).toEqual(["authority"]);
    const messages = await f.client.query(
        api.execution.conversations.listMessages,
        {
            runId: f.runId,
            paginationOpts: { cursor: null, numItems: 20 },
        },
    );
    expect(messages.page.filter((m) => m.role === "assistant")).toHaveLength(1);
    expect(messages.page.find((m) => m.role === "assistant")?.text).toContain(
        "The provisional program is saved.",
    );
});

test("Sources native reads preserve documentary state and reject stale scheduled input", async () => {
    const { seedCapturedSources } = await import(
        "@/__tests__/setup/sources-mission"
    );
    vi.useFakeTimers();
    const f = await seedCapturedSources();
    const before = await f.t.run((ctx) => ctx.db.get(f.preparationId));
    const requestId = await f.t.mutation(
        internal.execution.operations.enqueue,
        {
            missionId: f.missionId,
            expectedGeneration: 4,
            cause: "source-method",
            input: {
                kind: "read",
                path: "/agent-skills/research-methods-v1/source-preparation/SKILL.md",
            },
        },
    );
    await f.t.action(internal.execution.operations.dispatch, {
        requestId,
        expectedGeneration: 4,
    });
    await f.t.action(internal.integrations.agentSkillReader.execute, {
        requestId,
        expectedGeneration: 4,
    });
    const request = await f.t.run((ctx) => ctx.db.get(requestId));
    assert(request?.outcome?.kind === "success", JSON.stringify(request));
    expect(JSON.parse(request.outcome.valueJson).text).toContain(
        "# Preparing useful documentary material",
    );
    const after = await f.t.run((ctx) => ctx.db.get(f.preparationId));
    expect(after).toEqual(before);
    const staleId = await f.t.mutation(internal.execution.operations.enqueue, {
        missionId: f.missionId,
        expectedGeneration: 4,
        cause: "source-annex",
        input: { kind: "read", path: "examples/worked-cases.md" },
    });
    await f.t.action(internal.execution.operations.dispatch, {
        requestId: staleId,
        expectedGeneration: 4,
    });
    await f.t.mutation(internal.execution.operations.beginScheduledExecution, {
        requestId: staleId,
        expectedGeneration: 4,
    });
    const { createReadTool } = await import("@earendil-works/pi-coding-agent");
    const { skillResource } = await import("@convex/execution/agentSkills");
    const binding = getAgentDefinition("sources_v1", 5).skills;
    assert(binding);
    const path =
        "/agent-skills/research-methods-v1/source-preparation/examples/worked-cases.md";
    const resolved = skillResource(binding, path);
    const native = createReadTool(
        "/agent-skills/research-methods-v1/source-preparation/",
        {
            operations: {
                access: async (path) => {
                    skillResource(binding, path);
                },
                readFile: async (path) =>
                    Buffer.from(skillResource(binding, path).resource.content),
                detectImageMimeType: async () => null,
            },
        },
    );
    const read = await native.execute("late-annex", { path });
    const text = read.content
        .map((item) => (item.type === "text" ? item.text : ""))
        .join("\n");
    await f.t.run((ctx) => ctx.db.patch(f.missionId, { generation: 5 }));
    await expect(
        f.t.query(internal.execution.operations.readScheduledInput, {
            requestId: staleId,
            expectedGeneration: 4,
        }),
    ).rejects.toThrow("stale_execution");
    const stale = await f.t.run((ctx) => ctx.db.get(staleId));
    expect(stale?.outcome).toBeUndefined();
    expect(
        await f.t.mutation(internal.execution.operations.recordResult, {
            requestId: staleId,
            expectedGeneration: 4,
            outcome: {
                kind: "success",
                valueJson: JSON.stringify({
                    packageId: resolved.pkg.id,
                    path,
                    resourceHash: resolved.resource.hash,
                    text,
                }),
            },
        }),
    ).toMatchObject({ kind: "refused", code: "stale_execution" });
    const retainedLate = await f.t.run((ctx) => ctx.db.get(staleId));
    expect(retainedLate).toMatchObject({
        status: "observed",
        outcome: { kind: "success" },
    });
    expect(retainedLate?.adoptedAt).toBeUndefined();
    expect(await f.t.run((ctx) => ctx.db.get(f.preparationId))).toEqual(before);
});

test("Sources provider input receives its native method and annex through the mission loop", async () => {
    const { seedCapturedSources } = await import(
        "@/__tests__/setup/sources-mission"
    );
    const { installModel } = await import(
        "@/__tests__/setup/model-configuration"
    );
    const { runPiMission } = await import("@convex/integrations/piMission");
    const { nodeActionGenerationDeadline } = await import(
        "@convex/resourcePolicy"
    );
    vi.useFakeTimers();
    const f = await seedCapturedSources({
        text: "BOSTON, October 29, 2026 (GLOBE NEWSWIRE) -- The workflow requires insurer approval.",
    });
    await f.t.run((ctx) =>
        ctx.db.patch(f.sourceId, {
            origin: "exa",
            publishedAt: Date.UTC(2026, 9, 28),
        }),
    );
    await installModel(f.t, nativePiFixtureRoute, "sources", {
        contextWindow: 32768,
    });
    const { pinMissionModel } = await import("@convex/modelConfiguration");
    await f.t.run(async (ctx) => {
        const mission = await ctx.db.get(f.missionId);
        assert(mission);
        await pinMissionModel(ctx, mission);
    });
    vi.stubEnv("OPENROUTER_API_KEY", "fixture-only");
    const context = await f.t.query(internal.execution.context.build, {
        missionId: f.missionId,
        expectedGeneration: 4,
    });
    assert(context.kind === "ready");
    const needs = JSON.parse(context.inputJson).activeWork.needs as {
        id: string;
    }[];
    const requests: string[] = [];
    const compactionRequests: string[] = [];
    vi.stubGlobal(
        "fetch",
        vi.fn(async (_url, init) => {
            const wire = String(init.body);
            if (!JSON.parse(wire).tools?.length) {
                compactionRequests.push(wire);
                return nativeTextReply(
                    "Retain source-preparation, its original immutable research-methods-v1 package, documentary needs and unfinished work. Reconsult the admitted annex after compaction.",
                );
            }
            requests.push(wire);
            if (requests.length === 1)
                return nativeToolReply("read", {
                    path: "/agent-skills/research-methods-v1/source-preparation/SKILL.md",
                });
            if (requests.length === 2)
                return nativeToolReply("read", {
                    path: "examples/worked-cases.md",
                });
            if (requests.length === 3)
                return nativeToolReply("read", {
                    path: "examples/worked-cases.md",
                });
            if (requests.length === 4)
                return nativeToolReply("search_available_material", {
                    sourceId: f.sourceId,
                    query: "insurer approval",
                });
            if (requests.length === 5)
                return nativeTextReply(
                    JSON.stringify({
                        kind: "complete",
                        needs: needs.map((need) => ({
                            needId: need.id,
                            unfinished: [
                                "Documentary checks remain unfinished in this deterministic fixture.",
                            ],
                        })),
                    }),
                );
            throw new Error("Unexpected generation");
        }),
    );
    const running = f.t.action((ctx) =>
        runPiMission(
            ctx,
            { missionId: f.missionId, expectedGeneration: 4 },
            "source-skill-input",
            nodeActionGenerationDeadline(Date.now()),
        ),
    );
    await running;
    const pendingRead = await f.t.run(async (ctx) =>
        (
            await ctx.db
                .query("agentOperationRequests")
                .withIndex("by_mission", (q) => q.eq("missionId", f.missionId))
                .collect()
        ).find((request) => request.input.kind === "read"),
    );
    assert(pendingRead);
    await f.t.action(internal.integrations.agentSkillReader.execute, {
        requestId: pendingRead._id,
        expectedGeneration: 4,
    });
    await f.t.action((ctx) =>
        runPiMission(
            ctx,
            { missionId: f.missionId, expectedGeneration: 4 },
            "source-annex-before-compaction",
            nodeActionGenerationDeadline(Date.now()),
        ),
    );
    const annexRead = await f.t.run(async (ctx) =>
        (
            await ctx.db
                .query("agentOperationRequests")
                .withIndex("by_mission", (q) => q.eq("missionId", f.missionId))
                .collect()
        ).find(
            (request) =>
                request.input.kind === "read" &&
                request.input.path === "examples/worked-cases.md",
        ),
    );
    assert(annexRead);
    await f.t.action(internal.integrations.agentSkillReader.execute, {
        requestId: annexRead._id,
        expectedGeneration: 4,
    });
    const originalAnnex = await f.t.run((ctx) => ctx.db.get(annexRead._id));
    assert(originalAnnex?.outcome?.kind === "success");
    const originalPackage = packages.packages[0];
    assert(originalPackage);
    const newer: typeof originalPackage = JSON.parse(
        JSON.stringify(originalPackage).replaceAll(
            "research-methods-v1",
            "research-methods-v2",
        ),
    );
    for (const resource of newer.resources) {
        resource.content +=
            "\nNEWER PACKAGE CONTENT MUST NOT REPLACE PINNED BYTES\n";
        resource.hash = sha256Hex(resource.content);
    }
    newer.hash = sha256Hex(
        JSON.stringify({
            id: newer.id,
            skills: newer.skills,
            resources: newer.resources,
        }),
    );
    packages.packages.unshift(newer);
    expect(
        skillResource(
            {
                packageId: "research-methods-v2",
                skillName: "source-preparation",
            },
            "/agent-skills/research-methods-v2/source-preparation/examples/worked-cases.md",
        ).resource.content,
    ).toContain("NEWER PACKAGE CONTENT");
    const { seedPiHistory } = await import("@/__tests__/setup/pi-mission");
    await seedPiHistory(f.t, f.missionId, 4, 8, 16_250);
    await f.t.finishAllScheduledFunctions(
        () => vi.advanceTimersByTime(10),
        120,
    );
    expect(requests).toHaveLength(5);
    expect(compactionRequests.length).toBeGreaterThan(0);
    expect(requests[0]).toContain("<name>source-preparation</name>");
    expect(requests[0]).not.toContain("# Worked source preparation cases");
    expect(requests[1]).toContain("# Preparing useful documentary material");
    expect(requests[3]).toContain("# Worked source preparation cases");
    expect(requests[3]).not.toContain("NEWER PACKAGE CONTENT");
    expect(requests[1]).toContain("<name>source-preparation</name>");
    expect(requests[2]).not.toContain("# Framing an economic inquiry");
    const rereadTools = JSON.parse(requests[3] ?? "{}").messages.filter(
        (message: { role: string }) => message.role === "tool",
    );
    expect(JSON.parse(rereadTools.at(-1).content).value).toEqual(
        JSON.parse(originalAnnex.outcome.valueJson),
    );
    const tools = JSON.parse(requests[4] ?? "{}").messages.filter(
        (message: { role: string }) => message.role === "tool",
    );
    const material = JSON.parse(tools.at(-1).content).value;
    expect(material.captureId).toBe(f.captureId);
    expect(material.document.dates.publication.status).toBe("conflict");
    expect(material.document.publishedAt).toBeNull();
});

test("Workbench skill admission closes when framing is fixed", async () => {
    const f = await seedWorkbench(
        false,
        undefined,
        undefined,
        "Prepare a program.",
        undefined,
        7,
    );
    const active = await f.t.mutation(
        internal.execution.conversations.startTurn,
        {
            runId: f.runId,
            definitionId: "workbench_v1",
            scope: { kind: "workbench_v1" },
            simulation: false,
        },
    );
    assert(active);
    await f.t.run(async (ctx) => {
        const run = await ctx.db.get(f.runId);
        assert(run?.currentFramingRevisionId);
        await ctx.db.patch(f.runId, {
            fixedFramingRevisionId: run.currentFramingRevisionId,
        });
    });
    const requestId = await f.t.mutation(
        internal.execution.operations.enqueue,
        {
            missionId: active.missionId,
            expectedGeneration: 1,
            cause: "post-start-method",
            input: {
                kind: "read",
                path: "/agent-skills/research-methods-v1/workbench-framing/SKILL.md",
            },
        },
    );
    expect(
        await f.t.action(internal.execution.operations.dispatch, {
            requestId,
            expectedGeneration: 1,
        }),
    ).toMatchObject({ kind: "refused", code: "skill_resource_not_allowed" });
});

test("binding resolution refuses missing or modified packages instead of substituting resources", async () => {
    const { bindAgentDefinition } = await import(
        "@convex/execution/agentCatalog"
    );
    const packages = (
        await import("@convex/integrations/agentSkillPackages.json")
    ).default;
    const { workbenchV6Definition: retained } = await import(
        "@convex/domain/workbenchAgent"
    );
    expect(() =>
        bindAgentDefinition({
            ...retained,
            skills: { packageId: "missing", skillName: "workbench-framing" },
        }),
    ).toThrow("skill_package_unavailable");
    const pkg = packages.packages[0];
    assert(pkg);
    const resource = pkg.resources[0];
    assert(resource);
    const original = resource.content;
    try {
        resource.content = "Modified resource bytes";
        expect(() => getAgentDefinition("workbench_v1", 7)).toThrow(
            "skill_package_mismatch",
        );
    } finally {
        resource.content = original;
    }
    expect(getAgentDefinition("workbench_v1", 7).skills?.packageId).toBe(
        "research-methods-v1",
    );
});

test.each([
    "first page",
    "EOF page",
])("equivalent skill pages remain reused while work continues beyond the former stop: %s", async (page) => {
    const f = await seedWorkbench(
        false,
        nativePiFixtureRoute,
        undefined,
        "Investigate routing decisions.",
        undefined,
        7,
    );
    vi.stubEnv("OPENROUTER_API_KEY", "fixture-only");
    let calls = 0;
    vi.stubGlobal(
        "fetch",
        vi.fn(async () => {
            calls++;
            if (calls === 6)
                return nativeToolReply("adjust_framing", {
                    content: {
                        scope: "Investigate routing decisions.",
                        questions: [
                            {
                                id: "routing",
                                shortLabel: "Routing",
                                text: "Who controls routing decisions?",
                                rationale: "Locate authority.",
                            },
                        ],
                    },
                    eventBasis: { kind: "none" },
                });
            if (calls >= 7)
                return nativeTextReply("The routing program is saved.");
            return nativeToolReply("read", {
                path:
                    calls === 1
                        ? "/agent-skills/research-methods-v1/workbench-framing/SKILL.md"
                        : "SKILL.md",
                ...(page === "EOF page"
                    ? {
                          offset:
                              skillResource(
                                  {
                                      packageId: "research-methods-v1",
                                      skillName: "workbench-framing",
                                  },
                                  "/agent-skills/research-methods-v1/workbench-framing/SKILL.md",
                              ).resource.content.split("\n").length - 1,
                          limit: calls + 1,
                      }
                    : calls === 1
                      ? {}
                      : { offset: 1 }),
            });
        }),
    );
    await f.t.finishAllScheduledFunctions(
        () => vi.advanceTimersByTime(10),
        120,
    );
    const reads = await f.t.run((ctx) =>
        ctx.db.query("agentOperationRequests").collect(),
    );
    expect(reads.filter((read) => read.input.kind === "read")).toHaveLength(1);
    const missions = await f.t.run((ctx) =>
        ctx.db.query("agentMissions").collect(),
    );
    expect(missions[0]?.status).toBe("completed");
    expect(calls).toBe(7);
});

test.each([
    { path: "http://[" },
    { path: "SKILL.md", offset: 10000, limit: 1 },
])("invalid native read input returns corrective feedback and permits valid work: %j", async (input) => {
    const activity = "Investigate routing decisions.";
    const f = await seedWorkbench(
        false,
        nativePiFixtureRoute,
        undefined,
        activity,
        undefined,
        7,
    );
    vi.stubEnv("OPENROUTER_API_KEY", "fixture-only");
    const wires: string[] = [];
    vi.stubGlobal(
        "fetch",
        vi.fn(async (_url, init) => {
            wires.push(String(init.body));
            if (wires.length === 1) return nativeToolReply("read", input);
            if (wires.length === 2)
                return nativeToolReply("read", {
                    path: "SKILL.md",
                    offset: 1,
                    limit: 1,
                });
            if (wires.length === 3)
                return nativeToolReply("adjust_framing", {
                    eventBasis: { kind: "open", activityExcerpt: activity },
                    content: {
                        scope: activity,
                        questions: [
                            {
                                id: "control",
                                shortLabel: "Control",
                                text: "Who authorizes routing decisions?",
                                rationale: "Investigate execution authority.",
                            },
                        ],
                    },
                });
            if (wires.length === 4)
                return nativeTextReply("The provisional program is saved.");
            throw Error("Unexpected generation after completed correction");
        }),
    );
    await f.t.finishAllScheduledFunctions(
        () => vi.advanceTimersByTime(10),
        120,
    );
    expect(wires).toHaveLength(4);
    expect(wires[1]).toContain("invalid_operation_input");
    const reads = await f.t.run(async (ctx) =>
        (await ctx.db.query("agentOperationRequests").collect()).filter(
            (request) => request.input.kind === "read",
        ),
    );
    expect(reads).toHaveLength(2);
    expect(reads[0]?.outcome).toMatchObject({
        kind: "unavailable",
        code: "invalid_operation_input",
    });
    expect(reads[1]?.outcome?.kind).toBe("success");
    const mission = await f.t.run((ctx) =>
        ctx.db.query("agentMissions").first(),
    );
    expect(mission?.blockCode).toBeUndefined();
    const framing = await f.t.run(async (ctx) => {
        const run = await ctx.db.get(f.runId);
        assert(run?.currentFramingRevisionId);
        return ctx.db.get(run.currentFramingRevisionId);
    });
    expect(framing?.content.questions).toEqual(
        expect.arrayContaining([
            expect.objectContaining({
                text: "Who authorizes routing decisions?",
            }),
        ]),
    );
});

test("retained instruction contracts preserve their exact bytes", async () => {
    const f = await seedWorkbench(
        false,
        undefined,
        undefined,
        "Prepare a program.",
        undefined,
        7,
    );
    const run = await f.t.run((ctx) => ctx.db.get(f.runId));
    assert(run);
    const historical = getAgentDefinition("workbench_v1", 6);
    assert(historical.method);
    expect({
        sources: sha256Hex(getAgentDefinition("sources_v1", 4).instructions),
        workbench: sha256Hex(
            `${historical.instructions}\n${historical.method(run)}`,
        ),
    }).toMatchInlineSnapshot(`
      {
        "sources": "3e6044370537794b8f4c7f6b7304677fb0132c754f50daa398382a27b67c1da0",
        "workbench": "25fa5301255dfde356c7705446fe06f3a7fdb1acce52834068682952bcdf8221",
      }
    `);
});
