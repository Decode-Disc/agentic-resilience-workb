import { internal } from "@convex/_generated/api";
import { openMissionPiStorage } from "@convex/integrations/piStorage";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { createModels } from "@earendil-works/pi-ai";
import { createRegistry, Harness } from "@earendil-works/pi-durable";
import { expect, test } from "vitest";
import { seedInspectedEvidence } from "@/__tests__/setup/source-preparation";

const claim = internal.execution.piStore.claim;
const append = internal.execution.piStore.append;

test("a real Pi Harness reopens its retained conversation through Convex operations", async () => {
    const { t, args } = await seedInspectedEvidence();
    const missionId = await t.mutation(internal.execution.missions.start, {
        runId: args.runId,
        corpusRevisionId: args.corpusRevisionId,
        definitionId: "saved_material_inspection_v1",
        requestKey: "pi-harness",
        expectedGeneration: args.executionGeneration,
    });
    async function openAndRead(write: boolean) {
        return t.action(async (ctx) => {
            const storage = await openMissionPiStorage(
                ctx,
                missionId,
                args.executionGeneration,
                "writer",
                BACKGROUND_CONTEXT,
            );
            const harness = await Harness.open(
                storage,
                { models: createModels(), registry: createRegistry() },
                BACKGROUND_CONTEXT,
            );
            try {
                const root = await harness.root(BACKGROUND_CONTEXT);
                if (write)
                    await root.submit(
                        {
                            type: "write",
                            requestId: "retained",
                            entry: {
                                kind: "workbench.note",
                                data: { text: "exact original".repeat(48000) },
                            },
                        },
                        BACKGROUND_CONTEXT,
                    );
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
    }
    const original = await openAndRead(true);
    expect(await openAndRead(false)).toEqual(original);
    expect(original.items).toEqual(
        expect.arrayContaining([
            expect.objectContaining({
                kind: "workbench.note",
                data: { text: "exact original".repeat(48000) },
            }),
        ]),
    );
});

test("a mission admits only one Pi writer until its lease expires", async () => {
    const { t, args } = await seedInspectedEvidence();
    const missionId = await t.mutation(internal.execution.missions.start, {
        runId: args.runId,
        corpusRevisionId: args.corpusRevisionId,
        definitionId: "saved_material_inspection_v1",
        requestKey: "pi-writer",
        expectedGeneration: args.executionGeneration,
    });
    const input = {
        missionId,
        expectedGeneration: args.executionGeneration,
        writer: "first",
    };
    const first = await t.mutation(claim, input);
    expect(await t.mutation(claim, input)).toEqual(first);
    await expect(
        t.mutation(claim, { ...input, writer: "second" }),
    ).rejects.toThrow("pi_writer_busy");
    await t.run((ctx) =>
        ctx.db.patch(first.sessionId, { leaseUntil: Date.now() - 1 }),
    );
    expect(
        await t.mutation(claim, { ...input, writer: "second" }),
    ).toMatchObject({ sessionId: first.sessionId, epoch: first.epoch + 1 });
    await expect(
        t.mutation(append, {
            ...first,
            sequence: 1,
            key: "old-writer",
            payload: "[]",
        }),
    ).rejects.toThrow("pi_writer_fenced");
});

test("a committed Pi append is reused and neither a conflicting payload nor a stale generation can replace it", async () => {
    const { t, args, visitorId } = await seedInspectedEvidence();
    const missionId = await t.mutation(internal.execution.missions.start, {
        runId: args.runId,
        corpusRevisionId: args.corpusRevisionId,
        definitionId: "saved_material_inspection_v1",
        requestKey: "pi-append",
        expectedGeneration: args.executionGeneration,
    });
    const lease = await t.mutation(claim, {
        missionId,
        expectedGeneration: args.executionGeneration,
        writer: "first",
    });
    const input = { ...lease, sequence: 1, key: "commit", payload: "[]" };
    expect(await t.mutation(append, input)).toBe(1);
    expect(await t.mutation(append, input)).toBe(1);
    await expect(
        t.mutation(append, { ...input, payload: "[{}]" }),
    ).rejects.toThrow("pi_commit_conflict");
    expect(
        await t.run((ctx) =>
            ctx.db
                .query("piCommits")
                .withIndex("by_session_and_sequence", (q) =>
                    q.eq("sessionId", lease.sessionId),
                )
                .collect(),
        ),
    ).toHaveLength(1);
    await t.run((ctx) => ctx.db.patch(visitorId, { status: "revoked" }));
    await expect(
        t.mutation(append, { ...input, sequence: 2, key: "revoked" }),
    ).rejects.toThrow("not_authorized");
    await t.run(async (ctx) => {
        await ctx.db.patch(visitorId, { status: "active" });
        await ctx.db.patch(missionId, {
            generation: args.executionGeneration + 1,
        });
    });
    await expect(
        t.mutation(append, { ...input, sequence: 2, key: "stale" }),
    ).rejects.toThrow("pi_writer_fenced");
});

test("the Convex writer rejects a commit beyond retained replay capacity without advancing its sequence", async () => {
    const { PI_SESSION_MAX_BYTES } = await import("@convex/resourceLimits");
    const { t, args } = await seedInspectedEvidence();
    const missionId = await t.mutation(internal.execution.missions.start, {
        runId: args.runId,
        corpusRevisionId: args.corpusRevisionId,
        definitionId: "saved_material_inspection_v1",
        requestKey: "pi-byte-limit",
        expectedGeneration: 4,
    });
    const lease = await t.mutation(claim, {
        missionId,
        expectedGeneration: 4,
        writer: "bounded",
    });
    await t.run((ctx) =>
        ctx.db.patch(lease.sessionId, {
            retainedBytes: PI_SESSION_MAX_BYTES - 1,
        }),
    );
    await expect(
        t.mutation(append, {
            ...lease,
            sequence: 1,
            key: "oversized",
            payload: "[]",
        }),
    ).rejects.toThrow("pi_storage_capacity");
    expect(await t.run((ctx) => ctx.db.get(lease.sessionId))).toMatchObject({
        sequence: 0,
        retainedBytes: PI_SESSION_MAX_BYTES - 1,
    });
    expect(await t.run((ctx) => ctx.db.query("piCommits").collect())).toEqual(
        [],
    );
});

test("a generation change fences an older mission writer without waiting for its obsolete lease", async () => {
    const { t, args } = await seedInspectedEvidence();
    const missionId = await t.mutation(internal.execution.missions.start, {
        runId: args.runId,
        corpusRevisionId: args.corpusRevisionId,
        definitionId: "saved_material_inspection_v1",
        requestKey: "generation-handover",
        expectedGeneration: args.executionGeneration,
    });
    const first = await t.mutation(claim, {
        missionId,
        expectedGeneration: args.executionGeneration,
        writer: "old-generation",
    });
    await t.run(async (ctx) => {
        await ctx.db.patch(args.runId, {
            executionGeneration: args.executionGeneration + 1,
        });
        await ctx.db.patch(missionId, {
            generation: args.executionGeneration + 1,
        });
    });
    const next = await t.mutation(claim, {
        missionId,
        expectedGeneration: args.executionGeneration + 1,
        writer: "new-generation",
    });
    expect(next.sessionId).toBe(first.sessionId);
    expect(next.epoch).toBe(first.epoch + 1);
    await expect(
        t.mutation(append, {
            ...first,
            sequence: 1,
            key: "late-generation",
            payload: "[]",
        }),
    ).rejects.toThrow("pi_writer_fenced");
});

test("fragment staging charges persisted bytes once, publishes only complete commits and fences a replaced writer", async () => {
    const { retainedTextParts } = await import(
        "@convex/execution/retainedText"
    );
    const { t, args } = await seedInspectedEvidence();
    const missionId = await t.mutation(internal.execution.missions.start, {
        runId: args.runId,
        corpusRevisionId: args.corpusRevisionId,
        definitionId: "saved_material_inspection_v1",
        requestKey: "staged-commit",
        expectedGeneration: 4,
    });
    const lease = await t.mutation(claim, {
        missionId,
        expectedGeneration: 4,
        writer: "fragment-writer",
    });
    const { manifest, parts } = retainedTextParts(
        JSON.stringify([{ id: 2, value: "🧭".repeat(180000) }]),
    );
    const first = {
        ...lease,
        key: "immutable",
        fragment: { ...manifest, index: 0, content: parts[0] ?? "" },
    };
    const textId = await t.mutation(
        internal.execution.piStore.stageCommit,
        first,
    );
    await t.mutation(internal.execution.piStore.stageCommit, first);
    expect(
        (await t.run((ctx) => ctx.db.get(lease.sessionId)))?.retainedBytes,
    ).toBe(new TextEncoder().encode(parts[0]).length);
    await expect(
        t.mutation(internal.execution.piStore.publishCommit, {
            ...lease,
            key: "immutable",
            sequence: 1,
            textId,
            nextId: 3,
        }),
    ).rejects.toThrow("retained_text_incomplete");
    expect(
        (
            await t.query(internal.execution.piStore.scan, {
                ...lease,
                paginationOpts: { numItems: 1, cursor: null },
            })
        ).page,
    ).toHaveLength(0);
    for (let index = 1; index < parts.length; index++)
        await t.mutation(internal.execution.piStore.stageCommit, {
            ...first,
            fragment: { ...manifest, index, content: parts[index] ?? "" },
        });
    const publication = {
        ...lease,
        key: "immutable",
        sequence: 1,
        textId,
        nextId: 3,
    };
    expect(
        await t.mutation(internal.execution.piStore.publishCommit, publication),
    ).toBe(1);
    expect(
        await t.mutation(internal.execution.piStore.publishCommit, publication),
    ).toBe(1);
    expect(
        (await t.run((ctx) => ctx.db.get(lease.sessionId)))?.retainedBytes,
    ).toBe(manifest.sizeBytes);
    await t.run((ctx) =>
        ctx.db.patch(lease.sessionId, { leaseUntil: Date.now() - 1 }),
    );
    await t.mutation(claim, {
        missionId,
        expectedGeneration: 4,
        writer: "replacement",
    });
    await expect(
        t.mutation(internal.execution.piStore.stageCommit, first),
    ).rejects.toThrow("pi_writer_fenced");
    await expect(
        t.mutation(internal.execution.piStore.publishCommit, publication),
    ).rejects.toThrow("pi_writer_fenced");
});
