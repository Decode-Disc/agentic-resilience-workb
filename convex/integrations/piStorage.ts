import { internal } from "@convex/_generated/api";
import type { Id as ConvexId, Doc } from "@convex/_generated/dataModel";
import type { ActionCtx } from "@convex/_generated/server";
import { executionError } from "@convex/execution/errors";
import {
    PI_COMMIT_MAX_BYTES,
    PI_SESSION_MAX_BYTES,
} from "@convex/resourceLimits";
import type { Context } from "@earendil-works/chord/context";
import {
    type Id,
    MemoryStorage,
    type Seq,
    type StorageWrite,
} from "@earendil-works/pi-durable";

export type PiCommit = Pick<Doc<"piCommits">, "sequence" | "key" | "payload">;

/** Convex callbacks carry a fenced writer identity; the Pi projection owns all read semantics. */
export type PiCommitStore = {
    scan(
        cursor: string | null,
    ): Promise<{ commits: PiCommit[]; cursor: string | null }>;
    append(commit: PiCommit): Promise<number>;
    find(key: string): Promise<PiCommit | null>;
    mintId(): Promise<number>;
    renewLease?(): Promise<void>;
};

/** Opens a mission-scoped projection using the same fenced Convex identity for every storage operation. */
export async function openMissionPiStorage(
    ctx: ActionCtx,
    missionId: ConvexId<"agentMissions">,
    expectedGeneration: number,
    writer: string,
    context: Context,
) {
    const lease = await ctx.runMutation(internal.execution.piStore.claim, {
        missionId,
        expectedGeneration,
        writer,
    });
    return PiConvexStorage.open(
        {
            async scan(cursor) {
                const page = await ctx.runQuery(
                    internal.execution.piStore.scan,
                    {
                        ...lease,
                        paginationOpts: {
                            numItems: 16,
                            maximumBytesRead: 2 * 1024 * 1024,
                            cursor,
                        },
                    },
                );
                return {
                    commits: page.page,
                    cursor: page.isDone ? null : page.continueCursor,
                };
            },
            append: (commit) =>
                ctx.runMutation(internal.execution.piStore.append, {
                    ...lease,
                    ...commit,
                }),
            find: (key) =>
                ctx.runQuery(internal.execution.piStore.find, {
                    ...lease,
                    key,
                }),
            renewLease: () =>
                ctx
                    .runMutation(internal.execution.piStore.renew, lease)
                    .then(() => undefined),
            mintId: () =>
                ctx.runMutation(internal.execution.piStore.mint, lease),
        },
        context,
    );
}

/** Persist-before-adopt binding; a confirmed append can be recovered after its acknowledgement is lost. */
export class PiConvexStorage extends MemoryStorage {
    private sequence = 0;
    private retainedBytes = 0;
    private ended = false;

    private constructor(private readonly store: PiCommitStore) {
        super();
    }

    static async open(
        store: PiCommitStore,
        context: Context,
    ): Promise<PiConvexStorage> {
        const storage = new PiConvexStorage(store);
        let cursor: string | null = null;
        do {
            context.abortSignal?.throwIfAborted();
            const page = await store.scan(cursor);
            for (const commit of page.commits) {
                if (commit.sequence !== storage.sequence + 1)
                    throw new Error("pi_log_sequence_conflict");
                const bytes = storage.checkCapacity(commit.payload);
                const writes: StorageWrite[] = JSON.parse(commit.payload);
                storage.prepareCommit(writes, commit.sequence as Seq).apply();
                storage.sequence = commit.sequence;
                storage.retainedBytes += bytes;
            }
            if (page.cursor !== null && page.cursor === cursor)
                throw new Error("pi_log_cursor_conflict");
            if (page.cursor !== null) {
                context.abortSignal?.throwIfAborted();
                await store.renewLease?.();
            }
            cursor = page.cursor;
        } while (cursor !== null);
        return storage;
    }

    private checkCapacity(payload: string): number {
        const bytes = new TextEncoder().encode(payload).length;
        if (bytes > PI_COMMIT_MAX_BYTES)
            throw executionError("pi_commit_capacity");
        if (this.retainedBytes + bytes > PI_SESSION_MAX_BYTES)
            throw executionError("pi_storage_capacity");
        return bytes;
    }

    async renewLease(): Promise<void> {
        if (this.ended || !this.store.renewLease)
            throw new Error("pi_storage_closed");
        await this.store.renewLease();
    }

    override async mintId<I extends Id<string>>(): Promise<I> {
        if (this.ended) throw new Error("pi_storage_closed");
        const id = await this.store.mintId();
        if (!Number.isSafeInteger(id) || id < 2)
            throw new Error("ID space is exhausted");
        return id as I;
    }

    override async close(context: Context): Promise<void> {
        this.ended = true;
        await super.close(context);
    }

    override async commit(
        writes: readonly StorageWrite[],
        context: Context,
    ): Promise<Seq> {
        if (this.ended) throw new Error("pi_storage_closed");
        context.abortSignal?.throwIfAborted();
        const prepared = this.prepareCommit(writes, (this.sequence + 1) as Seq);
        const commit = {
            sequence: this.sequence + 1,
            key: crypto.randomUUID(),
            payload: JSON.stringify(prepared.writes),
        };
        const bytes = this.checkCapacity(commit.payload);
        let confirmed: number | undefined;
        for (let attempt = 0; attempt < 2; attempt++) {
            context.abortSignal?.throwIfAborted();
            try {
                confirmed = await this.store.append(commit);
                break;
            } catch (error) {
                const retained = await this.store.find(commit.key);
                if (retained) {
                    if (
                        retained.payload !== commit.payload ||
                        retained.sequence !== commit.sequence
                    )
                        throw new Error("pi_commit_conflict");
                    confirmed = retained.sequence;
                    break;
                }
                if (attempt === 1) throw error;
            }
        }
        if (confirmed !== commit.sequence)
            throw new Error("pi_log_sequence_conflict");
        const sequence = prepared.apply();
        this.sequence = confirmed;
        this.retainedBytes += bytes;
        return sequence;
    }
}
