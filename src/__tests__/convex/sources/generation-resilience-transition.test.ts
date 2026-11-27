import { api, internal } from "@convex/_generated/api";
import { sha256Hex, stableStringify } from "@convex/domain/sourcePassages";
import {
    getAgentDefinition,
    registeredAgentDefinitions,
} from "@convex/execution/agentCatalog";
import { recordContextObservation } from "@convex/execution/journal";
import { openMissionPiStorage } from "@convex/integrations/piStorage";
import schema from "@convex/schema";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { createModels } from "@earendil-works/pi-ai";
import { createRegistry, Harness } from "@earendil-works/pi-durable";
import { validate } from "convex-helpers/validators";
import { afterEach, assert, expect, test, vi } from "vitest";
import { readRetainedBody } from "@/__tests__/setup/retained-history";
import { seedCapturedSources } from "@/__tests__/setup/sources-mission";
import { seedWorkbench } from "@/__tests__/setup/workbench";

afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
});

test.each([
    ["sources_v1", 8, 9],
    ["workbench_v1", 12, 13],
    ["saved_material_inspection_v1", 4, 5],
] as const)("%s accepts its current runtime and profile binding without registering the replaced version", (definitionId, replaced, current) => {
    expect(getAgentDefinition(definitionId).version).toBe(current);
    expect(() => getAgentDefinition(definitionId, replaced)).toThrow(
        "definition_version_conflict",
    );

    expect(
        registeredAgentDefinitions()
            .filter((definition) => definition.id === definitionId)
            .map((definition) => definition.version),
    ).not.toContain(replaced);
});

test("the published schema requires current accounting and has no legacy scheduling or cancellation fields", () => {
    const calls = schema.tables.providerCalls.validator.fields;
    const requests = schema.tables.agentOperationRequests.validator.fields;
    const budget =
        schema.tables.researchRuns.validator.fields.sourcePreparationBudget;
    const usage = schema.tables.qualificationUsage.validator.fields;
    expect(requests).not.toHaveProperty("scheduledJobId");
    expect(requests).not.toHaveProperty("scheduledStartedAt");
    expect(validate(calls.providerObservation, { observedAt: 1 })).toBe(true);
    expect(
        validate(calls.providerObservation, {
            observedAt: 1,
            cancelled: true,
        }),
    ).toBe(false);
    const totals = { work: 0, incidents: 0, reserved: 1, dispatches: 1 };
    expect(validate(budget, { ...totals, version: 2 })).toBe(true);
    expect(validate(budget, { ...totals, version: 1 })).toBe(false);
    expect(usage.projectionVersion.isOptional).toBe("required");
});

