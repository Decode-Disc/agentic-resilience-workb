import type { Doc, Id } from "@convex/_generated/dataModel";
import {
    internalMutation,
    internalQuery,
    type MutationCtx,
    type QueryCtx,
} from "@convex/_generated/server";
import {
    advanceSha256,
    completeCharacterBoundary,
    sha256CheckpointHex,
    sha256Hex,
} from "@convex/domain/sourcePassages";
import {
    CONVEX_MAX_ARRAY_VALUES,
    CONVEX_MAX_DOCUMENT_BYTES,
    TEXT_FRAGMENT_CHARACTERS,
} from "@convex/resourcePolicy";
import type { PaginationOptions } from "convex/server";
import { getDocumentSize, type Infer, v } from "convex/values";
import { executionError } from "./errors";
import { ONE_SHOT_PREPARATION_OPERATIONS } from "./executionProtocol";
export const textManifestValidator = v.object({
    contentHash: v.string(),
    sizeBytes: v.number(),
    characters: v.number(),
    fragmentHashes: v.array(v.string()),
});
export const textFragmentValidator = v.object({
    ...textManifestValidator.fields,
    index: v.number(),
    content: v.string(),
});

function requireManifestCapacity(
    text: Omit<Doc<"retainedTexts">, "_id" | "_creationTime">,
) {
    const open = text.stream && !text.stream.sealed ? text.stream : undefined;
    const fragmentCount = open
        ? open.fragments + (open.tail || !open.fragments ? 1 : 0)
        : text.fragmentHashes.length;
    if (
        fragmentCount > CONVEX_MAX_ARRAY_VALUES ||
        getDocumentSize(text) > CONVEX_MAX_DOCUMENT_BYTES
    )
        throw executionError("retained_text_manifest_capacity");
}

async function streamUpgradeControl(ctx: QueryCtx) {
    return ctx.db
        .query("piPublication")
        .withIndex("by_key", (q) => q.eq("key", "workers"))
        .unique();
}

/** A deployment hold blocks new one-shot dispatch while started invocations drain. */
export async function requireRetainedStreamDispatch(ctx: QueryCtx) {
    const phase = (await streamUpgradeControl(ctx))?.retainedStreamUpgrade;
    if (phase === "draining" || phase === "frozen")
        throw executionError("retained_stream_upgrade_held");
}

async function retainedStreamWritePhase(ctx: QueryCtx) {
    const phase = (await streamUpgradeControl(ctx))?.retainedStreamUpgrade;
    if (phase === "frozen")
        throw executionError("retained_stream_upgrade_held");
    return phase;
}

async function unresolvedStream(ctx: QueryCtx) {
    return ctx.db
        .query("retainedTexts")
        .withIndex("by_stream_manifest_readiness", (q) =>
            q.eq("stream.sealed", false).eq("streamManifestReady", undefined),
        )
        .first();
}

export const nextUnresolvedStream = internalQuery({
    args: {},
    returns: v.union(v.id("retainedTexts"), v.null()),
    handler: async (ctx) => {
        await requireFrozenStreamUpgrade(ctx);
        return (await unresolvedStream(ctx))?._id ?? null;
    },
});

async function streamFreezeBlocker(ctx: QueryCtx) {
    const writer = await ctx.db
        .query("agentInvocations")
        .withIndex("by_mission_and_status", (q) =>
            q.eq("missionId", undefined).eq("status", "started"),
        )
        .first();
    if (writer)
        return { kind: "invocation" as const, invocationId: writer._id };
    // Admission records the receipt before it creates the stream's invocation.
    for (const operation of ONE_SHOT_PREPARATION_OPERATIONS) {
        const receipt = await ctx.db
            .query("providerCalls")
            .withIndex("by_mission_service_status_operation", (q) =>
                q
                    .eq("missionId", undefined)
                    .eq("service", "model")
                    .eq("status", "started")
                    .eq("operation", operation),
            )
            .first();
        if (receipt)
            return {
                kind: "provider_receipt" as const,
                providerCallId: receipt._id,
            };
    }
    return null;
}

