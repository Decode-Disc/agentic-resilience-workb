import { internal } from "@convex/_generated/api";
import type { Doc, Id } from "@convex/_generated/dataModel";
import type { ActionCtx } from "@convex/_generated/server";
import { sha256Hex } from "@convex/domain/sourcePassages";
import {
    type AgentDefinition,
    SUBMIT_COMPLETION_TOOL,
} from "@convex/execution/agentDefinition";
import { executionError } from "@convex/execution/errors";
import { invocationResponseValidator } from "@convex/execution/executionProtocol";
import { preparedReplyBasisHash } from "@convex/execution/journal";
import { renderLegacyTextualResult } from "@convex/execution/missionData";
import {
    retainedTextParts,
    verifyRetainedText,
} from "@convex/execution/retainedText";
import { MAX_WORKING_NOTES_BYTES } from "@convex/resourcePolicy";
import type { FunctionArgs, FunctionReturnType } from "convex/server";
import { validate } from "convex-helpers/validators";

const bodyFields = {
    received: ["receivedOutputTextId", "receivedOutputJson"],
    adopted: ["outputTextId", "outputJson"],
    raw: ["rawOutputTextId", "rawOutputJson"],
} as const;

/** Reconstruct only the invocation body needed by the worker, verifying its retained identity. */
export async function recoverPiInvocationBody(
    ctx: ActionCtx,
    invocation: Doc<"agentInvocations">,
    part: keyof typeof bodyFields,
    authority: { expectedGeneration: number; sessionId?: Id<"piSessions"> },
    signal?: AbortSignal,
) {
    const [referenceField, inlineField] = bodyFields[part];
    const textId = invocation[referenceField];
    const inline = invocation[inlineField];
    if (!textId) return inline;
    const args = {
        expectedGeneration: authority.expectedGeneration,
        sessionId: authority.sessionId,
        invocationId: invocation._id,
        part,
        textId,
    };
    const content = await reconstructBody(
        (index) =>
            ctx.runQuery(internal.execution.piControl.invocationFragment, {
                ...args,
                index,
            }),
        signal,
    );
    if (part !== "raw" && inline !== undefined && inline !== content)
        throw executionError("invocation_result_conflict");
    return content;
}

/** Looks up one native operation, loading old adopted responses only when needed. */
export async function lookupPiOperation(
    ctx: ActionCtx,
    args: Omit<
        FunctionArgs<typeof internal.execution.piControl.operation>,
        "historical"
    >,
    signal?: AbortSignal,
) {
    const read = internal.execution.piControl.operation;
    const current = await ctx.runQuery(read, args);
    if (!current || !("invocation" in current)) return current;
    const adopted = await recoverPiInvocationBody(
        ctx,
        current.invocation,
        "adopted",
        args,
        signal,
    );
    if (adopted === undefined)
        throw executionError("operation_correlation_invalid");
    const response: unknown = JSON.parse(adopted);
    if (!validate(invocationResponseValidator, response))
        throw executionError("retained_response_invalid");
    const index =
        response.kind === "operations"
            ? response.requests.findIndex(
                  (request) => request.callId === args.callId,
              )
            : -1;
    const request = await ctx.runQuery(read, {
        ...args,
        historical: {
            invocationId: current.invocation._id,
            responseHash: sha256Hex(adopted),
            index,
        },
    });
    if (request && "invocation" in request)
        throw executionError("operation_correlation_invalid");
    return request;
}

/** Upgrades the historical sole completion only after both retained bodies agree. */
export async function recoverHistoricalCompletion(
    ctx: ActionCtx,
    lease: FunctionArgs<
        typeof internal.execution.piControl.terminalCompletionAccepted
    >,
    invocation: Doc<"agentInvocations">,
    signal?: AbortSignal,
) {
    const authority = {
        expectedGeneration: lease.generation,
        sessionId: lease.sessionId,
    };
    const adopted = await recoverPiInvocationBody(
        ctx,
        invocation,
        "adopted",
        authority,
        signal,
    );
    if (!adopted) throw executionError("completion_correlation_invalid");
    const sameBody =
        invocation.outputTextId &&
        invocation.outputTextId === invocation.receivedOutputTextId &&
        invocation.receivedOutputJson === undefined;
    const received = sameBody
        ? adopted
        : await recoverPiInvocationBody(
              ctx,
              invocation,
              "received",
              authority,
              signal,
          );
    if (received !== undefined && received !== adopted)
        throw executionError("completion_correlation_invalid");
    const response: unknown = JSON.parse(adopted);
    if (!validate(invocationResponseValidator, response))
        throw executionError("retained_response_invalid");
    const correlation =
        response.kind === "completion_submission" && response.call
            ? { kind: "completion" as const, callId: response.call.callId }
            : response.kind === "operations" && invocation.requestIds?.length
              ? {
                    kind: "operations" as const,
                    calls: response.requests.map(({ callId, name }) => ({
                        callId,
                        ...(name === SUBMIT_COMPLETION_TOOL
                            ? { completion: true as const }
                            : {}),
                    })),
                }
              : undefined;
    if (!correlation) return;
    await ctx.runMutation(
        internal.execution.piControl.retainHistoricalCompletion,
        {
            ...lease,
            invocationId: invocation._id,
            correlation,
            responseHash: sha256Hex(adopted),
        },
    );
}