test("a retained handoff keeps its membership and original control while current examination is unavailable", async () => {
    const f = await seedCapturedSources();
    const original = {
        coherence: false,
        limitations: ["The publisher does not establish independent outcomes."],
        findings: [
            {
                contributionId: "retained-contribution",
                conclusion: "supported" as const,
                permittedUse: "attributed_argument_only" as const,
                diagnostic: "Faithful publisher argument.",
            },
        ],
    };
    const { historical, qualificationId, material } = await f.t.run(
        async (ctx) => {
            const preparation = await ctx.db.get(f.preparationId);
            const capture = await ctx.db.get(f.captureId);
            assert(preparation?.sourcesMission && capture?.contentHash);
            const contribution = {
                id: "retained-contribution",
                version: 1,
                kind: "attributed_argument" as const,
                needIds: ["common-context"],
                statement: "The publisher claims it speeds review.",
                attribution: "Publisher",
                period: "undated",
                modality: "argument",
                evidence: [
                    {
                        captureId: f.captureId,
                        passageOrder: f.passage.order,
                        quotation: f.passage.quotation,
                    },
                ],
            };
            const inputHash = sha256Hex("retained-documentary-control");
            const base = {
                runId: f.runId,
                corpusRevisionId: f.corpusRevisionId,
                sourceId: f.sourceId,
                adapterVersion: "one-shot-v1",
                executionMode: "live" as const,
                inputHash,
                createdAt: Date.now(),
            };
            const originalReference = await recordContextObservation(
                ctx,
                f.runId,
                {
                    key: "retained-documentary-control:fixture",
                    topic: "documentary",
                    actor: { type: "system" },
                    value: {
                        event: "retained_documentary_control_import",
                        schemaVersion: "documentary-control-v1",
                        originalControlHash: sha256Hex(
                            stableStringify(original),
                        ),
                        control: original,
                    },
                },
            );
            const historical = {
                state: "not_examined" as const,
                originalReference,
                recordedUses: [
                    {
                        contributionId: contribution.id,
                        version: contribution.version,
                        permittedUse: "attributed_argument_only" as const,
                    },
                ],
            };
            const controlId = await ctx.db.insert("aiTaskResults", {
                ...base,
                taskType: "documentary_control",
                schemaVersion: "documentary-control-v1",
                output: {
                    kind: "documentary_control",
                    preparationId: f.preparationId,
                    inputHash,
                    evidence: contribution.evidence,
                    examination: historical,
                },
            });
            const qualificationId = await ctx.db.insert("aiTaskResults", {
                ...base,
                taskType: "documentary_qualification",
                schemaVersion: "documentary-qualification-v1",
                output: {
                    kind: "documentary_qualification",
                    preparationId: f.preparationId,
                    captureId: f.captureId,
                    contentHash: capture.contentHash,
                    version: 1,
                    contributions: [contribution],
                    controlTaskId: controlId,
                },
            });
            const material = {
                version: 1 as const,
                needsRevision: preparation.sourcesMission.needsRevision,
                outcome: "complete" as const,
                policyVersion: "sources_mission_v1" as const,
                retentionAuthority: "system_mandate" as const,
                documents: [
                    {
                        sourceId: f.sourceId,
                        captureId: f.captureId,
                        contentHash: capture.contentHash,
                        qualificationTaskId: qualificationId,
                        qualificationVersion: 1,
                        contributions: [{ id: contribution.id, version: 1 }],
                    },
                ],
                needs: [
                    {
                        needId: "common-context",
                        unfinished: [],
                        workRequestIds: [],
                        contributions: [
                            {
                                qualificationTaskId: qualificationId,
                                contributionId: contribution.id,
                                version: 1,
                            },
                        ],
                    },
                ],
            };
            await ctx.db.patch(preparation._id, {
                sourcesMission: {
                    ...preparation.sourcesMission,
                    qualifications: [qualificationId],
                    result: material,
                },
            });
            return { historical, qualificationId, material };
        },
    );
    const journal = await f.t.run((ctx) =>
        ctx.db.get(historical.originalReference),
    );
    assert(journal?.contextObservation);
    const value = JSON.parse(
        await readRetainedBody(f.t, journal.contextObservation.textId),
    );
    expect(value).toMatchObject({
        control: original,
        schemaVersion: "documentary-control-v1",
        originalControlHash: sha256Hex(stableStringify(original)),
    });
    expect(
        (await f.t.run((ctx) => ctx.db.get(f.preparationId)))?.sourcesMission
            ?.result,
    ).toEqual(material);
    const reading = await f.t
        .withIdentity({ subject: f.userId })
        .query(api.sourcesWorkspace.getSource, {
            runId: f.runId,
            sourceId: f.sourceId,
        });
    expect(reading?.historicalExamination).toEqual(historical);
    expect(reading?.contributions).toEqual([
        expect.objectContaining({
            id: "retained-contribution",
            permittedUse: "blocked",
        }),
    ]);
    expect(reading).not.toBeNull();
    expect(await f.t.run((ctx) => ctx.db.get(qualificationId))).not.toBeNull();
    expect(
        await f.t.run((ctx) => ctx.db.query("providerCalls").first()),
    ).toBeNull();
});

