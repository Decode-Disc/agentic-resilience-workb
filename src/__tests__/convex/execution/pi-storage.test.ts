import { internal } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { retainedTextParts } from "@convex/execution/retainedText";
import {
    openMissionPiStorage,
    type PiCommit,
    type PiCommitStore,
    PiConvexStorage,
} from "@convex/integrations/piStorage";
import {
    BACKGROUND_CONTEXT,
    withAbortSignal,
} from "@earendil-works/chord/context";
import { createModels } from "@earendil-works/pi-ai";
import {
    createRegistry,
    Harness,
    ROOT_CONVERSATION_ID,
} from "@earendil-works/pi-durable";
import { registerStorageConformance } from "@earendil-works/pi-durable/testing";
import { getFunctionName } from "convex/server";
import { describe, expect, it, test, vi } from "vitest";
import { seedInspectedEvidence } from "@/__tests__/setup/source-preparation";

function database() {
    const commits: PiCommit[] = [];
    let nextId = 1;
    let loseAcknowledgement = false;
    const store: PiCommitStore = {
        async scan(cursor) {
            const offset = Number(cursor ?? 0);
            return {
                commits: commits.slice(offset, offset + 1),
                cursor: offset + 1 < commits.length ? String(offset + 1) : null,
            };
        },
        async append(commit) {
            if (commit.sequence !== commits.length + 1)
                throw new Error("sequence_conflict");
            commits.push(commit);
            for (const write of JSON.parse(commit.payload)) {
                nextId = Math.max(
                    nextId,
                    write.value?.id ?? write.record?.id ?? write.id ?? 1,
                );
            }
            if (loseAcknowledgement) {
                loseAcknowledgement = false;
                throw new Error("lost_acknowledgement");
            }
            return commit.sequence;
        },
        async find(key) {
            return commits.find((commit) => commit.key === key) ?? null;
        },
        async mintId() {
            return ++nextId;
        },
    };
    return {
        commits,
        store,
        loseNextAcknowledgement() {
            loseAcknowledgement = true;
        },
    };
}

registerStorageConformance(
    { describe, expect, it },
    "Pi Convex projection",
    async (use) => {
        const storage = await PiConvexStorage.open(
            database().store,
            BACKGROUND_CONTEXT,
        );
        try {
            await use(storage);
        } finally {
            await storage.close(BACKGROUND_CONTEXT);
        }
    },
);

test.each([
    false,
    true,
])("fragmented replay renews while reading and observes cancellation (cancel=%s)", async (cancel) => {
    vi.useFakeTimers();
    try {
        const f = await seedInspectedEvidence();
        const missionId = await f.t.mutation(
            internal.execution.missions.start,
            {
                runId: f.args.runId,
                corpusRevisionId: f.args.corpusRevisionId,
                expectedGeneration: 4,
                definitionId: "saved_material_inspection_v1",
                requestKey: "fragment-replay-lease",
            },
        );
        const writer = "fragment-replay";
        const lease = await f.t.mutation(internal.execution.piStore.claim, {
            missionId,
            expectedGeneration: 4,
            writer,
        });
        const payload = JSON.stringify([
            { type: "conversation", value: { id: 1 } },
            {
                type: "entry",
                value: {
                    id: 2,
                    conversationId: 1,
                    kind: "workbench.original",
                    data: { text: "x".repeat(31 * 1024 * 1024) },
                },
            },
        ]);
        const { parts, manifest } = retainedTextParts(payload);
        let textId: Id<"retainedTexts"> | undefined;
        for (const [index, content] of parts.entries())
            textId = await f.t.mutation(
                internal.execution.piStore.stageCommit,
                {
                    ...lease,
                    key: "large-commit",
                    fragment: { ...manifest, index, content },
                },
            );
        if (!textId) throw new Error("Expected fragmented commit");
        await f.t.mutation(internal.execution.piStore.publishCommit, {
            ...lease,
            key: "large-commit",
            textId,
            nextId: 3,
            sequence: 1,
        });
        const abort = new AbortController();
        let reads = 0;
        const reopen = f.t.action(async (ctx) => {
            const storage = await openMissionPiStorage(
                {
                    ...ctx,
                    runQuery: async (reference, ...args) => {
                        if (
                            getFunctionName(reference) ===
                            "execution/piStore:readCommitFragment"
                        ) {
                            vi.setSystemTime(Date.now() + 180);
                            if (cancel && ++reads === 5)
                                abort.abort(new Error("replay_cancelled"));
                        }
                        return ctx.runQuery(reference, ...args);
                    },
                },
                missionId,
                4,
                writer,
                withAbortSignal(abort.signal, BACKGROUND_CONTEXT),
            );
            await storage.close(BACKGROUND_CONTEXT);
        });
        if (cancel) {
            await expect(reopen).rejects.toThrow("replay_cancelled");
            expect(reads).toBe(5);
        } else await reopen;
    } finally {
        vi.useRealTimers();
    }
}, 60000);

