import type { Doc, Id } from "@convex/_generated/dataModel";
import type { MutationCtx, QueryCtx } from "@convex/_generated/server";
import {
    advanceSha256,
    sha256CheckpointHex,
    sha256Hex,
} from "@convex/domain/sourcePassages";
import { TEXT_FRAGMENT_CHARACTERS } from "@convex/resourcePolicy";
import type { PaginationOptions } from "convex/server";
import { type Infer, v } from "convex/values";
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

/** Splits UTF-16 without cutting a surrogate pair; hashes describe the exact UTF-8 bytes. */
export function retainedTextParts(content: string) {
    const parts: string[] = [];
    for (let offset = 0; offset < content.length; ) {
        let end = Math.min(offset + TEXT_FRAGMENT_CHARACTERS, content.length);
        const last = content.charCodeAt(end - 1);
        if (end < content.length && last >= 0xd800 && last <= 0xdbff) end--;
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
    if (
        existing &&
        (existing.contentHash !== manifest.contentHash ||
            existing.sizeBytes !== manifest.sizeBytes ||
            existing.characters !== manifest.characters ||
            JSON.stringify(existing.fragmentHashes) !==
                JSON.stringify(manifest.fragmentHashes))
    )
        throw executionError("retained_text_conflict");
    const textId =
        existing?._id ??
        (await ctx.db.insert("retainedTexts", {
            key,
            ...manifest,
            received: 0,
            receivedBytes: 0,
            receivedCharacters: 0,
            fragmentEnds: [],
        }));
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
    await ctx.db.insert("retainedTextFragments", { textId, index, content });
    await ctx.db.patch(textId, {
        received: next + 1,
        receivedBytes,
        receivedCharacters,
        checkpoint,
        fragmentEnds: [...(existing?.fragmentEnds ?? []), receivedCharacters],
    });
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
    const prefix = `${text._id}:${text.contentHash}:`;
    const cursor = options.cursor;
    if (
        cursor !== null &&
        (!cursor.startsWith(prefix) ||
            !/^\d+$/.test(cursor.slice(prefix.length)))
    )
        throw new Error("Snapshot cursor invalid");
    const start = cursor === null ? 0 : Number(cursor.slice(prefix.length));
    if (
        !Number.isSafeInteger(start) ||
        start < 0 ||
        start > text.fragmentHashes.length
    )
        throw new Error("Snapshot cursor invalid");
    const end = Math.min(text.fragmentHashes.length, start + options.numItems);
    const page = [];
    for (let index = start; index < end; index++)
        page.push({
            index,
            content: await retainedTextFragment(ctx, text, index),
        });
    return {
        page,
        isDone: end === text.fragmentHashes.length,
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
    const stored = await ctx.db
        .query("retainedTexts")
        .withIndex("by_key", (q) =>
            q.eq("key", operationObservationKey(requestId)),
        )
        .unique();
    if (!stored) return null;
    const text = await completeRetainedText(ctx, stored._id);
    if (expectedHash !== undefined && expectedHash !== text.contentHash)
        throw executionError("retained_text_invalid");
    return {
        contentHash: text.contentHash,
        characters: text.characters,
        content: await retainedTextRange(ctx, text, start, length),
    };
}