test("a converted paused Sources session can resume with its history and fences the old writer", async () => {
    vi.useFakeTimers();
    const f = await seedCapturedSources();
    await f.t.run(async (ctx) => {
        await ctx.db.patch(f.runId, {
            startMode: "framed",
            agentExecutionVersion: 3,
        });
        await ctx.db.patch(f.missionId, {
            definitionVersion: 9,
        });
    });
    const pin = await f.t.action(async (ctx) => {
        const storage = await openMissionPiStorage(
            ctx,
            f.missionId,
            4,
            "transition-test",
            BACKGROUND_CONTEXT,
        );
        const harness = await Harness.open(
            storage,
            { models: createModels(), registry: createRegistry() },
            BACKGROUND_CONTEXT,
        );
        try {
            const root = await harness.root(BACKGROUND_CONTEXT);
            await root.submit(
                {
                    type: "write",
                    requestId: "retained-transition-note",
                    entry: {
                        kind: "workbench.note",
                        data: { text: "Exact native history" },
                    },
                },
                BACKGROUND_CONTEXT,
            );
            return storage.lease;
        } finally {
            await harness.close(BACKGROUND_CONTEXT);
        }
    });
    assert(pin);
    await f.t
        .withIdentity({ subject: f.userId })
        .mutation(api.execution.researchControl.pause, {
            runId: f.runId,
            expectedGeneration: 4,
        });
    await f.t.mutation(internal.execution.researchControl.checkpoint, {
        runId: f.runId,
        preparationId: f.preparationId,
    });
    const original = await f.t.run(async (ctx) => ({
        mission: await ctx.db.get(f.missionId),
        session: await ctx.db.get(pin.sessionId),
        commits: await ctx.db
            .query("piCommits")
            .withIndex("by_session_and_sequence", (q) =>
                q.eq("sessionId", pin.sessionId),
            )
            .collect(),
    }));
    assert(original.session && original.mission && "scope" in original.mission);
    await f.t.mutation(internal.execution.piControl.closeWorker, {
        missionId: f.missionId,
        expectedGeneration: pin.generation,
        writer: pin.writer,
    });
    const generation = await f.t
        .withIdentity({ subject: f.userId })
        .mutation(api.execution.researchControl.resume, {
            runId: f.runId,
            expectedGeneration: 5,
        });
    await f.t.mutation(internal.execution.missions.resume, {
        missionId: f.missionId,
        expectedGeneration: generation,
    });
    for (const stage of [0, 1, 2, 3]) {
        await f.t.mutation(internal.execution.piControl.rebind, {
            missionId: f.missionId,
            expectedGeneration: generation,
            stage,
            cursor: null,
        });
    }
    expect(generation).toBe(6);
    const scheduled = await f.t.run((ctx) => ctx.db.get(f.missionId));
    assert(scheduled?.piWakeToken);
    const writer = "transition-resumed";
    expect(
        await f.t.mutation(internal.execution.piControl.prepare, {
            missionId: f.missionId,
            expectedGeneration: generation,
            token: scheduled.piWakeToken,
            writer,
        }),
    ).toBe(true);
    const entries = await f.t.action(async (ctx) => {
        const storage = await openMissionPiStorage(
            ctx,
            f.missionId,
            generation,
            writer,
            BACKGROUND_CONTEXT,
        );
        const harness = await Harness.open(
            storage,
            { models: createModels(), registry: createRegistry() },
            BACKGROUND_CONTEXT,
        );
        try {
            const root = await harness.root(BACKGROUND_CONTEXT);
            return await root.entries(
                { order: "ascending" },
                20,
                undefined,
                BACKGROUND_CONTEXT,
            );
        } finally {
            await harness.close(BACKGROUND_CONTEXT);
        }
    });
    expect(entries.items).toContainEqual(
        expect.objectContaining({
            kind: "workbench.note",
            data: { text: "Exact native history" },
        }),
    );
    const resumed = await f.t.run(async (ctx) => ({
        mission: await ctx.db.get(f.missionId),
        run: await ctx.db.get(f.runId),
        nativeSession: await ctx.db.get(pin.sessionId),
        calls: await ctx.db.query("providerCalls").collect(),
    }));
    expect(resumed.run).toMatchObject({
        executionStatus: "running",
        executionGeneration: generation,
        sourcePreparationId: f.preparationId,
    });
    expect(resumed.mission).toMatchObject({
        definitionVersion: 9,
        generation,
        objectiveKey: original.mission.objectiveKey,
        deadlineAt: original.mission.deadlineAt,
    });
    expect(resumed.nativeSession).toMatchObject({
        missionId: f.missionId,
        generation,
        sequence: original.session.sequence,
    });
    await expect(
        f.t.mutation(internal.execution.piStore.renew, pin),
    ).rejects.toThrow("pi_writer_fenced");
    expect(resumed.calls).toEqual([]);
});

test("an idle Workbench conversion admits the original queued instruction on v13", async () => {
    const { t, client, runId } = await seedWorkbench(
        true,
        undefined,
        undefined,
        undefined,
        undefined,
        13,
    );
    await t.mutation(internal.execution.piControl.holdPublication, {
        held: true,
    });
    const messageId = await client.mutation(
        api.execution.conversations.submit,
        {
            runId,
            requestKey: "queued-before-conversion",
            text: "Preserve this pending instruction verbatim.",
            delivery: "queue",
        },
    );
    const original = await t.run(async (ctx) => ({
        conversation: await ctx.db
            .query("agentConversations")
            .withIndex("by_run", (q) => q.eq("runId", runId))
            .unique(),
        message: await ctx.db.get(messageId),
    }));
    assert(original.conversation && original.message);
    expect(original.conversation).toMatchObject({
        definitionVersion: 13,
        queuedCount: 2,
    });
    await t.mutation(internal.execution.piControl.holdPublication, {
        held: false,
    });
    const turn = await t.mutation(internal.execution.conversations.startTurn, {
        runId,
        definitionId: "workbench_v1",
        scope: { kind: "workbench_v1" },
        simulation: true,
    });
    assert(turn);
    expect(await t.run((ctx) => ctx.db.get(turn.missionId))).toMatchObject({
        definitionVersion: 13,
        conversationTurnId: turn.turnId,
    });
    expect(await t.run((ctx) => ctx.db.get(messageId))).toMatchObject({
        turnId: turn.turnId,
        bodyContentHash: original.message.bodyContentHash,
        status: "active",
    });
    expect(
        await t.run((ctx) => ctx.db.query("providerCalls").collect()),
    ).toEqual([]);
});