const streamUpgradePhase = v.union(
    v.literal("draining"),
    v.literal("frozen"),
    v.literal("active"),
);

const streamUpgradeStatusValidator = v.object({
    phase: v.union(v.literal("unstarted"), ...streamUpgradePhase.members),
    blocker: v.union(
        v.object({
            kind: v.literal("invocation"),
            invocationId: v.id("agentInvocations"),
        }),
        v.object({
            kind: v.literal("provider_receipt"),
            providerCallId: v.id("providerCalls"),
        }),
        v.object({
            kind: v.literal("unresolved_manifest"),
            textId: v.id("retainedTexts"),
        }),
        v.null(),
    ),
});

/** Exposes the next record preventing the current maintenance phase from advancing. */
export const streamUpgradeStatus = internalQuery({
    args: {},
    returns: streamUpgradeStatusValidator,
    handler: async (
        ctx,
    ): Promise<Infer<typeof streamUpgradeStatusValidator>> => {
        const phase =
            (await streamUpgradeControl(ctx))?.retainedStreamUpgrade ??
            "unstarted";
        if (phase === "draining")
            return { phase, blocker: await streamFreezeBlocker(ctx) };
        const text = phase === "frozen" ? await unresolvedStream(ctx) : null;
        return {
            phase,
            blocker: text
                ? { kind: "unresolved_manifest" as const, textId: text._id }
                : null,
        };
    },
});

export const advanceStreamUpgrade = internalMutation({
    args: {
        phase: streamUpgradePhase,
    },
    returns: v.null(),
    handler: async (ctx, { phase }) => {
        const control = await streamUpgradeControl(ctx);
        const previous = control?.retainedStreamUpgrade;
        if (previous === phase) return null;
        if (
            (phase === "draining" && previous !== undefined) ||
            (phase === "frozen" && previous !== "draining") ||
            (phase === "active" && previous !== "frozen")
        )
            throw executionError("retained_stream_upgrade_order");
        if (phase === "frozen" && (await streamFreezeBlocker(ctx)))
            throw executionError("retained_stream_writers_active");
        if (phase === "active" && (await unresolvedStream(ctx)))
            throw executionError("retained_text_incomplete");
        if (control)
            await ctx.db.patch(control._id, { retainedStreamUpgrade: phase });
        else
            await ctx.db.insert("piPublication", {
                key: "workers",
                held: false,
                retainedStreamUpgrade: phase,
            });
        return null;
    },
});

function hasPackedStreamManifest(
    text: Doc<"retainedTexts">,
    fragments: number,
) {
    return (
        text.fragmentHashes.length === fragments &&
        text.fragmentEnds.length === fragments &&
        (text.fragmentEnds.at(-1) ?? 0) ===
            text.receivedCharacters - (text.stream?.tail.length ?? 0)
    );
}

function usesLegacyStreamLayout(
    text: Doc<"retainedTexts">,
    fragments: number,
    phase: "draining" | "active" | undefined,
) {
    if (hasPackedStreamManifest(text, fragments)) return false;
    // The additive release must let old producers drain before activation.
    if (
        phase !== "active" &&
        !text.streamManifestReady &&
        !text.streamManifestBackfill &&
        text.fragmentHashes.length === 0 &&
        text.fragmentEnds.length === 0
    )
        return true;
    throw executionError("retained_text_incomplete");
}

/** Reconstruct one legacy fragment per transaction and verify the original prefix before use. */
export const backfillStreamManifest = internalMutation({
    args: { textId: v.id("retainedTexts") },
    returns: v.object({ ready: v.boolean() }),
    handler: async (ctx, { textId }) => {
        await requireFrozenStreamUpgrade(ctx);
        return backfillStreamFragment(ctx, await ctx.db.get(textId));
    },
});

/** Advances one unresolved manifest without relying on an operator-held cursor. */
export const backfillNextStream = internalMutation({
    args: {},
    returns: v.union(
        v.object({ textId: v.id("retainedTexts"), ready: v.boolean() }),
        v.null(),
    ),
    handler: async (ctx) => {
        await requireFrozenStreamUpgrade(ctx);
        const text = await unresolvedStream(ctx);
        if (!text) return null;
        return {
            textId: text._id,
            ...(await backfillStreamFragment(ctx, text)),
        };
    },
});

