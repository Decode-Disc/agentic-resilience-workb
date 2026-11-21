import type { Doc } from "@convex/_generated/dataModel";
import type { QueryCtx } from "@convex/_generated/server";
import { conversationInstructions } from "@convex/execution/conversations";
import { executionError } from "@convex/execution/errors";
import type { Infer } from "convex/values";
import { validate } from "convex-helpers/validators";
import { unambiguousDocumentTime } from "./documentDates";
import type {
    framingCitationPolicy,
    framingContentValidator,
    framingWriteReceipt,
    supportedProvisionalOpenEvent,
} from "./framingContracts";
import {
    adoptedDocumentaryBasis,
    framingWriteState,
    provisionalOpenEvent,
} from "./framingContracts";
import {
    displayedDocumentaryPassage,
    resolveDocumentaryPinCapture,
} from "./savedMaterial";
import { containsDocumentaryReference } from "./savedMaterialOperations";
import { stableStringify } from "./sourcePassages";
import {
    framingObservationRefusal,
    observedPublicContext,
    observedPublicRead,
    supportsDirectedFraming,
} from "./workbenchContracts";

/** Public references belong to the saved basis, outside analyst-facing framing text. */
export function requireFramingDocumentaryFields(
    content: Infer<typeof framingContentValidator>,
) {
    const fields = [
        { path: "content.scope", text: content.scope },
        ...content.questions.flatMap(
            ({ text, shortLabel, rationale }, index) => [
                { path: `content.questions[${index}].text`, text },
                {
                    path: `content.questions[${index}].shortLabel`,
                    text: shortLabel,
                },
                {
                    path: `content.questions[${index}].rationale`,
                    text: rationale,
                },
            ],
        ),
    ];
    const copied = fields.find(({ text }) =>
        containsDocumentaryReference(text),
    );
    if (copied)
        throw executionError("framing_documentary_reference_in_text", [
            {
                path: copied.path,
                expected:
                    "Keep documentary reference tokens in the structured event or question basis. Use readable wording here.",
            },
        ]);
}

type PublicBasis = Extract<
    NonNullable<Doc<"framingRevisions">["eventBasis"]>,
    { kind: "public" }
>;

/** Records the associations themselves, even if a retained passage later becomes unavailable. */
export function savedFramingReceipt(
    revision: Pick<Doc<"framingRevisions">, "eventBasis" | "revision">,
): Infer<typeof framingWriteReceipt> {
    const basis = revision.eventBasis;
    const references = (
        citation:
            | ReadingAssociation
            | Pick<Infer<typeof adoptedDocumentaryBasis>, "references">,
    ) => {
        if ("references" in citation) return [...new Set(citation.references)];
        if ("readIds" in citation) return [...new Set(citation.readIds)];
        return [...new Set(citation.referenceIndexes)].map((index) => ({
            lookupRequestId: citation.lookupRequestId,
            index,
        }));
    };
    return {
        revision: revision.revision,
        eventBasis: basis?.kind ?? "unspecified",
        publicCitations: {
            event: basis?.kind === "public" ? references(basis) : [],
            conditions:
                basis?.kind === "open"
                    ? (basis.conditions ?? []).flatMap(
                          ({ questionId, basis }) =>
                              basis.kind === "public"
                                  ? [
                                        {
                                            questionId,
                                            references: references(basis),
                                        },
                                    ]
                                  : [],
                      )
                    : [],
        },
    };
}

type LegacyPublicBasis = Exclude<PublicBasis, { references: unknown }>;
type ReadingAssociation =
    | Pick<Extract<PublicBasis, { readIds: unknown }>, "readIds">
    | Pick<
          Exclude<LegacyPublicBasis, { readIds: unknown }>,
          "lookupRequestId" | "referenceIndexes"
      >;
type FramingWriteAuthority = {
    current: Doc<"framingRevisions">;
    mission: Doc<"agentMissions">;
    request: Doc<"agentOperationRequests">;
    citationPolicy?: Infer<typeof framingCitationPolicy>;
    messageId: Extract<
        Doc<"agentOperationRequests">["input"],
        { kind: "adjust_framing" }
    >["messageId"];
};

type DisplayedPassage = NonNullable<
    Awaited<ReturnType<typeof displayedDocumentaryPassage>>
