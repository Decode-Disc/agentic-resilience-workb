import type { Doc, Id } from "@convex/_generated/dataModel";
import type { MutationCtx, QueryCtx } from "@convex/_generated/server";
import {
    advanceSha256,
    completeCharacterBoundary,
    sha256CheckpointHex,
    sha256Hex,
} from "@convex/domain/hashing";
import {
    CONVEX_MAX_ARRAY_VALUES,
    CONVEX_MAX_DOCUMENT_BYTES,
    TEXT_FRAGMENT_CHARACTERS,
} from "@convex/resourcePolicy";
import type { PaginationOptions } from "convex/server";
import { getDocumentSize, type Infer, v } from "convex/values";
import { executionError } from "./errors";
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

function requirePackedStreamManifest(text: Doc<"retainedTexts">) {
    const stream = text.stream;
    if (
        !stream ||
        text.fragmentHashes.length !== stream.fragments ||
        text.fragmentEnds.length !== stream.fragments ||
        (text.fragmentEnds.at(-1) ?? 0) !==
            text.receivedCharacters - stream.tail.length
    )
        throw executionError("retained_text_incomplete");
}

/** Ordered append identity is independent of immutable packed-fragment layout. */
export async function appendRetainedText(
    ctx: MutationCtx,
    key: string,
    sequence: number,
    content: string,
) {
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
    requirePackedStreamManifest(text);
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
        fragmentHashes.push(sha256Hex(fragment));
        endOffset += fragment.length;
        fragmentEnds.push(endOffset);
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
export async function finalizeRetainedTextStream(
    ctx: MutationCtx,
    textId: Id<"retainedTexts">,
) {
    const text = await ctx.db.get(textId);
    if (!text?.stream) throw executionError("retained_text_invalid");
    if (text.stream.sealed) return text;
    const { fragments, tail } = text.stream;
    requirePackedStreamManifest(text);
    const tailBytes = new TextEncoder().encode(tail);
    if (
        (text.checkpoint?.sizeBytes ?? 0) + tailBytes.length !==
        text.receivedBytes
    )
        throw executionError("retained_text_invalid");
    const fragmentHashes = [...text.fragmentHashes];
    const fragmentEnds = [...text.fragmentEnds];
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