async function requireFrozenStreamUpgrade(ctx: QueryCtx) {
    if ((await streamUpgradeControl(ctx))?.retainedStreamUpgrade !== "frozen")
        throw executionError("retained_stream_upgrade_order");
}

async function backfillStreamFragment(
    ctx: MutationCtx,
    text: Doc<"retainedTexts"> | null,
) {
    if (!text?.stream || text.stream.sealed)
        throw executionError("retained_text_invalid");
    const textId = text._id;
    const stream = text.stream;
    const original = text.checkpoint;
    const frontier = sha256Hex(
        JSON.stringify([
            stream.nextSequence,
            stream.lastAppendHash,
            stream.fragments,
            stream.tail,
            text.receivedCharacters,
            text.receivedBytes,
            original?.words,
            original?.tail,
            original?.sizeBytes,
        ]),
    );
    const progress = text.streamManifestBackfill;
    if (progress && progress.frontier !== frontier)
        throw executionError("retained_text_conflict");
    if (!progress && hasPackedStreamManifest(text, stream.fragments)) {
        if (!text.streamManifestReady)
            await ctx.db.patch(textId, { streamManifestReady: true });
        return { ready: true };
    }

    const index = text.fragmentHashes.length;
    if (
        index !== text.fragmentEnds.length ||
        index >= stream.fragments ||
        (!progress && index !== 0) ||
        !original
    )
        throw executionError("retained_text_invalid");
    const content = await diagnosticFragment(ctx, textId, index);
    const end = (text.fragmentEnds.at(-1) ?? 0) + content.length;
    const encoder = new TextEncoder();
    const checkpoint = advanceSha256(
        progress?.checkpoint,
        encoder.encode(content),
    );
    const prefixCharacters = text.receivedCharacters - stream.tail.length;
    const prefixBytes = text.receivedBytes - encoder.encode(stream.tail).length;
    const ready = index + 1 === stream.fragments;
    if (
        end > prefixCharacters ||
        checkpoint.sizeBytes > prefixBytes ||
        (ready &&
            (end !== prefixCharacters ||
                checkpoint.sizeBytes !== prefixBytes ||
                checkpoint.sizeBytes !== original.sizeBytes ||
                sha256CheckpointHex(checkpoint) !==
                    sha256CheckpointHex(original)))
    )
        throw executionError("retained_text_invalid");
    const patch = {
        fragmentHashes: [...text.fragmentHashes, sha256Hex(content)],
        fragmentEnds: [...text.fragmentEnds, end],
        streamManifestReady: ready ? (true as const) : undefined,
        streamManifestBackfill: ready ? undefined : { frontier, checkpoint },
    };
    requireManifestCapacity({ ...text, ...patch });
    await ctx.db.patch(textId, patch);
    return { ready };
}

