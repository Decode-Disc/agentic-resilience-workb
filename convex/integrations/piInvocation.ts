import { internal } from "@convex/_generated/api";
import type { Doc, Id } from "@convex/_generated/dataModel";
import type { ActionCtx } from "@convex/_generated/server";
import {
    materializeWordingRevision,
    projectAnalystWording,
} from "@convex/domain/preparedAnalystWording";
import { sha256Hex, stableStringify } from "@convex/domain/sourcePassages";
import {
    type AgentCompletion,
    type AgentDefinition,
    agentToolSchemas,
    hasCompletionText,
    SUBMIT_COMPLETION_TOOL,
} from "@convex/execution/agentDefinition";
import { executionError } from "@convex/execution/errors";
import {
    invocationResponseValidator,
    type preparedCompletionValidator,
    type preparedSubmissionValidator,
} from "@convex/execution/executionProtocol";
import type * as InvocationLifecycle from "@convex/execution/invocationLifecycle";
import { preparedReplyBasisHash } from "@convex/execution/journal";
import { operationInputFeedback } from "@convex/execution/operationContracts";
import type * as PiControl from "@convex/execution/piControl";
import {
    retainedTextParts,
    verifyRetainedText,
} from "@convex/execution/retainedText";
import {
    CONVEX_MAX_DOCUMENT_BYTES,
    HISTORY_PAGE_SIZE,
    MAX_WORKING_NOTES_BYTES,
} from "@convex/resourcePolicy";
import type {
    ApiFromModules,
    FunctionArgs,
    FunctionReturnType,
} from "convex/server";
import { getDocumentSize, type Infer, type Value } from "convex/values";
import { ValidationError, validate } from "convex-helpers/validators";

type ControlApi = ApiFromModules<{ control: typeof PiControl }>["control"];
type LifecycleApi = ApiFromModules<{
    lifecycle: typeof InvocationLifecycle;
}>["lifecycle"];

function completionMetadata(
    proposal: AgentCompletion,
    responseHash: string,
    callId?: string,
): Infer<typeof preparedCompletionValidator> {
    const workingNotes = proposal.workingNotes;
    const oversized =
        workingNotes !== undefined &&
        new TextEncoder().encode(workingNotes).length > MAX_WORKING_NOTES_BYTES;
    return {
        responseHash,
        ...(callId !== undefined ? { callId } : {}),
        ...(oversized
            ? { workingNotesOversized: true as const }
            : workingNotes !== undefined
              ? { workingNotes }
              : {}),
    };
}

