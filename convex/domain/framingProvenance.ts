import type { Doc } from "@convex/_generated/dataModel";
import type { QueryCtx } from "@convex/_generated/server";
import { conversationInstructions } from "@convex/execution/conversations";
import { executionError } from "@convex/execution/errors";
import type { Infer } from "convex/values";
import type {
    framingContentValidator,
    provisionalOpenEvent,
} from "./framingContracts";
import { stableStringify } from "./sourcePassages";
import {
    observedPublicContext,
    observedPublicRead,
} from "./workbenchContracts";

type PublicBasis = Extract<
    NonNullable<Doc<"framingRevisions">["eventBasis"]>,
    { kind: "public" }
>;

type ReadingAssociation =
    | Pick<Extract<PublicBasis, { readIds: unknown }>, "readIds">
    | Pick<
          Exclude<PublicBasis, { readIds: unknown }>,
          "lookupRequestId" | "referenceIndexes"
      >;
type FramingWriteAuthority = {
    current: Doc<"framingRevisions">;
    mission: Doc<"agentMissions">;
    request: Doc<"agentOperationRequests">;
    messageId: Extract<
        Doc<"agentOperationRequests">["input"],
        { kind: "adjust_framing" }
    >["messageId"];
};

async function publicBasisReadings(ctx: QueryCtx, basis: ReadingAssociation) {
    if ("readIds" in basis) {
        const requests = await Promise.all(
            basis.readIds.map((id) => ctx.db.get(id)),
        );
        const results = requests.map(observedPublicRead);
        return {
            requests,
            references: results.map((result) =>
                result?.reference
                    ? {
                          ...result.reference,
                          ...(result.replayCorpusHash
                              ? { replayCorpusHash: result.replayCorpusHash }
                              : {}),
                      }
                    : undefined,
            ),
            valid: results.every(Boolean),
        };
    }
    const request = await ctx.db.get(basis.lookupRequestId);
    const result = observedPublicContext(request);
    return {
        requests: [request],
        references: basis.referenceIndexes.map(
            (index) => result?.references[index],
        ),
        valid: !!result,
    };
}

/** Rehydrates exact adopted passages without reacquisition or current-turn authority for historical associations. */
export async function framingPublicReferences(
    ctx: QueryCtx,
    basis: PublicBasis,
) {
    const readings = await publicBasisReadings(ctx, basis);
    return readings.references.flatMap((reference) =>
        reference ? [reference] : [],
    );
}

async function requireFreshReadings(
    ctx: QueryCtx,
    args: FramingWriteAuthority,
    basis: ReadingAssociation,
) {
    const { current, mission, request, messageId } = args;
    const directed = "readIds" in basis;
    const readings = await publicBasisReadings(ctx, basis);
    if (
        !readings.valid ||
        readings.requests.some(
            (reading) =>
                !reading ||
                reading.input.kind !==
                    (directed
                        ? "read_public_context"
                        : "verify_public_context") ||
                reading.runId !== mission.runId ||
                reading.missionId !== mission._id ||
                reading.pin?.kind !== "framing_revision" ||
                reading.pin.revisionId !== current._id ||
                reading.instructionVersion !== request.instructionVersion ||
                !("messageId" in reading.input) ||
                reading.input.messageId !== messageId,
        )
    )
        throw executionError("framing_public_lookup_invalid", [
            {
                path: directed
                    ? "eventBasis.readIds"
                    : "eventBasis.lookupRequestId",
                expected: directed
                    ? "The readIds of adopted read_public_context passages for this message and framing revision."
                    : "The requestId of the adopted verify_public_context result for this message and framing revision.",
            },
        ]);
    const identities = directed ? basis.readIds : basis.referenceIndexes;
    if (
        !identities.length ||
        new Set<string | number>(identities).size !== identities.length ||
        readings.references.some((reference) => !reference?.excerpt.trim()) ||
        (!directed &&
            basis.referenceIndexes.some(
                (index) => !Number.isSafeInteger(index),
            ))
    )
        throw executionError("framing_event_basis_invalid");
    return readings;
}