/** Ordered append identity is independent of immutable packed-fragment layout. */
export async function appendRetainedText(
    ctx: MutationCtx,
    key: string,
    sequence: number,
    content: string,
) {
    const phase = await retainedStreamWritePhase(ctx);
    if (
        !Number.isSafeInteger(sequence) ||
        sequence < 0 ||
        content.length > TEXT_FRAGMENT_CHARACTERS
    )
        throw executionError("retained_text_invalid");
    let text = await ctx.db
        .query("retainedTexts")
        .withIndex("by_key", (q) => q.eq("key", key))
        .unique();
    const hash = sha256Hex(content);
    if (text && !text.stream) throw executionError("retained_text_conflict");
    if (
        text?.stream &&
        sequence === text.stream.nextSequence - 1 &&
        text.stream.lastAppendHash === hash
    )
        return text._id;
    if ((text?.stream?.nextSequence ?? 0) !== sequence || text?.stream?.sealed)
        throw executionError("retained_text_sequence");
    const textId =
        text?._id ??
        (await ctx.db.insert("retainedTexts", {
            key,
            contentHash: sha256Hex(""),
            sizeBytes: 0,
            characters: 0,
            fragmentHashes: [],
            received: 0,
            receivedBytes: 0,
            receivedCharacters: 0,
            fragmentEnds: [],
            stream: { sealed: false, nextSequence: 0, fragments: 0, tail: "" },
        }));
    text ??= await ctx.db.get(textId);
    if (!text?.stream) throw executionError("retained_text_invalid");
    const legacy = usesLegacyStreamLayout(text, text.stream.fragments, phase);
    const fragmentHashes = [...text.fragmentHashes];
    const fragmentEnds = [...text.fragmentEnds];
    let endOffset = fragmentEnds.at(-1) ?? 0;
    let tail = text.stream.tail + content;
    let fragments = text.stream.fragments;
    let checkpoint = text.checkpoint;
    while (tail.length >= TEXT_FRAGMENT_CHARACTERS) {
        let end = TEXT_FRAGMENT_CHARACTERS;
        const last = tail.charCodeAt(end - 1);
        if (last >= 0xd800 && last <= 0xdbff) end--;
        const fragment = tail.slice(0, end);
        await ctx.db.insert("retainedTextFragments", {
            textId,
            index: fragments++,
            content: fragment,
        });
        checkpoint = advanceSha256(
            checkpoint,
            new TextEncoder().encode(fragment),
        );
        if (!legacy) {
            fragmentHashes.push(sha256Hex(fragment));
            endOffset += fragment.length;
            fragmentEnds.push(endOffset);
        }
        tail = tail.slice(end);
    }
    const encoder = new TextEncoder();
    const patch = {
        receivedBytes:
            text.receivedBytes +
            encoder.encode(text.stream.tail + content).length -
            encoder.encode(text.stream.tail).length,
        receivedCharacters: text.receivedCharacters + content.length,
        checkpoint,
        streamManifestReady: legacy ? undefined : (true as const),
        fragmentHashes,
        fragmentEnds,
        stream: {
            sealed: false,
            nextSequence: sequence + 1,
            lastAppendHash: hash,
            fragments,
            tail,
        },
    };
    requireManifestCapacity({ ...text, ...patch });
    await ctx.db.patch(textId, patch);
    return textId;
}

/** Seal the remaining tail against the manifest accumulated by ordered appends. */
export async function sealRetainedText(
    ctx: MutationCtx,
    textId: Id<"retainedTexts">,
) {
    const phase = await retainedStreamWritePhase(ctx);
    const text = await ctx.db.get(textId);
    if (!text?.stream) throw executionError("retained_text_invalid");
    if (text.stream.sealed) return text;
    const { fragments, tail } = text.stream;
    const legacy = usesLegacyStreamLayout(text, fragments, phase);
    const tailBytes = new TextEncoder().encode(tail);
    if (
        (text.checkpoint?.sizeBytes ?? 0) + tailBytes.length !==
        text.receivedBytes
    )
        throw executionError("retained_text_invalid");
    const fragmentHashes = [...text.fragmentHashes];
    const fragmentEnds = [...text.fragmentEnds];
    if (legacy) {
        const packed = await ctx.db
            .query("retainedTextFragments")
            .withIndex("by_text_and_index", (q) => q.eq("textId", textId))
            .take(fragments + 1);
        if (packed.length !== fragments)
            throw executionError("retained_text_incomplete");
        let end = 0;
        for (const [index, fragment] of packed.entries()) {
            if (fragment.index !== index)
                throw executionError("retained_text_incomplete");
            end += fragment.content.length;
            fragmentHashes.push(sha256Hex(fragment.content));
            fragmentEnds.push(end);
        }
        if (end + tail.length !== text.receivedCharacters)
            throw executionError("retained_text_invalid");
    }
    let checkpoint = text.checkpoint;
    if (tail || !fragments) {
        await ctx.db.insert("retainedTextFragments", {
            textId,
            index: fragments,
            content: tail,
        });
        checkpoint = advanceSha256(checkpoint, tailBytes);
        fragmentHashes.push(sha256Hex(tail));
        fragmentEnds.push(text.receivedCharacters);
    }
    if (!checkpoint) throw executionError("retained_text_invalid");
    const patch = {
        contentHash: sha256CheckpointHex(checkpoint),
        sizeBytes: text.receivedBytes,
        characters: text.receivedCharacters,
        fragmentHashes,
        fragmentEnds,
        received: fragmentHashes.length,
        stream: { ...text.stream, sealed: true, tail: "" },
    };
    requireManifestCapacity({ ...text, ...patch });
    await ctx.db.patch(textId, patch);
    return { ...text, ...patch };
}

