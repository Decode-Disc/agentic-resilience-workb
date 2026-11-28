import { api, internal } from "@convex/_generated/api";
import { readWorkbenchFacts } from "@convex/domain/workbenchContext";
import { extractObservedDestinations } from "@convex/integrations/evidenceNormalization";
import { assert, expect, test } from "vitest";
import { dispatchFixtureOperation } from "@/__tests__/setup/pi-mission";
import {
    seedInspectedEvidence,
    startRetainedInspection,
} from "@/__tests__/setup/source-preparation";
import {
    seedCapturedSources,
    startSourcesOperation,
} from "@/__tests__/setup/sources-mission";

test.each([
    {
        origin: "sec",
        publishedAt: 1771891200000,
        form: "10-K",
        dateKind: "filing",
    },
    {
        origin: "exa",
        publishedAt: 1771891200000,
        form: null,
        dateKind: "publication",
    },
    { origin: "sec", publishedAt: null, form: "10-K", dateKind: null },
] as const)("saved reads and current context preserve $origin document metadata with date kind $dateKind", async (metadata) => {
    const f = await seedInspectedEvidence();
    const title = "Document title mentioning 1999-01-01";
    await f.t.run((ctx) =>
        ctx.db.patch(f.sourceId, {
            title,
            origin: metadata.origin,
            publishedAt: metadata.publishedAt ?? undefined,
            secForm: metadata.form ?? undefined,
        }),
    );
    const missionId = await startRetainedInspection(f.t, {
        runId: f.runId,
        corpusRevisionId: f.corpusRevisionId,
        requestKey: "document-metadata",
        expectedGeneration: 4,
    });
    const expected = {
        title,
        publishedAt: metadata.publishedAt,
        date: metadata.publishedAt === null ? null : "2026-02-24T00:00:00.000Z",
        form: metadata.form,
        dateKind: metadata.dateKind,
    };
    let passageOrder: number | undefined;
    for (const input of [
        {
            kind: "search_available_material" as const,
            sourceId: f.sourceId,
            query: "workflow",
        },
        {
            kind: "read_in_context" as const,
            sourceId: f.sourceId,
            passageOrder: 0,
        },
    ]) {
        const requestId = await f.t.mutation(
            internal.execution.operations.enqueue,
            {
                missionId,
                expectedGeneration: 4,
                cause: input.kind,
                input:
                    input.kind === "read_in_context"
                        ? { ...input, passageOrder: passageOrder ?? 0 }
                        : input,
            },
        );
        const outcome = await dispatchFixtureOperation(f.t, {
            requestId,
            expectedGeneration: 4,
        });
        assert(outcome.kind === "success");
        const value = JSON.parse(outcome.valueJson);
        expect(value.document).toMatchObject(expected);
        expect(value.document.dates).toMatchObject({
            [metadata.dateKind ?? "publication"]: {
                status: metadata.publishedAt === null ? "unknown" : "known",
            },
        });
        if (metadata.dateKind === "filing")
            expect(value.document.dates.filing.evidence).toMatchObject([
                {
                    value: "2026-02-24",
                    precision: "day",
                    origin: { kind: "sec_field", label: "filingDate" },
                },
            ]);

        expect(value).toMatchObject({
            sourceId: f.sourceId,
            captureId: f.captureId,
        });
        if (input.kind === "search_available_material") {
            assert(value.passages.length);
            passageOrder = value.passages[0].passageOrder;
        }
    }
    const inspection = await f.t.query(internal.execution.context.build, {
        missionId,
        expectedGeneration: 4,
    });
    assert(inspection.kind === "ready");
    expect(
        JSON.parse(inspection.inputJson).domain.availableMaterials,
    ).toContainEqual(
        expect.objectContaining({ sourceId: f.sourceId, ...expected }),
    );
    const workbench = await f.t.run(async (ctx) => {
        const run = await ctx.db.get(f.runId);
        const mission = await ctx.db.get(missionId);
        assert(run && mission);
        return readWorkbenchFacts(ctx, run, mission);
    });
    assert(workbench.kind === "ready");
    expect(workbench.context.availableMaterials).toContainEqual(
        expect.objectContaining({ sourceId: f.sourceId, ...expected }),
    );
});