/** Fresh associations require the causing message and revision; an unchanged authoritative association can survive a later edit. */
export async function validateFramingPublicBasis(
    ctx: QueryCtx,
    args: FramingWriteAuthority & { basis: PublicBasis; scope: string },
) {
    const { basis, current, scope, mission } = args;
    const directed = "readIds" in basis;
    if (directed && mission.definitionVersion !== 5)
        throw executionError("framing_event_basis_invalid");
    const inherited =
        current.content.scope === scope &&
        stableStringify(current.eventBasis) === stableStringify(basis);
    if (inherited) return basis;
    if (!directed && mission.definitionVersion === 5)
        throw executionError("framing_event_basis_invalid");
    const readings = await requireFreshReadings(ctx, args, basis);
    if (!basis.label.trim())
        throw executionError("framing_event_basis_invalid");
    const dated = readings.references.some(
        (reference) =>
            reference &&
            [reference.eventAt, reference.publishedAt].some((date) =>
                typeof date === "number"
                    ? Number.isFinite(date)
                    : typeof date === "string" &&
                      Number.isFinite(Date.parse(date)),
            ),
    );
    if (!dated) {
        if (directed)
            throw executionError("framing_public_reference_undated", [
                {
                    path: "eventBasis.readIds",
                    expected:
                        "Include an applicable dated reading, or leave the event open unless the analyst identified it in the active message.",
                },
            ]);
        const result = observedPublicContext(readings.requests[0] ?? null);
        const datedIndexes =
            result?.references.flatMap((reference, index) =>
                reference.excerpt.trim() &&
                (reference.eventAt !== undefined ||
                    reference.publishedAt !== undefined)
                    ? [index]
                    : [],
            ) ?? [];
        throw executionError("framing_public_reference_undated", [
            {
                path: "eventBasis.referenceIndexes",
                expected: datedIndexes.length
                    ? `Keep lookupRequestId ${basis.lookupRequestId}. Include an applicable dated reference from indexes [${datedIndexes.join(", ")}].`
                    : `Lookup ${basis.lookupRequestId} has no dated reading. Leave the event open unless the analyst identified it in the active message.`,
            },
        ]);
    }
    return basis;
}

/** Safe company-level inquiry while no narrower analyst activity has been established. */
export function companyProvisionalProgram(company: string) {
    return {
        scope: `Investigate the resilience of ${company} in its core operating workflows while the event is being clarified.`,
        questions: [
            {
                id: "resilience-baseline",
                shortLabel: "Operating resilience",
                text: "Which dependencies and alternatives determine how the company can sustain operations and retain value through a disruption?",
                rationale:
                    "Identify where the company controls the workflow and where customer, supplier or operating constraints could make a disruption material.",
            },
        ],
    };
}