/** Splits UTF-16 without cutting a surrogate pair; hashes describe the exact UTF-8 bytes. */
export function retainedTextParts(content: string) {
    const parts: string[] = [];
    for (let offset = 0; offset < content.length; ) {
        const end = completeCharacterBoundary(
            content,
            Math.min(offset + TEXT_FRAGMENT_CHARACTERS, content.length),
        );
        parts.push(content.slice(offset, end));
        offset = end;
    }
    if (!parts.length) parts.push("");
    return {
        parts,
        manifest: {
            contentHash: sha256Hex(content),
            sizeBytes: new TextEncoder().encode(content).length,
            characters: content.length,
            fragmentHashes: parts.map(sha256Hex),
        },
    };
}

/** Retains an immutable logical text using the same verified fragments as native observations. */
export async function retainCompleteText(
    ctx: MutationCtx,
    key: string,
    content: string,
) {
    const { manifest, parts } = retainedTextParts(content);
    let textId: Id<"retainedTexts"> | undefined;
    for (const [index, part] of parts.entries()) {
        textId = await stageRetainedText(ctx, key, {
            ...manifest,
            index,
            content: part,
        });
    }
    if (!textId) throw executionError("retained_text_invalid");
    await completeRetainedText(ctx, textId);
    return textId;
}

/** Transfers a staged body to its final owner within the owning publication transaction. */
export async function adoptRetainedTextKey(
    ctx: MutationCtx,
    textId: Id<"retainedTexts">,
    key: string,
) {
    const existing = await ctx.db
        .query("retainedTexts")
        .withIndex("by_key", (q) => q.eq("key", key))
        .unique();
    if (existing) throw executionError("publication_conflict");
    await ctx.db.patch(textId, { key });
}