>;

function documentaryAssociation(reference: string, passage: DisplayedPassage) {
    const { value, issuer, excerpt, range } = passage;
    return {
        reference,
        readId: issuer._id,
        sourceId: value.sourceId,
        captureId: value.captureId,
        contentHash: value.contentHash,
        url: value.canonicalUrl,
        publisher: new URL(value.canonicalUrl).hostname,
        excerpt,
        range,
        dates: value.document.dates,
        publishedAt: value.document.publishedAt ?? undefined,
        eventAt: value.document.dates
            ? unambiguousDocumentTime(value.document.dates.event)
            : undefined,
    };
}

async function requireFreshDocumentaryReferences(
    ctx: QueryCtx,
    args: FramingWriteAuthority,
    references: string[],
    path: string,
) {
    if (
        !args.citationPolicy ||
        !references.length ||
        references.length !== new Set(references).size
    )
        throw executionError("framing_event_basis_invalid", [
            {
                path,
                expected:
                    "Select distinct displayed references from adopted documentary passages.",
            },
        ]);
    const associations = [];
    for (const [index, reference] of references.entries()) {
        const passage = await displayedDocumentaryPassage(ctx, reference);
        const refusal = framingObservationRefusal(passage?.issuer ?? null, {
            ...args.request,
            messageId: args.messageId,
        });
        const pin = passage?.issuer.pin;
        if (
            !passage ||
            refusal ||
            pin?.kind !== "documentary_v1" ||
            (passage.issuer.adoptionGeneration ??
                passage.issuer.expectedGeneration) !==
                args.mission.generation ||
            !passage.excerpt.trim()
        )
            throw executionError(
                refusal === "framing_observation_stale"
                    ? refusal
                    : "framing_public_lookup_invalid",
                [
                    {
                        path: `${path}[${index}]`,
                        expected:
                            "Use a displayed passage adopted for the current analyst message and instruction.",
                    },
                ],
            );
        const capture = await resolveDocumentaryPinCapture(ctx, pin.target);
        if (
            capture?.runId !== args.current.runId ||
            capture?.status !== "committed" ||
            capture._id !== passage.value.captureId ||
            capture.sourceId !== passage.value.sourceId ||
            capture.contentHash !== passage.value.contentHash ||
            stableStringify(capture.document) !==
                stableStringify(passage.value.document)
        )
            throw executionError("framing_public_lookup_invalid", [
                {
                    path: `${path}[${index}]`,
                    expected:
                        "Use an adopted passage from an available capture of this dossier.",
                },
            ]);
        if (
            args.citationPolicy.requireContextRead &&
            passage.issuer.input.kind !== "read_in_context"
        )
            throw executionError("framing_public_context_required", [
                {
                    path: `${path}[${index}]`,
                    expected:
                        "Read the document with read_in_context and cite the displayed passage reference returned by that reading.",
                },
            ]);
        associations.push(documentaryAssociation(reference, passage));
    }
    return associations;
}

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
    if ("references" in basis) {
        const passages = await Promise.all(
            basis.references.map(async (reference) => {
                const passage = await displayedDocumentaryPassage(
                    ctx,
                    reference,
                );
                return passage
                    ? documentaryAssociation(reference, passage)
                    : null;
            }),
        );
        return passages.filter((passage) => passage !== null);
    }
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
    const { request, messageId } = args;
    const directed = "readIds" in basis;
    const readings = await publicBasisReadings(ctx, basis);
    const authorityRefusal = readings.requests
        .map((reading) =>
            framingObservationRefusal(reading, { ...request, messageId }),
        )
        .find((refusal) => refusal !== undefined);
    if (
        !readings.valid ||
        authorityRefusal ||
        readings.requests.some(
            (reading) =>
                !reading ||
                reading.input.kind !==
                    (directed
                        ? "read_public_context"
                        : "verify_public_context"),
        )
    )
        throw executionError(
            authorityRefusal === "framing_observation_stale"
                ? authorityRefusal
                : "framing_public_lookup_invalid",
            [
                {
                    path: directed
                        ? "eventBasis.readIds"
                        : "eventBasis.lookupRequestId",
                    expected: directed
                        ? "The readIds of adopted read_public_context passages for this active message and instruction authority."
                        : "The requestId of the adopted verify_public_context result for this active message and instruction authority.",
                },
            ],
        );
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
        throw executionError("framing_event_basis_invalid", [
            {
                path: directed
                    ? "eventBasis.readIds"
                    : "eventBasis.referenceIndexes",
                expected:
                    "Select distinct adopted readings with nonblank passages; the reading association must not be empty.",
            },
        ]);
    return readings;
}