test("Sources candidate context uses the same qualified document metadata as saved reads", async () => {
    const f = await seedCapturedSources();
    await f.t.run((ctx) =>
        ctx.db.patch(f.sourceId, {
            origin: "sec",
            title: "Annual filing",
            secForm: "10-K",
            publishedAt: 1771891200000,
        }),
    );
    const context = await f.t.query(internal.execution.context.build, {
        missionId: f.missionId,
        expectedGeneration: 4,
    });
    assert(context.kind === "ready");
    expect(JSON.parse(context.inputJson).activeWork.candidates).toContainEqual(
        expect.objectContaining({
            sourceId: f.sourceId,
            title: "Annual filing",
            form: "10-K",
            publishedAt: 1771891200000,
            date: "2026-02-24T00:00:00.000Z",
            dateKind: "filing",
        }),
    );
});

test("shared reading exposes acquisition destinations only to capable missions and keeps Sources target resolution", async () => {
    const f = await seedCapturedSources();
    const destinations = extractObservedDestinations(
        '<a href="https://example.com/annual">Annual report</a>',
        "https://example.com",
    );
    await f.t.run(async (ctx) => {
        await ctx.db.patch(f.captureId, { observedDestinations: destinations });
        await ctx.db.patch(f.runId, {
            startMode: "framed",
            agentExecutionVersion: 3,
        });
    });
    await f.t
        .withIdentity({ subject: f.userId })
        .mutation(api.execution.conversations.submit, {
            runId: f.runId,
            requestKey: "explain-retained",
            text: "Explain the retained material without acquiring other documents.",
            delivery: "queue",
        });
    const turnId = await f.t.mutation(
        internal.execution.conversations.claimTurn,
        { runId: f.runId, single: true },
    );
    assert(turnId);
    const workbenchId = await f.t.mutation(internal.execution.missions.start, {
        runId: f.runId,
        definitionId: "workbench_v1",
        scope: { kind: "workbench_v1" },
        conversationTurnId: turnId,
        expectedGeneration: 1,
        requestKey: "explain-retained",
    });
    await f.t.run((ctx) => ctx.db.patch(workbenchId, { definitionVersion: 9 }));
    const statuses = [];
    for (const [missionId, expectedGeneration] of [
        [f.missionId, 4],
        [workbenchId, 1],
    ] as const) {
        const requestId = await f.t.mutation(
            internal.execution.operations.enqueue,
            {
                missionId,
                expectedGeneration,
                cause: "read-with-permissions",
                input: {
                    kind: "read_in_context",
                    sourceId: f.sourceId,
                    passageOrder: f.passage.order,
                },
            },
        );
        const outcome = await dispatchFixtureOperation(f.t, {
            requestId,
            expectedGeneration,
        });
        assert(outcome.kind === "success");
        statuses.push(JSON.parse(outcome.valueJson).documentaryStatus);
    }
    const [sources, workbench] = statuses;
    expect(sources.observedDestinations).toMatchObject([
        { index: 0, urlPreview: "https://example.com/annual" },
    ]);
    expect(workbench).not.toHaveProperty("observedDestinations");
    const { observedDestinations: _destinations, ...permissions } = sources;
    expect(workbench).toEqual(permissions);

    const requestId = await f.t.mutation(
        internal.execution.operations.enqueue,
        {
            missionId: f.missionId,
            expectedGeneration: 4,
            cause: "acquire-observed-document",
            input: {
                kind: "make_source_consultable",
                needId: "common-context",
                observedCaptureId: f.captureId,
                observedLinkIndex: sources.observedDestinations[0].index,
            },
        },
    );
    await startSourcesOperation(f.t, {
        requestId,
        expectedGeneration: 4,
    });
    const reserved = await f.t.mutation(internal.sourcesMission.reserve, {
        epoch: 1,
        requestId,
        expectedGeneration: 4,
    });
    const acquiredSourceId = reserved.sourceId;
    assert(acquiredSourceId);
    expect(await f.t.run((ctx) => ctx.db.get(acquiredSourceId))).toMatchObject({
        canonicalUrl: "https://example.com/annual",
        category: "observed_destination",
        providerReference: `capture:${f.captureId}:link:0`,
    });
});