/** Internal byte storage only; callers enforce their own writer/observation authority on every stage. */
export async function stageRetainedText(
    ctx: MutationCtx,
    key: string,
    input: ReturnType<typeof retainedTextParts>["manifest"] & {
        index: number;
        content: string;
    },
) {
    const { index, content, ...manifest } = input;
    if (
        !Number.isSafeInteger(index) ||
        index < 0 ||
        index >= manifest.fragmentHashes.length ||
        content.length > TEXT_FRAGMENT_CHARACTERS ||
        sha256Hex(content) !== manifest.fragmentHashes[index] ||
        !Number.isSafeInteger(manifest.sizeBytes) ||
        manifest.sizeBytes < 0 ||
        !Number.isSafeInteger(manifest.characters) ||
        manifest.characters < 0 ||
        manifest.fragmentHashes.length <
            Math.max(
                1,
                Math.ceil(manifest.characters / TEXT_FRAGMENT_CHARACTERS),
            ) ||
        manifest.fragmentHashes.length >
            Math.max(
                1,
                Math.ceil(manifest.characters / (TEXT_FRAGMENT_CHARACTERS - 1)),
            )
    )
        throw executionError("retained_text_invalid");
    const existing = await ctx.db
        .query("retainedTexts")
        .withIndex("by_key", (q) => q.eq("key", key))
        .unique();
    if (existing?.stream) throw executionError("retained_text_conflict");
    if (
        existing &&
        (existing.contentHash !== manifest.contentHash ||
            existing.sizeBytes !== manifest.sizeBytes ||
            existing.characters !== manifest.characters ||
            JSON.stringify(existing.fragmentHashes) !==
                JSON.stringify(manifest.fragmentHashes))
    )
        throw executionError("retained_text_conflict");
    const staged = existing ?? {
        key,
        ...manifest,
        received: 0,
        receivedBytes: 0,
        receivedCharacters: 0,
        fragmentEnds: [],
    };
    if (!existing) requireManifestCapacity(staged);
    const textId =
        existing?._id ?? (await ctx.db.insert("retainedTexts", staged));
    const next = existing?.received ?? 0;
    if (index < next) {
        const previous = await ctx.db
            .query("retainedTextFragments")
            .withIndex("by_text_and_index", (q) =>
                q.eq("textId", textId).eq("index", index),
            )
            .unique();
        if (previous?.content !== content)
            throw executionError("retained_text_conflict");
        return textId;
    }
    if (index !== next) throw executionError("retained_text_sequence");
    const receivedBytes =
        (existing?.receivedBytes ?? 0) +
        new TextEncoder().encode(content).length;
    const receivedCharacters =
        (existing?.receivedCharacters ?? 0) + content.length;
    if (
        receivedBytes > manifest.sizeBytes ||
        receivedCharacters > manifest.characters ||
        (index + 1 === manifest.fragmentHashes.length &&
            (receivedBytes !== manifest.sizeBytes ||
                receivedCharacters !== manifest.characters))
    )
        throw executionError("retained_text_invalid");
    const checkpoint = advanceSha256(
        existing?.checkpoint,
        new TextEncoder().encode(content),
    );
    if (
        index + 1 === manifest.fragmentHashes.length &&
        sha256CheckpointHex(checkpoint) !== manifest.contentHash
    )
        throw executionError("retained_text_invalid");
    const patch = {
        received: next + 1,
        receivedBytes,
        receivedCharacters,
        checkpoint,
        fragmentEnds: [...staged.fragmentEnds, receivedCharacters],
    };
    requireManifestCapacity({ ...staged, ...patch });
    await ctx.db.insert("retainedTextFragments", { textId, index, content });
    await ctx.db.patch(textId, patch);
    return textId;
}

/** Publication is atomic in the owning journal/commit transaction and requires every immutable fragment. */
export async function completeRetainedText(
    ctx: QueryCtx,
    textId: Id<"retainedTexts">,
) {
    const text = await ctx.db.get(textId);
    if (
        !text ||
        (text.stream && !text.stream.sealed) ||
        text.received !== text.fragmentHashes.length ||
        text.receivedBytes !== text.sizeBytes ||
        text.receivedCharacters !== text.characters
    )
        throw executionError("retained_text_incomplete");
    return text;
}

export async function retainedTextFragment(
    ctx: QueryCtx,
    text: Doc<"retainedTexts">,
    index: number,
) {
    if (
        !Number.isSafeInteger(index) ||
        index < 0 ||
        index >= text.fragmentHashes.length
    )
        throw executionError("retained_text_range");
    const fragment = await ctx.db
        .query("retainedTextFragments")
        .withIndex("by_text_and_index", (q) =>
            q.eq("textId", text._id).eq("index", index),
        )
        .unique();
    if (!fragment || sha256Hex(fragment.content) !== text.fragmentHashes[index])
        throw executionError("retained_text_invalid");
    return fragment.content;
}

/** Content-bound cursors cannot skip a missing fragment or cross logical records. */
/** Protected diagnostic snapshots may expose a committed open prefix; immutable readers still require sealing. */
export async function retainedDiagnosticText(
    ctx: QueryCtx,
    textId: Id<"retainedTexts">,
    key: string,
) {
    const text = await ctx.db.get(textId);
    if (!text || text.key !== key)
        throw executionError("retained_text_conflict");
    if (!text.stream || text.stream.sealed)
        return completeRetainedText(ctx, textId);
    return {
        ...text,
        contentHash: sha256CheckpointHex(
            advanceSha256(
                text.checkpoint,
                new TextEncoder().encode(text.stream.tail),
            ),
        ),
        sizeBytes: text.receivedBytes,
        characters: text.receivedCharacters,
    };
}