/** Fresh associations require the causing message and instruction authority; an unchanged authoritative association can survive a later edit. */
export async function validateFramingPublicBasis(
    ctx: QueryCtx,
    args: FramingWriteAuthority & { basis: PublicBasis; scope: string },
) {
    const { basis, current, scope, mission } = args;
    const inherited =
        current.content.scope === scope &&
        stableStringify(current.eventBasis) === stableStringify(basis);
    if (inherited) return basis;
    if ("references" in basis) {
        if (!basis.label.trim())
            throw executionError("framing_event_basis_invalid");
        const associations = await requireFreshDocumentaryReferences(
            ctx,
            args,
            basis.references,
            "eventBasis.references",
        );
        if (
            !associations.some(({ publishedAt, eventAt }) =>
                [publishedAt, eventAt].some(
                    (value) => value !== undefined && Number.isFinite(value),
                ),
            )
        )
            throw executionError("framing_public_reference_undated", [
                {
                    path: "eventBasis.references",
                    expected:
                        "Include an applicable dated passage, or preserve an open event basis.",
                },
            ]);
        return basis;
    }
    if (args.citationPolicy)
        throw executionError("framing_event_basis_invalid", [
            {
                path: "eventBasis.references",
                expected:
                    "Use references returned for adopted documentary passages in this turn.",
            },
        ]);
    const directed = "readIds" in basis;
    if (directed && !supportsDirectedFraming(mission.definitionVersion))
        throw executionError("framing_event_basis_invalid");
    if (!directed && supportsDirectedFraming(mission.definitionVersion))
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
        basis: Infer<typeof supportedProvisionalOpenEvent>;
        content: Infer<typeof framingContentValidator>;
    },
) {
    const { basis, content, current, mission, messageId } = args;
    const instructions = await conversationInstructions(ctx, mission);
    const original = instructions?.messages.find(
        (message) => message.messageId === messageId,
    )?.text;
    if (!original)
        throw executionError("framing_event_basis_invalid", [
            {
                path: "messageId",
                expected:
                    "Use the active analyst message that authorizes this framing proposal.",
            },
        ]);
    const previous =
        current.eventBasis?.kind === "open" ? current.eventBasis : undefined;
    const excerpt = basis.activityExcerpt;
    const scope = content.scope;
    if (excerpt !== undefined) {
        const inherited =
            current.content.scope === scope &&
            previous?.activityExcerpt === excerpt;
        if (!excerpt.trim() || (!inherited && !original.includes(excerpt)))
            throw executionError("framing_event_basis_invalid", [
                {
                    path: "eventBasis.activityExcerpt",
                    expected:
                        "Copy a nonblank activity excerpt exactly from the active analyst message, or preserve the unchanged authorized scope and its activity excerpt.",
                },
            ]);
        if (!scope.includes(excerpt))
            throw executionError("framing_event_basis_invalid", [
                {
                    path: "content.scope",
                    expected:
                        "Include eventBasis.activityExcerpt verbatim in content.scope. Correct the scope wording rather than changing unrelated conditional hypotheses.",
                },
            ]);
    } else if (framingWriteState(current.content) === "initial") {
        if (!scope.trim())
            throw executionError("framing_event_basis_invalid", [
                {
                    path: "content.scope",
                    expected: "Supply a nonblank scope.",
                },
            ]);
        throw executionError("framing_event_basis_invalid", [
            {
                path: "eventBasis.activityExcerpt",
                expected:
                    "Supply eventBasis.activityExcerpt with a nonblank verbatim excerpt of the active analyst request. Changing content.scope alone does not supply this missing field.",
            },
        ]);
    } else if (scope !== current.content.scope) {
        throw executionError("framing_event_basis_invalid", [
            {
                path: "content.scope",
                expected:
                    "Preserve the authorized scope, or supply an exact analyst activityExcerpt also included in the changed scope.",
            },
        ]);
    }
    const conditions = basis.conditions ?? [];
    if (
        new Set(conditions.map((condition) => condition.questionId)).size !==
        conditions.length
    )
        throw executionError("framing_event_basis_invalid", [
            {
                path: "eventBasis.conditions",
                expected:
                    "Associate at most one condition with each questionId.",
            },
        ]);
    if (
        new Set(content.questions.map((question) => question.id)).size !==
        content.questions.length
    )
        throw executionError("framing_event_basis_invalid", [
            {
                path: "content.questions",
                expected: "Use a distinct id for each question.",
            },
        ]);
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
    for (const [index, condition] of conditions.entries()) {
        const question = questions.find(
            (item) => item.id === condition.questionId,
        );
        if (!question)
            throw executionError("framing_event_basis_invalid", [
                {
                    path: `eventBasis.conditions[${index}].questionId`,
                    expected: "Refer to an id present in content.questions.",
                },
            ]);
        if (!condition.hypothesis.trim())
            throw executionError("framing_event_basis_invalid", [
                {
                    path: `eventBasis.conditions[${index}].hypothesis`,
                    expected:
                        "Supply a nonblank hypothesis or remove this condition.",
                },
            ]);
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
                    throw executionError("framing_event_basis_invalid", [
                        {
                            path: `eventBasis.conditions[${index}].basis.excerpt`,
                            expected:
                                "Use a nonblank exact excerpt from the active analyst message; do not attribute an invented hypothesis to the analyst.",
                        },
                    ]);
            } else if (validate(adoptedDocumentaryBasis, condition.basis)) {
                await requireFreshDocumentaryReferences(
                    ctx,
                    args,
                    condition.basis.references,
                    `eventBasis.conditions[${index}].basis.references`,
                );
            } else if ("readIds" in condition.basis) {
                if (args.citationPolicy)
                    throw executionError("framing_event_basis_invalid", [
                        {
                            path: `eventBasis.conditions[${index}].basis.references`,
                            expected:
                                "Use references returned for adopted documentary passages in this turn.",
                        },
                    ]);
                await requireFreshReadings(ctx, args, condition.basis);
            } else {
                throw executionError("framing_event_basis_invalid");
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
                condition.basis.kind === "public" &&
                "readIds" in condition.basis
                    ? condition.basis.readIds
                    : [],
            ),
        ),
    ];
    const readings = await publicBasisReadings(ctx, { readIds });
    const retained = readIds.flatMap((readId, index) => {
        const reference = readings.references[index];
        return reference ? [{ readId, ...reference }] : [];
    });
    const references = [
        ...new Set(
            (basis.conditions ?? []).flatMap((condition) =>
                validate(adoptedDocumentaryBasis, condition.basis)
                    ? condition.basis.references
                    : [],
            ),
        ),
    ];
    const displayed = await Promise.all(
        references.map(async (reference) => {
            const passage = await displayedDocumentaryPassage(ctx, reference);
            return passage ? documentaryAssociation(reference, passage) : null;
        }),
    );
    return [...retained, ...displayed.filter((passage) => passage !== null)];
}

/** A direct edit retains only evidence associations whose scope and question text are unchanged. */
export function framingBasisAfterEdit(
    previous: Doc<"framingRevisions">,
    content: Infer<typeof framingContentValidator>,
): Doc<"framingRevisions">["eventBasis"] {
    if (previous.content.scope !== content.scope) return undefined;
    const basis = previous.eventBasis;
    if (basis?.kind !== "open" || !basis.conditions) return basis;
    const unchanged = ({ questionId }: { questionId: string }) => {
        const oldQuestion = previous.content.questions.find(
            (question) => question.id === questionId,
        );
        const newQuestion = content.questions.find(
            (question) => question.id === questionId,
        );
        return (
            oldQuestion && newQuestion && oldQuestion.text === newQuestion.text
        );
    };
    if (validate(provisionalOpenEvent, basis))
        return { ...basis, conditions: basis.conditions?.filter(unchanged) };
    return { ...basis, conditions: basis.conditions.filter(unchanged) };
}
