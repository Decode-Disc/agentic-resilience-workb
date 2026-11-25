import type { Doc, Id } from "@convex/_generated/dataModel";
import { readMissionHistoryEventFragment } from "@convex/execution/journal";
import {
    completeRetainedText,
    retainedTextFragment,
    verifyRetainedText,
} from "@convex/execution/retainedText";
import type schema from "@convex/schema";
import type { TestConvex } from "convex-test";

/** Reconstructs immutable fixture bytes through the real owner, with a separate transaction per fragment. */
export async function readRetainedBody(
    t: TestConvex<typeof schema>,
    id: Id<"retainedTexts">,
) {
    const manifest = await t.run((ctx) => completeRetainedText(ctx, id));
    const parts: string[] = [];
    for (let index = 0; index < manifest.fragmentHashes.length; index++)
        parts.push(
            await t.run((ctx) => retainedTextFragment(ctx, manifest, index)),
        );
    return verifyRetainedText(manifest, parts.join(""));
}

/** Uses the production history page contract when assertions need an entire event. */
export async function readHistoryEvent(
    t: TestConvex<typeof schema>,
    event: Doc<"agentExecutionEvents">,
) {
    let offset = 0,
        json = "",
        contentHash: string | undefined;
    for (;;) {
        const page = await t.run((ctx) =>
            readMissionHistoryEventFragment(ctx, event, offset),
        );
        if (contentHash !== undefined && page.contentHash !== contentHash)
            throw Error("History identity changed");
        if (page.offset !== offset || page.end <= offset)
            throw Error("History did not advance contiguously");
        json += page.content;
        contentHash = page.contentHash;
        if (page.end === page.totalCharacters) return { json, contentHash };
        offset = page.end;
    }
}