export async function retainedTextPage(
    ctx: QueryCtx,
    text: Doc<"retainedTexts">,
    options: PaginationOptions,
) {
    if (
        !Number.isSafeInteger(options.numItems) ||
        options.numItems < 1 ||
        options.numItems > 4
    )
        throw new Error("Snapshot page too large");
    const open = text.stream && !text.stream.sealed ? text.stream : undefined;
    const count = open
        ? open.fragments + (open.tail || !open.fragments ? 1 : 0)
        : text.fragmentHashes.length;
    const prefix = `${text._id}:${text.contentHash}:`;
    const cursor = options.cursor;
    if (
        cursor !== null &&
        (!cursor.startsWith(prefix) ||
            !/^\d+$/.test(cursor.slice(prefix.length)))
    )
        throw new Error("Snapshot cursor invalid");
    const start = cursor === null ? 0 : Number(cursor.slice(prefix.length));
    if (!Number.isSafeInteger(start) || start < 0 || start > count)
        throw new Error("Snapshot cursor invalid");
    const end = Math.min(count, start + options.numItems);
    const page = [];
    for (let index = start; index < end; index++)
        page.push({
            index,
            content: open
                ? index === open.fragments
                    ? open.tail
                    : await diagnosticFragment(ctx, text._id, index)
                : await retainedTextFragment(ctx, text, index),
        });
    return {
        page,
        isDone: end === count,
        continueCursor: `${prefix}${end}`,
    };
}

/** Readers verify the complete content as well as individual fragments before using a logical record. */
export async function readRetainedText(
    ctx: QueryCtx,
    textId: Id<"retainedTexts">,
) {
    const text = await completeRetainedText(ctx, textId);
    const parts = [];
    for (let index = 0; index < text.fragmentHashes.length; index++)
        parts.push(await retainedTextFragment(ctx, text, index));
    return verifyRetainedText(text, parts.join(""));
}

export function verifyRetainedText(
    text: Pick<
        Doc<"retainedTexts">,
        "contentHash" | "sizeBytes" | "characters"
    >,
    content: string,
) {
    if (
        sha256Hex(content) !== text.contentHash ||
        content.length !== text.characters ||
        new TextEncoder().encode(content).length !== text.sizeBytes
    )
        throw executionError("retained_text_invalid");
    return content;
}

/** Reads only intersecting fragments, keeping journal and administrator pages independent of logical message width. */
export async function retainedTextRange(
    ctx: QueryCtx,
    text: Doc<"retainedTexts">,
    offset: number,
    length: number,
) {
    if (
        !Number.isSafeInteger(offset) ||
        !Number.isSafeInteger(length) ||
        offset < 0 ||
        length < 0 ||
        offset > text.characters
    )
        throw executionError("retained_text_range");
    const end = Math.min(text.characters, offset + length);
    const parts: string[] = [];
    for (let index = 0; index < text.fragmentEnds.length; index++) {
        const start = index === 0 ? 0 : (text.fragmentEnds[index - 1] ?? 0);
        const fragmentEnd = text.fragmentEnds[index] ?? 0;
        if (start >= end) break;
        if (fragmentEnd <= offset) continue;
        const content = await retainedTextFragment(ctx, text, index);
        parts.push(
            content.slice(
                Math.max(0, offset - start),
                Math.min(content.length, end - start),
            ),
        );
    }
    return parts.join("");
}

function operationObservationKey(requestId: Id<"agentOperationRequests">) {
    return `operation:${requestId}:observation`;
}

function operationObservation(
    ctx: QueryCtx,
    requestId: Id<"agentOperationRequests">,
) {
    return ctx.db
        .query("retainedTexts")
        .withIndex("by_key", (q) =>
            q.eq("key", operationObservationKey(requestId)),
        )
        .unique();
}

/** Resolve the immutable retained representation without loading its fragments. */
export async function operationObservationManifest(
    ctx: QueryCtx,
    requestId: Id<"agentOperationRequests">,
) {
    const stored = await operationObservation(ctx, requestId);
    return stored ? completeRetainedText(ctx, stored._id) : null;
}

/** The operation executor supplies writer authority; this owner retains its immutable observation representation. */
export async function stageOperationObservation(
    ctx: MutationCtx,
    requestId: Id<"agentOperationRequests">,
    fragment: Infer<typeof textFragmentValidator>,
) {
    await stageRetainedText(ctx, operationObservationKey(requestId), fragment);
}