test("replay renews by elapsed lease time rather than once per page", async () => {
    vi.useFakeTimers();
    try {
        const db = database();
        db.commits.push(
            ...Array.from({ length: 4 }, (_, index) => ({
                sequence: index + 1,
                key: `page-${index}`,
                payload: "[]",
            })),
        );
        const renewLease = vi.fn(async () => undefined);
        const quick = await PiConvexStorage.open(
            { ...db.store, renewLease },
            BACKGROUND_CONTEXT,
        );
        expect(renewLease).not.toHaveBeenCalled();
        await quick.close(BACKGROUND_CONTEXT);
        let page = 0;
        const slow = await PiConvexStorage.open(
            {
                ...db.store,
                renewLease,
                async scan(cursor) {
                    vi.setSystemTime(Date.now() + 10000);
                    page++;
                    return db.store.scan(cursor);
                },
            },
            BACKGROUND_CONTEXT,
        );
        expect(page).toBe(4);
        expect(renewLease).toHaveBeenCalledOnce();
        await slow.close(BACKGROUND_CONTEXT);
    } finally {
        vi.useRealTimers();
    }
});

test("a rejected append never becomes visible in the Pi read projection", async () => {
    const db = database();
    const storage = await PiConvexStorage.open(
        {
            ...db.store,
            async append() {
                throw new Error("persistence_unavailable");
            },
        },
        BACKGROUND_CONTEXT,
    );
    try {
        await expect(
            storage.commit(
                [{ type: "conversation", value: { id: ROOT_CONVERSATION_ID } }],
                BACKGROUND_CONTEXT,
            ),
        ).rejects.toThrow("persistence_unavailable");
        expect(
            await storage.conversation(
                ROOT_CONVERSATION_ID,
                BACKGROUND_CONTEXT,
            ),
        ).toBeUndefined();
        expect(db.commits).toHaveLength(0);
    } finally {
        await storage.close(BACKGROUND_CONTEXT);
    }
});

test("a Pi session reopens the same durable conversation after a lost append acknowledgement", async () => {
    const db = database();
    const options = { models: createModels(), registry: createRegistry() };
    const storage = await PiConvexStorage.open(db.store, BACKGROUND_CONTEXT);
    const harness = await Harness.open(storage, options, BACKGROUND_CONTEXT);
    db.loseNextAcknowledgement();
    const root = await harness.root(BACKGROUND_CONTEXT);
    await root.submit(
        {
            type: "write",
            entry: {
                kind: "workbench.note",
                data: { text: "exact retained original".repeat(32000) },
            },
            requestId: "note",
        },
        BACKGROUND_CONTEXT,
    );
    await harness.close(BACKGROUND_CONTEXT);
    const reopened = await Harness.open(
        await PiConvexStorage.open(db.store, BACKGROUND_CONTEXT),
        options,
        BACKGROUND_CONTEXT,
    );
    try {
        const restored = await reopened.root(BACKGROUND_CONTEXT);
        expect(restored.id).toBe(root.id);
        const entries = await restored.entries(
            { order: "ascending" },
            20,
            undefined,
            BACKGROUND_CONTEXT,
        );
        expect(entries.items).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    kind: "workbench.note",
                    data: { text: "exact retained original".repeat(32000) },
                }),
            ]),
        );
        expect(db.commits.map((commit) => commit.sequence)).toEqual(
            db.commits.map((_, index) => index + 1),
        );
    } finally {
        await reopened.close(BACKGROUND_CONTEXT);
    }
});