/** Canonical arguments and bounded refusals cross adoption; the immutable response owns originals. */
export function preparePiSubmission(
    response: Infer<typeof invocationResponseValidator>,
    responseJson: string,
    definition: AgentDefinition,
    snapshot?: unknown,
): Infer<typeof preparedSubmissionValidator> | undefined {
    const responseHash = sha256Hex(responseJson);
    if (response.kind === "complete")
        return definition.preparedCompletion && !hasCompletionText(response)
            ? {
                  responseHash,
                  response: {
                      kind: "completion_refusal",
                      code: "invalid_completion",
                      completion: completionMetadata(response, responseHash),
                  },
              }
            : undefined;
    if (response.kind === "blocked") return { responseHash, response };
    if (response.kind === "completion_submission") {
        if (!response.call) return { responseHash, response };
        const callId = response.call.callId;
        let proposal: unknown;
        try {
            proposal = JSON.parse(response.call.inputJson);
        } catch {
            return {
                responseHash,
                response: {
                    kind: response.kind,
                    call: {
                        callId,
                        feedback: {
                            code: "invalid_completion",
                            issues: [
                                {
                                    path: "",
                                    expected:
                                        "A single valid JSON object matching the submit_completion schema.",
                                },
                            ],
                        },
                    },
                },
            };
        }
        try {
            validate(definition.completionValidator, proposal, { throw: true });
        } catch (error) {
            if (!(error instanceof ValidationError)) throw error;
            return {
                responseHash,
                response: {
                    kind: response.kind,
                    call: {
                        callId,
                        feedback: {
                            code: "invalid_completion",
                            issues: [
                                operationInputFeedback(
                                    definition.completionValidator,
                                    error,
                                    proposal,
                                ),
                            ],
                        },
                    },
                },
            };
        }
        const notes = (proposal as AgentCompletion).workingNotes;
        if (
            notes !== undefined &&
            new TextEncoder().encode(notes).length > MAX_WORKING_NOTES_BYTES
        )
            return {
                responseHash,
                response: {
                    kind: response.kind,
                    call: { callId, blockCode: "working_memory_capacity" },
                },
            };
        if (
            definition.preparedCompletion &&
            !hasCompletionText(proposal as AgentCompletion)
        )
            return {
                responseHash,
                response: {
                    kind: "completion_refusal",
                    code: "invalid_completion",
                    completion: completionMetadata(
                        proposal as AgentCompletion,
                        responseHash,
                        callId,
                    ),
                },
            };
        return {
            responseHash,
            response: {
                kind: response.kind,
                call: { callId, inputJson: stableStringify(proposal) },
            },
        };
    }
    if (
        response.workingNotes !== undefined &&
        new TextEncoder().encode(response.workingNotes).length >
            MAX_WORKING_NOTES_BYTES
    )
        return {
            responseHash,
            response: { kind: "blocked", code: "working_memory_capacity" },
        };
    const tools = agentToolSchemas(definition, snapshot);
    return {
        responseHash,
        response: {
            kind: "operations",
            ...(response.workingNotes !== undefined
                ? { workingNotes: response.workingNotes }
                : {}),
            requests: response.requests.map(({ callId, name, inputJson }) => {
                const operation = tools[name];
                let decoded: unknown;
                try {
                    decoded = JSON.parse(inputJson);
                } catch {
                    decoded = null;
                }
                if (!operation || name === SUBMIT_COMPLETION_TOOL)
                    return { callId, name };
                try {
                    validate(operation.inputValidator, decoded, {
                        throw: true,
                    });
                } catch (error) {
                    if (!(error instanceof ValidationError)) throw error;
                    return {
                        callId,
                        name,
                        validation: operationInputFeedback(
                            operation.inputValidator,
                            error,
                            decoded,
                        ),
                    };
                }
                if (
                    getDocumentSize({ input: decoded as Value }) >=
                    CONVEX_MAX_DOCUMENT_BYTES
                )
                    return {
                        callId,
                        name,
                        refusalCode: "operation_input_capacity" as const,
                        validation: {
                            path: "",
                            expected: `Operation input must fit its ${CONVEX_MAX_DOCUMENT_BYTES}-byte database document.`,
                        },
                    };
                return { callId, name, inputJson: stableStringify(decoded) };
            }),
        },
    };
}

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
    args: Omit<FunctionArgs<ControlApi["operation"]>, "historical">,
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
    lease: FunctionArgs<ControlApi["terminalCompletionAccepted"]>,
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
    args: Omit<FunctionArgs<ControlApi["publicationFragment"]>, "index">,
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