/** Read the exact delivered body for native transcript reconciliation. */
export async function recoverPiPublication(
    ctx: ActionCtx,
    args: Omit<
        FunctionArgs<typeof internal.execution.piControl.publicationFragment>,
        "index"
    >,
    signal?: AbortSignal,
) {
    return reconstructBody(
        (index) =>
            ctx.runQuery(internal.execution.piControl.publicationFragment, {
                ...args,
                index,
            }),
        signal,
    );
}

export async function recoverPiHistoricalPublication(
    ctx: ActionCtx,
    args: Omit<
        FunctionArgs<
            typeof internal.execution.piControl.historicalPublicationFragment
        >,
        "index"
    >,
    signal?: AbortSignal,
) {
    const read = internal.execution.piControl.historicalPublicationFragment;
    signal?.throwIfAborted();
    const first = await ctx.runQuery(read, { ...args, index: 0 });
    const persisted = await reconstructBody(
        (index) =>
            index === 0
                ? Promise.resolve(first)
                : ctx.runQuery(read, { ...args, index }),
        signal,
    );
    return renderLegacyTextualResult(
        persisted,
        first.definitionId,
        args.definitionVersion,
    );
}

async function reconstructBody(
    read: (
        index: number,
    ) => Promise<
        FunctionReturnType<
            typeof internal.execution.piControl.invocationFragment
        >
    >,
    signal?: AbortSignal,
) {
    signal?.throwIfAborted();
    const first = await read(0);
    const parts = [first.content];
    for (let index = 1; index < first.fragmentCount; index++) {
        signal?.throwIfAborted();
        parts.push((await read(index)).content);
    }
    return verifyRetainedText(first, parts.join(""));
}

/** Stages the rendered reply one fragment at a time before business adoption. */
export async function preparePiReply(
    ctx: ActionCtx,
    authority: {
        invocationId: Id<"agentInvocations">;
        expectedGeneration: number;
    },
    response: NonNullable<
        FunctionArgs<typeof internal.execution.invocations.finish>["response"]
    >,
    responseJson: string,
    definition: AgentDefinition,
    signal?: AbortSignal,
) {
    if (!definition.conversationReply || !definition.preparedCompletion)
        return undefined;
    let proposal: unknown;
    if (response.kind === "complete") proposal = response;
    else if (response.kind === "completion_submission" && response.call) {
        try {
            proposal = JSON.parse(response.call.inputJson);
        } catch {
            return undefined;
        }
    } else return undefined;
    if (
        !validate(definition.completionValidator, proposal) ||
        !("text" in proposal) ||
        !proposal.text.trim()
    )
        return undefined;
    const basis = await ctx.runQuery(
        internal.execution.invocationLifecycle.replyPreparation,
        {
            ...authority,
            responseHash: sha256Hex(responseJson),
        },
    );
    if (!basis) return undefined;
    const { result, reviewDraft } = definition.preparedCompletion.render(
        proposal,
        basis,
    );
    if (!validate(definition.resultValidator, result)) return undefined;
    const reply = definition.conversationReply(result);
    if (!reply.trim()) return undefined;
    const callId =
        response.kind === "completion_submission"
            ? response.call?.callId
            : undefined;
    if (callId !== undefined && (callId.length < 1 || callId.length > 160))
        return undefined;
    const workingNotes = proposal.workingNotes;
    const oversizedNotes =
        workingNotes !== undefined &&
        new TextEncoder().encode(workingNotes).length > MAX_WORKING_NOTES_BYTES;
    const completion = {
        responseHash: sha256Hex(responseJson),
        ...(callId !== undefined ? { callId } : {}),
        ...(oversizedNotes
            ? { workingNotesOversized: true as const }
            : workingNotes !== undefined
              ? { workingNotes }
              : {}),
    };
    const stageBasisHash = preparedReplyBasisHash(
        basis.basisHash,
        reviewDraft,
        completion,
    );
    const { parts, manifest } = retainedTextParts(reply);
    let textId: Id<"retainedTexts"> | undefined;
    for (const [index, content] of parts.entries()) {
        signal?.throwIfAborted();
        textId = await ctx.runMutation(
            internal.execution.invocationLifecycle.stagePreparedReply,
            {
                ...authority,
                basisHash: stageBasisHash,
                fragment: { ...manifest, index, content },
            },
        );
    }
    return textId
        ? {
              basisHash: basis.basisHash,
              textId,
              completion,
              ...(reviewDraft ? { reviewDraft } : {}),
          }
        : undefined;
}