test("saved material dates reconcile the verified capture with its metadata without changing capture identity", async () => {
    const text =
        "BOSTON, October 29, 2026 (GLOBE NEWSWIRE) -- The workflow remains controlled by the insurer.";
    const f = await seedInspectedEvidence({ text });
    await f.t.run((ctx) =>
        ctx.db.patch(f.sourceId, {
            origin: "exa",
            publishedAt: Date.UTC(2026, 9, 28),
        }),
    );
    const missionId = await startRetainedInspection(f.t, {
        runId: f.runId,
        corpusRevisionId: f.corpusRevisionId,
        requestKey: "capture-dateline",
        expectedGeneration: 4,
    });
    const requestId = await f.t.mutation(
        internal.execution.operations.enqueue,
        {
            missionId,
            expectedGeneration: 4,
            cause: "dated-capture",
            input: {
                kind: "search_available_material",
                sourceId: f.sourceId,
                query: "workflow",
            },
        },
    );
    const result = await dispatchFixtureOperation(f.t, {
        requestId,
        expectedGeneration: 4,
    });
    assert(result.kind === "success", JSON.stringify(result));
    const value = JSON.parse(result.valueJson);
    expect(value.captureId).toBe(f.captureId);
    expect(value.document.dates.publication.status).toBe("conflict");
    expect(
        value.document.dates.publication.evidence.map(
            (item: { value: string }) => item.value,
        ),
    ).toEqual(["2026-10-28", "2026-10-29"]);
    expect(value.document.publishedAt).toBeNull();
    expect(value.document.date).toBeNull();
});

test("a pinned Sources reader opens capture bytes of unverified completeness", async () => {
    const f = await seedCapturedSources();
    await f.t.run((ctx) =>
        ctx.db.patch(f.captureId, {
            representationCompleteness: "unknown",
            readingCompleteness: undefined,
        }),
    );
    const requestId = await f.t.mutation(
        internal.execution.operations.enqueue,
        {
            missionId: f.missionId,
            expectedGeneration: 4,
            cause: "read-unverified-representation",
            input: {
                kind: "read_in_context",
                sourceId: f.sourceId,
                passageOrder: f.passage.order,
            },
        },
    );
    const read = await dispatchFixtureOperation(f.t, {
        requestId,
        expectedGeneration: 4,
    });
    assert(read.kind === "success", JSON.stringify(read));
    const value = JSON.parse(read.valueJson);
    expect(value).toMatchObject({ captureId: f.captureId });
    expect(read.valueJson).toContain(f.passage.quotation);
    expect(value.documentaryStatus.capture).not.toHaveProperty(
        "representationCompleteness",
    );
});

test("Sources 7 can reserve an observed link before its destination is a candidate", async () => {
    const f = await seedCapturedSources();
    await f.t.run(async (ctx) => {
        await ctx.db.patch(f.missionId, { definitionVersion: 7 });
        await ctx.db.patch(f.captureId, {
            observedDestinations: extractObservedDestinations(
                '<a href="https://example.com/observed-report">Exact linked annual report</a>',
                "https://example.com",
            ),
        });
    });
    const readId = await f.t.mutation(internal.execution.operations.enqueue, {
        missionId: f.missionId,
        expectedGeneration: 4,
        cause: "observe-link",
        input: {
            kind: "read_in_context",
            reference: JSON.stringify({
                issuer: "capture",
                captureId: f.captureId,
                version: 2,
            }),
        },
    });
    const read = await dispatchFixtureOperation(f.t, {
        requestId: readId,
        expectedGeneration: 4,
    });
    assert(read.kind === "success", JSON.stringify(read));
    const [link] = JSON.parse(read.valueJson).observedDestinations ?? [];
    expect(link).toEqual(
        expect.objectContaining({
            urlPreview: "https://example.com/observed-report",
            acquisitionReference: expect.any(String),
        }),
    );
    const acquire = async (reference: string) =>
        f.t.mutation(internal.execution.operations.enqueue, {
            missionId: f.missionId,
            expectedGeneration: 4,
            cause: "acquire-observed-link",
            input: { kind: "acquire_document", reference },
        });
    const forged = JSON.stringify({
        ...JSON.parse(link.acquisitionReference),
        index: 99,
    });
    expect(
        await dispatchFixtureOperation(f.t, {
            requestId: await acquire(forged),
            expectedGeneration: 4,
        }),
    ).toMatchObject({ code: "observed_destination_unavailable" });
    const args = {
        requestId: await acquire(link.acquisitionReference),
        expectedGeneration: 4,
    };
    await startSourcesOperation(f.t, args);
    const reserved = await f.t.mutation(internal.sourcesMission.reserve, {
        ...args,
        epoch: 1,
    });
    const sourceId = reserved.sourceId;
    assert(sourceId);
    expect(await f.t.run((ctx) => ctx.db.get(sourceId))).toMatchObject({
        canonicalUrl: "https://example.com/observed-report",
        category: "observed_destination",
        providerReference: `capture:${f.captureId}:link:0`,
    });
    expect(
        (await f.t.run((ctx) => ctx.db.get(f.preparationId)))?.sourcesMission
            ?.acquisitions,
    ).toBe(1);
});