async function reconstructBody(
    read: (
        index: number,
    ) => Promise<FunctionReturnType<ControlApi["invocationFragment"]>>,
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

type ReplyInstructionPage = NonNullable<
    FunctionReturnType<LifecycleApi["replyInstructionPage"]>
>;

async function readReplyWording(
    ctx: ActionCtx,
    scope: {
        invocationId: Id<"agentInvocations">;
        expectedGeneration: number;
        responseHash: string;
    },
    signal?: AbortSignal,
) {
    const references: ReplyInstructionPage["page"] = [];
    let transmitted: ReplyInstructionPage["page"] = [];
    let cursor: string | null = null;
    for (;;) {
        signal?.throwIfAborted();
        const page: ReplyInstructionPage | null = await ctx.runQuery(
            internal.execution.invocationLifecycle.replyInstructionPage,
            {
                ...scope,
                paginationOpts: { cursor, numItems: HISTORY_PAGE_SIZE },
            },
        );
        if (!page) return null;
        if (page.transmitted) transmitted = page.transmitted;
        references.push(...page.page);
        if (page.isDone) break;
        if (page.continueCursor === cursor)
            throw executionError("conversation_message_unavailable");
        cursor = page.continueCursor;
    }
    const activeIds = new Set(references.map(({ messageId }) => messageId));
    for (const reference of transmitted) {
        if (!activeIds.has(reference.messageId)) references.push(reference);
    }
    const exact: { messageId: Id<"agentMessageDeliveries">; text: string }[] =
        [];
    for (const { messageId, contentHash } of references) {
        const read = (index: number) => {
            signal?.throwIfAborted();
            return ctx.runQuery(
                internal.execution.invocationLifecycle.replyInstructionFragment,
                {
                    ...scope,
                    messageId,
                    contentHash,
                    index,
                },
            );
        };
        const first = await read(0);
        const parts = [first.content];
        for (let index = 1; index < first.fragmentCount; index++)
            parts.push((await read(index)).content);
        exact.push({
            messageId,
            text: verifyRetainedText({ ...first, contentHash }, parts.join("")),
        });
    }
    return {
        wording: projectAnalystWording(exact),
        texts: new Map(exact.map(({ messageId, text }) => [messageId, text])),
    };
}

/** Prepares a structured result in the domain query and stages its immutable bytes before adoption. */
export async function preparePiResult(
    ctx: ActionCtx,
    authority: {
        invocationId: Id<"agentInvocations">;
        expectedGeneration: number;
    },
    response: Infer<typeof invocationResponseValidator>,
    responseJson: string,
    definition: AgentDefinition,
    signal?: AbortSignal,
): Promise<
    | {
          preparedResult?: NonNullable<
              FunctionArgs<LifecycleApi["finish"]>["preparedResult"]
          >;
          refusal?: Infer<typeof preparedSubmissionValidator>;
      }
    | undefined
> {
    if (!definition.preparedResult) return undefined;
    let proposal: unknown;
    if (response.kind === "complete") proposal = response;
    else if (response.kind === "completion_submission" && response.call) {
        try {
            proposal = JSON.parse(response.call.inputJson);
        } catch {
            return undefined;
        }
    } else return undefined;
    if (!validate(definition.completionValidator, proposal)) return undefined;
    const callId =
        response.kind === "completion_submission"
            ? response.call?.callId
            : undefined;
    if (callId !== undefined && (callId.length < 1 || callId.length > 160))
        return undefined;
    const responseHash = sha256Hex(responseJson);
    const completion = completionMetadata(proposal, responseHash, callId);
    const capacity = definition.preparedResult.proposalCapacity(proposal);
    if (capacity || completion.workingNotesOversized) {
        return {
            refusal: {
                responseHash,
                response: {
                    kind: "completion_refusal",
                    code: capacity ?? "invalid_completion",
                    completion,
                },
            },
        };
    }
    const { workingNotes: _workingNotes, ...canonicalProposal } = proposal;
    const basis = await ctx.runQuery(
        internal.execution.invocationLifecycle.resultPreparation,
        {
            ...authority,
            responseHash,
            proposal: canonicalProposal,
        },
    );
    if (!basis) return undefined;
    const { parts, manifest } = retainedTextParts(
        stableStringify(basis.result),
    );
    const proposalHash = sha256Hex(stableStringify(canonicalProposal));
    let textId: Id<"retainedTexts"> | undefined;
    for (const [index, content] of parts.entries()) {
        signal?.throwIfAborted();
        textId = await ctx.runMutation(
            internal.execution.invocationLifecycle.stagePreparedResult,
            {
                ...authority,
                responseHash,
                inputHash: basis.inputHash,
                proposalHash,
                fragment: { ...manifest, index, content },
            },
        );
    }
    return textId
        ? {
              preparedResult: {
                  textId,
                  inputHash: basis.inputHash,
                  proposal: canonicalProposal,
                  completion,
              },
          }
        : undefined;
}

/** Stages the rendered reply one fragment at a time before business adoption. */
export async function preparePiReply(
    ctx: ActionCtx,
    authority: {
        invocationId: Id<"agentInvocations">;
        expectedGeneration: number;
    },
    response: Infer<typeof invocationResponseValidator>,
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
        !hasCompletionText(proposal)
    )
        return undefined;
    const callId =
        response.kind === "completion_submission"
            ? response.call?.callId
            : undefined;
    if (callId !== undefined && (callId.length < 1 || callId.length > 160))
        return undefined;
    const completion = completionMetadata(
        proposal,
        sha256Hex(responseJson),
        callId,
    );
    const scope = { ...authority, responseHash: sha256Hex(responseJson) };
    const wordingRead = definition.preparedCompletion.analystWording
        ? await readReplyWording(ctx, scope, signal)
        : undefined;
    if (wordingRead === null) return undefined;
    const wording = wordingRead?.wording;
    const basis = await ctx.runQuery(
        internal.execution.invocationLifecycle.replyPreparation,
        { ...scope, ...(wording ? { wording } : {}) },
    );
    if (!basis)
        return wording && definition.preparedCompletion.correction
            ? { correctionWording: wording, completion }
            : undefined;
    const exactFactsRevision =
        basis.factsRevisionTemplate && wordingRead
            ? materializeWordingRevision(
                  basis.factsRevisionTemplate,
                  wordingRead.texts,
              )
            : undefined;
    const { result, reviewDraft } = definition.preparedCompletion.render(
        proposal,
        basis,
    );
    if (!validate(definition.resultValidator, result)) return undefined;
    const reply = definition.conversationReply(result);
    if (!reply.trim()) return undefined;
    const stageBasisHash = preparedReplyBasisHash(
        basis.basisHash,
        reviewDraft,
        completion,
        wording,
        exactFactsRevision,
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
              ...(wording ? { wording } : {}),
              ...(exactFactsRevision ? { exactFactsRevision } : {}),
              ...(reviewDraft ? { reviewDraft } : {}),
          }
        : undefined;
}