/** Reads only the requested observation range and verifies its retained identity without exposing storage layout. */
export async function operationObservationRange(
    ctx: QueryCtx,
    requestId: Id<"agentOperationRequests">,
    start: number,
    length: number,
    expectedHash?: string,
) {
    const text = await operationObservationManifest(ctx, requestId);
    if (!text) return null;
    if (expectedHash !== undefined && expectedHash !== text.contentHash)
        throw executionError("retained_text_invalid");
    return {
        contentHash: text.contentHash,
        characters: text.characters,
        content: await retainedTextRange(ctx, text, start, length),
    };
}

/** Exposes a single verified observation fragment, preserving its original UTF-16 boundaries. */
export async function operationObservationFragment(
    ctx: QueryCtx,
    requestId: Id<"agentOperationRequests">,
    index: number,
    expectedHash: string,
) {
    const manifest = await operationObservationManifest(ctx, requestId);
    if (
        !manifest ||
        manifest.contentHash !== expectedHash ||
        !Number.isSafeInteger(index) ||
        index < 0 ||
        index >= manifest.fragmentHashes.length
    )
        throw executionError("retained_text_invalid");
    return retainedTextFragment(ctx, manifest, index);
}

async function diagnosticFragment(
    ctx: QueryCtx,
    textId: Id<"retainedTexts">,
    index: number,
) {
    const fragment = await ctx.db
        .query("retainedTextFragments")
        .withIndex("by_text_and_index", (q) =>
            q.eq("textId", textId).eq("index", index),
        )
        .unique();
    if (!fragment) throw executionError("retained_text_incomplete");
    return fragment.content;
}

// A UTF-16 unit needs at most three UTF-8 bytes, including when paired.
// Include the row and index keys in the worst-case cost at the storage boundary.
const retainedFragmentLimitBytes = getDocumentSize({
    _id: "x".repeat(32),
    _creationTime: 0,
    textId: "x".repeat(32),
    index: 0,
    content: "界".repeat(TEXT_FRAGMENT_CHARACTERS),
});

/** Deletes exclusively owned text children first, keeping each purge transaction bounded. */
export async function deleteRetainedTextBatch(
    ctx: MutationCtx,
    textId: Id<"retainedTexts">,
    key: string,
    batchSize: number,
) {
    const text = await ctx.db.get(textId);
    if (!text) return true;
    if (text.key !== key) throw executionError("retained_text_conflict");
    if (text.stream && !text.stream.sealed) await retainedStreamWritePhase(ctx);
    const capacity = await ctx.meta.getTransactionMetrics();
    // Deleting a row also reads it. Reserve room for both that read and the parent.
    const batch = Math.min(
        batchSize,
        Math.floor(
            (capacity.bytesRead.remaining - retainedFragmentLimitBytes) /
                (2 * retainedFragmentLimitBytes),
        ),
        Math.floor(
            (capacity.bytesWritten.remaining - retainedFragmentLimitBytes) /
                retainedFragmentLimitBytes,
        ),
        Math.floor((capacity.documentsRead.remaining - 1) / 2),
        capacity.documentsWritten.remaining - 1,
    );
    if (batch < 1) return false;
    const fragments = await ctx.db
        .query("retainedTextFragments")
        .withIndex("by_text_and_index", (q) => q.eq("textId", textId))
        .take(batch);
    for (const fragment of fragments) await ctx.db.delete(fragment._id);
    if (fragments.length) return false;
    await ctx.db.delete(textId);
    return true;
}

/** Report whether the request had text and whether its final fragment batch was drained. */
export async function deleteOperationObservationBatch(
    ctx: MutationCtx,
    requestId: Id<"agentOperationRequests">,
    batchSize: number,
) {
    const text = await operationObservation(ctx, requestId);
    return text
        ? deleteRetainedTextBatch(
              ctx,
              text._id,
              operationObservationKey(requestId),
              batchSize,
          )
        : undefined;
}
