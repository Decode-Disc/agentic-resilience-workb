import { internal } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import type { ActionCtx } from "@convex/_generated/server";
import { RETAINED_TEXT_INLINE_BYTES } from "@convex/resourcePolicy";
import type { ApiFromModules, FunctionArgs } from "convex/server";
import type { stageObservedReply } from "./invocationLifecycle";
import { retainedTextParts } from "./retainedText";

type StageArgs = FunctionArgs<
    ApiFromModules<{
        lifecycle: { stageObservedReply: typeof stageObservedReply };
    }>["lifecycle"]["stageObservedReply"]
>;

/** Stages observation bytes one fragment per transaction before receipt settlement. */
export async function stageObservedBody(
    ctx: ActionCtx,
    authority: Pick<StageArgs, "invocationId" | "expectedGeneration">,
    part: StageArgs["part"],
    json: string | undefined,
    inlineBytes = RETAINED_TEXT_INLINE_BYTES,
) {
    if (
        json === undefined ||
        new TextEncoder().encode(json).length <= inlineBytes
    )
        return undefined;
    const { manifest, parts } = retainedTextParts(json);
    let textId: Id<"retainedTexts"> | undefined;
    for (const [index, content] of parts.entries())
        textId = await ctx.runMutation(
            internal.execution.invocationLifecycle.stageObservedReply,
            { ...authority, part, fragment: { ...manifest, index, content } },
        );
    return textId;
}
