import {
    type PiCommit,
    type PiCommitStore,
    PiConvexStorage,
} from "@convex/integrations/piStorage";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { createModels } from "@earendil-works/pi-ai";
import {
    createRegistry,
    Harness,
    ROOT_CONVERSATION_ID,
} from "@earendil-works/pi-durable";
import { registerStorageConformance } from "@earendil-works/pi-durable/testing";
import { describe, expect, it, test } from "vitest";

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
                data: { text: "exact retained original" },
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
                    data: { text: "exact retained original" },
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
        const entries = await root.entries(
            { order: "descending" },
            1,
            undefined,
            BACKGROUND_CONTEXT,
        );
        expect(entries.items).toEqual([
            expect.objectContaining({
                kind: "workbench.original",
                data: { index: 119, text },
            }),
        ]);
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
