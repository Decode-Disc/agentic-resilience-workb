import type { Doc, Id } from "@convex/_generated/dataModel";
import type { QueryCtx } from "@convex/_generated/server";
import { sha256Hex } from "@convex/domain/hashing";
import { executionError } from "./errors";
import { completeRetainedText } from "./retainedText";

export function admittedInputHash(invocation: Doc<"agentInvocations">) {
    return invocation.inputContentHash ?? sha256Hex(invocation.inputJson);
}

/** Resolves an invocation-owned retained response, independently of how callers read it. */
export async function invocationResponseManifest(
    ctx: QueryCtx,
    invocation: Doc<"agentInvocations">,
    textId: Id<"retainedTexts">,
    kind: "response" | "raw",
) {
    const text = await completeRetainedText(ctx, textId);
    const expectedKey =
        kind === "raw"
            ? `${invocation._id}:raw_output`
            : `${invocation._id}:response:${text.contentHash}`;
    if (text.key !== expectedKey)
        throw executionError("invocation_result_invalid");
    return text;
}

/** Resolves the observed digest and checks any coexisting inline copy. */
export async function receivedResponseDigest(
    ctx: QueryCtx,
    invocation: Doc<"agentInvocations">,
) {
    const inline =
        invocation.receivedOutputJson === undefined
            ? undefined
            : sha256Hex(invocation.receivedOutputJson);
    if (!invocation.receivedOutputTextId) return inline;
    const text = await invocationResponseManifest(
        ctx,
        invocation,
        invocation.receivedOutputTextId,
        "response",
    );
    if (inline !== undefined && inline !== text.contentHash)
        throw executionError("invocation_result_conflict");
    return text.contentHash;
}

/** Validates a replay or adoption against the stored identity without reading fragments. */
export async function matchInvocationResponse(
    ctx: QueryCtx,
    invocation: Doc<"agentInvocations">,
    part: "received" | "adopted",
    expected: string | { responseHash: string },
) {
    const [textId, inline] =
        part === "received"
            ? [invocation.receivedOutputTextId, invocation.receivedOutputJson]
            : [invocation.outputTextId, invocation.outputJson];
    if (
        inline !== undefined &&
        (typeof expected === "string"
            ? inline !== expected
            : sha256Hex(inline) !== expected.responseHash)
    )
        throw executionError("invocation_result_conflict");
    if (textId) {
        const text = await invocationResponseManifest(
            ctx,
            invocation,
            textId,
            "response",
        );
        const bytes =
            typeof expected === "string"
                ? new TextEncoder().encode(expected)
                : undefined;
        const hash =
            typeof expected === "string"
                ? sha256Hex(bytes ?? expected)
                : expected.responseHash;
        if (
            text.contentHash !== hash ||
            (typeof expected === "string" &&
                (text.characters !== expected.length ||
                    text.sizeBytes !== bytes?.length))
        )
            throw executionError("invocation_result_conflict");
    }
    return textId || inline !== undefined
        ? { textId, json: textId ? undefined : inline }
        : null;
}

/** Verifies the persisted operation correlation against the original response identity. */
export async function retainedNativeCalls(
    ctx: QueryCtx,
    invocation: Doc<"agentInvocations">,
) {
    const retained = invocation.nativeOperations;
    if (!retained) return undefined;
    const expected = { responseHash: retained.responseHash };
    if (
        invocation.status !== "returned" ||
        retained.calls.length !== invocation.requestIds?.length ||
        !(await matchInvocationResponse(ctx, invocation, "adopted", expected))
    )
        throw executionError("operation_correlation_invalid");
    await matchInvocationResponse(ctx, invocation, "received", expected);
    return retained.calls;
}

export function hasReceivedResponse(invocation: Doc<"agentInvocations">) {
    return (
        invocation.receivedOutputJson !== undefined ||
        invocation.receivedOutputTextId !== undefined
    );
}

/** Without provider admission, a retained live response is a known local refusal. */
export function hasKnownNonDispatch(invocation: Doc<"agentInvocations">) {
    return (
        invocation.journalVersion === 1 &&
        invocation.provenance === "live" &&
        !invocation.providerCallId &&
        hasReceivedResponse(invocation)
    );
}

/** Current observation frontier is independent of invocation/lease bookkeeping. */
export async function contextObservationSequence(
    ctx: QueryCtx,
    runId: Id<"researchRuns">,
) {
    const last = await ctx.db
        .query("agentExecutionEvents")
        .withIndex("by_run_and_native_input_sequence", (q) =>
            q.eq("runId", runId).gt("nativeInputSequence", 0),
        )
        .order("desc")
        .first();
    return last?.nativeInputSequence ?? 0;
}

/** Run observations have their own dossier ordering and are never mistaken for mission events. */
export function isContextObservation(event: Doc<"agentExecutionEvents">) {
    return (
        event.kind === "context_observed" &&
        event.contextObservation?.version === 1 &&
        Number.isSafeInteger(event.nativeInputSequence) &&
        event.nativeInputSequence === event.sequence
    );
}

/** The latest command frontier is separate from business-state changes and queued user messages. */
export async function latestNativeControl(
    ctx: QueryCtx,
    runId: Id<"researchRuns">,
) {
    return ctx.db
        .query("agentMessageDeliveries")
        .withIndex("by_run_and_delivery_and_native_input_sequence", (q) =>
            q
                .eq("runId", runId)
                .eq("delivery", "control")
                .gt("nativeInputSequence", 0),
        )
        .order("desc")
        .first();
}
