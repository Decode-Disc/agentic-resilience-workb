import type { Doc } from "@convex/_generated/dataModel";
import type { MutationCtx } from "@convex/_generated/server";
import { sha256Hex, stableStringify } from "@convex/domain/sourcePassages";
import { recordInvocationEvent } from "./authority";
import { executionError } from "./errors";
import { MAX_OBSERVABLE_OUTPUT_BYTES } from "./executionProtocol";

/** Without provider admission, a retained live response is a known local refusal. */
export function hasKnownNonDispatch(invocation: Doc<"agentInvocations">) {
    return (
        invocation.journalVersion === 1 &&
        invocation.provenance === "live" &&
        !invocation.providerCallId &&
        invocation.receivedOutputJson !== undefined
    );
}

/** Stores immutable, bounded observations separately from model continuation state. */
export async function retainInvocationPayload(
    ctx: MutationCtx,
    invocation: Doc<"agentInvocations">,
    part: "request" | "reply",
    contentJson?: string,
    missingCode = "observable_reply_unavailable",
) {
    const json =
        contentJson === undefined
            ? undefined
            : stableStringify(JSON.parse(contentJson));
    const sizeBytes = new TextEncoder().encode(json ?? "").length;
    const contentHash = json === undefined ? undefined : sha256Hex(json);
    const complete =
        json !== undefined && sizeBytes <= MAX_OBSERVABLE_OUTPUT_BYTES;
    const code = complete
        ? undefined
        : json === undefined
          ? missingCode
          : `journal_${part}_capacity`;
    const existing = await ctx.db
        .query("agentInvocationPayloads")
        .withIndex("by_invocation_and_part", (q) =>
            q.eq("invocationId", invocation._id).eq("part", part),
        )
        .unique();
    if (existing) {
        if (existing.contentHash !== contentHash || existing.code !== code)
            throw executionError("journal_payload_conflict");
        return {
            state: existing.state,
            ...(existing.code ? { code: existing.code } : {}),
        };
    }
    await ctx.db.insert("agentInvocationPayloads", {
        invocationId: invocation._id,
        runId: invocation.runId,
        version: 1,
        part,
        state: complete ? "complete" : "incomplete",
        ...(complete ? { json } : {}),
        ...(contentHash ? { contentHash } : {}),
        sizeBytes,
        ...(code ? { code } : {}),
        createdAt: Date.now(),
    });
    await recordInvocationEvent(ctx, invocation, {
        kind: `invocation_${part}_recorded`,
        ...(code ? { code } : {}),
    });
    return {
        state: complete ? ("complete" as const) : ("incomplete" as const),
        ...(code ? { code } : {}),
    };
}