test("reopening a log of 120 full operation-sized originals preserves their exact contents", async () => {
    const db = database();
    const options = { models: createModels(), registry: createRegistry() };
    const harness = await Harness.open(
        await PiConvexStorage.open(db.store, BACKGROUND_CONTEXT),
        options,
        BACKGROUND_CONTEXT,
    );
    const text = "x".repeat(64 * 1024);
    try {
        const root = await harness.root(BACKGROUND_CONTEXT);
        for (let i = 0; i < 120; i++)
            await root.submit(
                {
                    type: "write",
                    requestId: `large-${i}`,
                    entry: {
                        kind: "workbench.original",
                        data: { index: i, text },
                    },
                },
                BACKGROUND_CONTEXT,
            );
    } finally {
        await harness.close(BACKGROUND_CONTEXT);
    }
    const reopened = await Harness.open(
        await PiConvexStorage.open(db.store, BACKGROUND_CONTEXT),
        options,
        BACKGROUND_CONTEXT,
    );
    try {
        const root = await reopened.root(BACKGROUND_CONTEXT);
        let page = await root.entries(
            { order: "ascending" },
            17,
            undefined,
            BACKGROUND_CONTEXT,
        );
        expect(page.next).toBeDefined();
        const entries = [...page.items];
        const cursors = new Set<string>();
        while (page.next !== undefined) {
            const cursor = JSON.stringify(page.next);
            expect(cursors.has(cursor)).toBe(false);
            cursors.add(cursor);
            page = await root.entries(
                { order: "ascending" },
                17,
                page.next,
                BACKGROUND_CONTEXT,
            );
            expect(page.items.length).toBeGreaterThan(0);
            entries.push(...page.items);
        }
        expect(
            entries
                .filter((entry) => entry.kind === "workbench.original")
                .map((entry) => entry.data),
        ).toEqual(Array.from({ length: 120 }, (_, index) => ({ index, text })));
        expect(
            db.commits.reduce(
                (bytes, commit) => bytes + commit.payload.length,
                0,
            ),
        ).toBeGreaterThan(120 * 64 * 1024);
    } finally {
        await reopened.close(BACKGROUND_CONTEXT);
    }
}, 30000);

test("a projection whose retained log exceeds 32 MiB stops explicitly before loading further context", async () => {
    const db = database();
    const store = {
        ...db.store,
        async scan(cursor: string | null) {
            const index = Number(cursor ?? 0);
            const value =
                index === 0
                    ? { type: "conversation", value: { id: 1 } }
                    : {
                          type: "entry",
                          value: {
                              id: index + 1,
                              conversationId: 1,
                              kind: "workbench.original",
                              data: { text: "x".repeat(400000) },
                          },
                      };
            return {
                commits: [
                    {
                        key: `bounded-${index}`,
                        sequence: index + 1,
                        payload: JSON.stringify([value]),
                    },
                ],
                cursor: index < 100 ? String(index + 1) : null,
            };
        },
    };
    await expect(
        PiConvexStorage.open(store, BACKGROUND_CONTEXT),
    ).rejects.toMatchObject({ data: { code: "pi_storage_capacity" } });
}, 30000);

test("a transient append failure retries the same commit once without losing a confirmed model result", async () => {
    const db = database();
    const keys: string[] = [];
    const storage = await PiConvexStorage.open(
        {
            ...db.store,
            async append(commit) {
                keys.push(commit.key);
                if (keys.length === 1)
                    throw new Error("transient_write_failure");
                return db.store.append(commit);
            },
        },
        BACKGROUND_CONTEXT,
    );
    try {
        await storage.commit(
            [{ type: "conversation", value: { id: ROOT_CONVERSATION_ID } }],
            BACKGROUND_CONTEXT,
        );
        expect(keys).toHaveLength(2);
        expect(keys[0]).toBe(keys[1]);
        expect(db.commits).toHaveLength(1);
        expect(
            await storage.conversation(
                ROOT_CONVERSATION_ID,
                BACKGROUND_CONTEXT,
            ),
        ).toMatchObject({ id: ROOT_CONVERSATION_ID });
    } finally {
        await storage.close(BACKGROUND_CONTEXT);
    }
});
