import type { Id } from "@convex/_generated/dataModel";
import type { MutationCtx } from "@convex/_generated/server";
import { sha256Hex, stableStringify } from "@convex/domain/hashing";
import { MAX_OBSERVABLE_OUTPUT_BYTES } from "@convex/resourcePolicy";
import type { Infer } from "convex/values";
import { executionError } from "./errors";
import type { retainedPayloadValidator } from "./operationContracts";

type RetainedPayload = Infer<typeof retainedPayloadValidator>;

export function retainablePayload(
    contentJson: string | undefined,
    capacityCode: string,
    missingCode: string,
): RetainedPayload {
    const json =
        contentJson === undefined
            ? undefined
            : stableStringify(JSON.parse(contentJson));
    const sizeBytes = new TextEncoder().encode(json ?? "").length;
    const contentHash = json === undefined ? undefined : sha256Hex(json);
    const complete =
        json !== undefined && sizeBytes <= MAX_OBSERVABLE_OUTPUT_BYTES;
    return {
        version: 1,
        state: complete ? "complete" : "incomplete",
        ...(complete ? { json } : {}),
        ...(contentHash ? { contentHash } : {}),
        sizeBytes,
        ...(!complete
            ? { code: json === undefined ? missingCode : capacityCode }
            : {}),
    };
}

/** Append-only event content is written in the same transaction as its observed effect/result. */
export async function retainExecutionEventPayload(
    ctx: MutationCtx,
    eventId: Id<"agentExecutionEvents">,
    value: unknown,
): Promise<void> {
    const event = await ctx.db.get(eventId);
    if (!event) throw executionError("journal_event_unavailable");
    const payload = retainablePayload(
        JSON.stringify(value),
        "journal_operation_capacity",
        "operation_observation_unavailable",
    );
    if (event.payload) {
        if (stableStringify(event.payload) !== stableStringify(payload))
            throw executionError("journal_payload_conflict");
        return;
    }
    await ctx.db.patch(eventId, { payload });
}