/** Validates the activity anchor and each question's conditional association, then renders each condition once. */
export async function prepareProvisionalFraming(
    ctx: QueryCtx,
    args: FramingWriteAuthority & {
        basis: Infer<typeof provisionalOpenEvent>;
        content: Infer<typeof framingContentValidator>;
        company: string;
    },
) {
    const { basis, content, current, mission, messageId } = args;
    const instructions = await conversationInstructions(ctx, mission);
    const original = instructions?.messages.find(
        (message) => message.messageId === messageId,
    )?.text;
    if (!original) throw executionError("framing_event_basis_invalid");
    const previous =
        current.eventBasis?.kind === "open" ? current.eventBasis : undefined;
    const excerpt = basis.activityExcerpt;
    let scope = content.scope;
    if (excerpt !== undefined) {
        const inherited =
            current.content.scope === scope &&
            previous?.activityExcerpt === excerpt;
        if (
            !excerpt.trim() ||
            !scope.includes(excerpt) ||
            (!inherited && !original.includes(excerpt))
        )
            throw executionError("framing_event_basis_invalid");
    } else if (!current.content.scope.trim()) {
        scope = companyProvisionalProgram(args.company).scope;
    } else if (scope !== current.content.scope) {
        throw executionError("framing_event_basis_invalid");
    }
    const conditions = basis.conditions ?? [];
    if (
        new Set(conditions.map((condition) => condition.questionId)).size !==
            conditions.length ||
        new Set(content.questions.map((question) => question.id)).size !==
            content.questions.length
    )
        throw executionError("framing_event_basis_invalid");
    const questions = content.questions.map((question) => {
        const old = previous?.conditions?.find(
            (item) => item.questionId === question.id,
        );
        const incoming = conditions.find(
            (item) => item.questionId === question.id,
        );
        const oldPrefix = old ? `If ${old.hypothesis}, ` : undefined;
        const text =
            oldPrefix &&
            old?.hypothesis !== incoming?.hypothesis &&
            question.text.startsWith(oldPrefix)
                ? question.text.slice(oldPrefix.length)
                : question.text;
        return { ...question, text };
    });
    for (const condition of conditions) {
        const question = questions.find(
            (item) => item.id === condition.questionId,
        );
        if (!question || !condition.hypothesis.trim())
            throw executionError("framing_event_basis_invalid");
        const prefix = `If ${condition.hypothesis}, `;
        const canonicalText = question.text.startsWith(prefix)
            ? question.text
            : `${prefix}${question.text}`;
        const oldCondition = previous?.conditions?.find(
            (item) => item.questionId === question.id,
        );
        const oldQuestion = current.content.questions.find(
            (item) => item.id === question.id,
        );
        const inherited =
            current.content.scope === scope &&
            oldQuestion?.text === canonicalText &&
            oldCondition?.hypothesis === condition.hypothesis &&
            stableStringify(oldCondition.basis) ===
                stableStringify(condition.basis);
        if (!inherited) {
            if (condition.basis.kind === "analyst") {
                if (
                    !condition.basis.excerpt.trim() ||
                    !original.includes(condition.basis.excerpt)
                )
                    throw executionError("framing_event_basis_invalid");
            } else {
                await requireFreshReadings(ctx, args, condition.basis);
            }
        }
        question.text = canonicalText;
    }
    return { content: { ...content, scope, questions }, basis };
}

/** Historical question evidence uses the retained association, without current-turn authorization or I/O. */
export async function framingConditionalReferences(
    ctx: QueryCtx,
    basis: NonNullable<Doc<"framingRevisions">["eventBasis"]>,
) {
    if (basis.kind !== "open") return [];
    const readIds = [
        ...new Set(
            (basis.conditions ?? []).flatMap((condition) =>
                condition.basis.kind === "public"
                    ? condition.basis.readIds
                    : [],
            ),
        ),
    ];
    const readings = await publicBasisReadings(ctx, { readIds });
    return readIds.flatMap((readId, index) => {
        const reference = readings.references[index];
        return reference ? [{ readId, ...reference }] : [];
    });
}

/** A direct edit retains only evidence associations whose scope and question text are unchanged. */
export function framingBasisAfterEdit(
    previous: Doc<"framingRevisions">,
    content: Infer<typeof framingContentValidator>,
) {
    if (previous.content.scope !== content.scope) return undefined;
    const basis = previous.eventBasis;
    if (basis?.kind !== "open" || !basis.conditions) return basis;
    return {
        ...basis,
        conditions: basis.conditions.filter((condition) => {
            const oldQuestion = previous.content.questions.find(
                (question) => question.id === condition.questionId,
            );
            const newQuestion = content.questions.find(
                (question) => question.id === condition.questionId,
            );
            return (
                oldQuestion &&
                newQuestion &&
                oldQuestion.text === newQuestion.text
            );
        }),
    };
}
