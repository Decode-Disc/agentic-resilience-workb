import type { DataModel, Doc, Id } from "@convex/_generated/dataModel";
import {
    MAX_CLAIM_STATEMENT_CHARS,
    MAX_QUOTATION_CHARS,
} from "@convex/resourceLimits";
import type { GenericDatabaseReader } from "convex/server";
import { zodToConvex } from "convex-helpers/server/zod4";
import { z } from "zod";
import type { ClaimClassification, EvidenceRelation } from "./claims";
import {
    SOURCE_COMPARISON_MAX_CONTEXT_PASSAGES_PER_FINDING,
    SOURCE_COMPARISON_MAX_PASSAGES_PER_FINDING,
    SOURCE_COMPARISON_VERSION,
    type SourceComparisonDisposition,
    type SourceComparisonOutput,
    sourceComparisonDispositionSchema,
} from "./sourceComparison";
import {
    readPreparationSourceDecision,
    sourcePreparationError,
} from "./sourcePreparationAuthority";
import type { SourceQualification } from "./sourceQualification";
import {
    MAX_QUALIFICATION_FINDINGS,
    SOURCE_QUALIFICATION_VERSION,
    sourceQualificationSchema,
} from "./sourceQualification";
import type { SourceReviewReads } from "./sourceReviewReads";
import type {
    SourceCoverageRole,
    SourceRoleAvailability,
} from "./sourceSelectionPolicy";
import {
    SOURCE_EVIDENCE_USAGES,
    sourceFindingUsage,
    sourcePassagesRequireVerification,
} from "./sourceSelectionPolicy";

// A proposal stores comparison references in one Convex array; this is a format capacity, not an attempt allowance.
const MAX_COMPARISON_HISTORY_REFERENCES = 8192;

/** Reads comparison history newest first, sharing indexed scope and bounded retention across lookup and publication. */
export async function* readComparisonHistory(
    db: GenericDatabaseReader<DataModel>,
    scope:
        | { sourceId: Id<"sources"> }
        | { runId: Id<"researchRuns">; inputHash: string },
): AsyncGenerator<Doc<"aiTaskResults">> {
    const history =
        "sourceId" in scope
            ? db
                  .query("aiTaskResults")
                  .withIndex("by_source_and_task_type_and_created_at", (q) =>
                      q
                          .eq("sourceId", scope.sourceId)
                          .eq("taskType", "source_comparison"),
                  )
            : db
                  .query("aiTaskResults")
                  .withIndex("by_run_and_task_type_and_input_hash", (q) =>
                      q
                          .eq("runId", scope.runId)
                          .eq("taskType", "source_comparison")
                          .eq("inputHash", scope.inputHash),
                  );
    let read = 0;
    for await (const task of history.order("desc")) {
        if (++read > MAX_COMPARISON_HISTORY_REFERENCES)
            throw sourcePreparationError("comparison_history_capacity_reached");
        yield task;
    }
}

const sourceComparisonReviewDetailsSchema = z
    .object({
        explanation: z.string().min(1).max(600),
        primaryPassages: z
            .array(
                z
                    .object({
                        title: z.string().min(1).max(500),
                        canonicalUrl: z.string().min(1).max(2048),
                        quotation: z.string().min(1).max(MAX_QUOTATION_CHARS),
                    })
                    .strict(),
            )
            .max(
                SOURCE_COMPARISON_MAX_PASSAGES_PER_FINDING +
                    SOURCE_COMPARISON_MAX_CONTEXT_PASSAGES_PER_FINDING,
            ),
    })
    .strict();
type SourceComparisonReviewDetails = z.infer<
    typeof sourceComparisonReviewDetailsSchema
>;
type PinnedSourceComparisonReview = {
    requiredPrimaryReferences: SourceComparisonOutput["findings"][number]["primaryPassages"];
    outcomes: Record<number, SourceComparisonDisposition>;
    details: Record<number, SourceComparisonReviewDetails>;
};

function primaryReferenceKey(reference: {
    captureId: string;
    sourceId: string;
    contentHash: string;
}) {
    return `${reference.captureId}\u0000${reference.sourceId}\u0000${reference.contentHash}`;
}

export const sourceQualificationReviewValidator = zodToConvex(
    sourceQualificationSchema.extend({
        findings: z
            .array(
                sourceQualificationSchema.shape.findings.element.extend({
                    findingKey: z.string(),
                    usage: z.enum(SOURCE_EVIDENCE_USAGES),
                    comparisonOutcome:
                        sourceComparisonDispositionSchema.optional(),
                    comparisonDetails:
                        sourceComparisonReviewDetailsSchema.optional(),
                }),
            )
            .max(MAX_QUALIFICATION_FINDINGS),
    }),
);

/** Keeps citation restrictions visible even when a role also contains documentary material. */
export function projectSourceQualificationForReview(input: {
    qualification: SourceQualification;
    qualificationTaskId: Doc<"aiTaskResults">["_id"];
    roleAvailability: Array<Pick<SourceRoleAvailability, "role" | "usage">>;
    comparisonOutcomes?: Record<number, SourceComparisonDisposition>;
    comparisonDetails?: Record<number, SourceComparisonReviewDetails>;
}) {
    return {
        ...input.qualification,
        findings: input.qualification.findings.map((finding, ordinal) => ({
            ...finding,
            findingKey: `${input.qualificationTaskId}:${ordinal}`,
            usage: sourceFindingUsage(
                finding,
                input.roleAvailability.find(
                    (role) => role.role === finding.role,
                )?.usage ?? "blocked",
                input.comparisonOutcomes?.[ordinal],
                input.qualification.limitations,
            ),
            ...(input.comparisonOutcomes?.[ordinal]
                ? { comparisonOutcome: input.comparisonOutcomes[ordinal] }
                : {}),
            ...(input.comparisonDetails?.[ordinal]
                ? { comparisonDetails: input.comparisonDetails[ordinal] }
                : {}),
        })),
    };
}

export async function readPinnedComparisonReview(
    db: GenericDatabaseReader<DataModel>,
    item: Pick<
        Doc<"sourceSelectionProposalItems">,
        "runId" | "sourceId" | "corpusRevisionId" | "comparisonTaskIds"
    >,
    qualification: Awaited<ReturnType<typeof readPinnedSourceQualification>>,
    reads?: SourceReviewReads,
) {
    const emptyReview: PinnedSourceComparisonReview = {
        outcomes: {},
        details: {},
        requiredPrimaryReferences: [],
    };
    if (!qualification || !item.comparisonTaskIds?.length) return emptyReview;
    const qualificationTask = await (reads?.task(
        qualification.qualificationTaskId,
    ) ?? db.get(qualification.qualificationTaskId));
    const currentPassages = new Map(
        qualificationTask?.output.kind === "source_qualification"
            ? qualificationTask.output.selectedPassages.map((passage) => [
                  passage.passageKey,
                  passage,
              ])
            : [],
    );
    const tasks = (
        await Promise.all(
            item.comparisonTaskIds.map((id) => reads?.task(id) ?? db.get(id)),
        )
    )
        .filter(
            (task): task is Doc<"aiTaskResults"> =>
                task !== null &&
                task.runId === item.runId &&
                task.sourceId === item.sourceId &&
                task.taskType === "source_comparison" &&
                task.schemaVersion === SOURCE_COMPARISON_VERSION &&
                task.output.kind === "source_comparison" &&
                task.output.targetCaptureId === qualification.sourceCaptureId &&
                task.output.targetContentHash === qualification.contentHash,
        )
        .sort((left, right) => left.createdAt - right.createdAt);
    const reviewCandidates = new Map<
        number,
        {
            disposition: SourceComparisonDisposition;
            candidate: SourceComparisonOutput["findings"][number];
        }
    >();
    for (const [
        findingIndex,
        finding,
    ] of qualification.qualification.findings.entries()) {
        const targetPassages = finding.passages.flatMap((reference) => {
            const selected = currentPassages.get(reference.passageKey);
            return selected
                ? [
                      {
                          passageKey: reference.passageKey,
                          startOffset: selected.startOffset,
                          endOffset: selected.endOffset,
                      },
                  ]
                : [];
        });
        if (!targetPassages.length) continue;
        const overlaps = (
            candidate: SourceComparisonOutput["findings"][number],
        ) =>
            candidate.targetPassages.some((left) =>
                targetPassages.some(
                    (right) =>
                        left.startOffset < right.endOffset &&
                        right.startOffset < left.endOffset,
                ),
            );
        const applicable = tasks.flatMap((task) =>
            task.output.kind === "source_comparison"
                ? task.output.findings
                      .filter((candidate) => overlaps(candidate))
                      .map((candidate) => ({ task, candidate }))
                : [],
        );
        if (!applicable.length) continue;
        const conflict = applicable
            .filter(
                ({ candidate }) =>
                    candidate.disposition === "possible_conflict",
            )
            .at(-1)?.candidate;
        if (conflict) {
            reviewCandidates.set(findingIndex, {
                disposition: "possible_conflict",
                candidate: conflict,
            });
            continue;
        }
        const current = applicable
            .filter(
                ({ task }) =>
                    task.output.kind === "source_comparison" &&
                    task.output.qualificationTaskId ===
                        qualification.qualificationTaskId,
            )
            .filter(({ candidate }) => candidate.findingIndex === findingIndex)
            .filter(({ candidate }) => {
                const returned = candidate.targetPassages.map(
                    ({ passageKey, quotation }) =>
                        `${passageKey}\u0000${quotation}`,
                );
                const expected = finding.passages.map(
                    ({ passageKey, quotation }) =>
                        `${passageKey}\u0000${quotation}`,
                );
                return (
                    returned.length === expected.length &&
                    expected.every((reference) =>
                        returned.includes(reference),
                    ) &&
                    candidate.targetPassages.every((passage) =>
                        targetPassages.some(
                            (selected) =>
                                selected.passageKey === passage.passageKey &&
                                passage.startOffset >= selected.startOffset &&
                                passage.endOffset <= selected.endOffset,
                        ),
                    )
                );
            })
            .at(-1)?.candidate;
        if (!current) continue;
        reviewCandidates.set(findingIndex, {
            disposition: current.disposition,
            candidate: current,
        });
    }

    const primaryReferenceChecks = new Map<
        string,
        Promise<Pick<
            SourceComparisonReviewDetails["primaryPassages"][number],
            "title" | "canonicalUrl"
        > | null>
    >();
    for (const { candidate } of reviewCandidates.values()) {
        for (const reference of candidate.primaryPassages) {
            const key = primaryReferenceKey(reference);
            if (primaryReferenceChecks.has(key)) continue;
            primaryReferenceChecks.set(
                key,
                (async () => {
                    const capture = await (reads?.capture(
                        reference.captureId as Id<"sourceCaptures">,
                    ) ?? db.get(reference.captureId as Id<"sourceCaptures">));
                    const source = await (reads?.source(
                        reference.sourceId as Id<"sources">,
                    ) ?? db.get(reference.sourceId as Id<"sources">));
                    if (
                        capture?.status !== "committed" ||
                        capture.runId !== item.runId ||
                        capture.sourceId !== reference.sourceId ||
                        capture.contentHash !== reference.contentHash ||
                        !capture.storageId ||
                        !(await (reads?.artifact(capture.storageId) ??
                            db.system.get("_storage", capture.storageId))) ||
                        source?.runId !== item.runId
                    )
                        return null;
                    let decision: Awaited<
                        ReturnType<typeof readPreparationSourceDecision>
                    >;
                    try {
                        decision = reads
                            ? await reads.decision(
                                  item.corpusRevisionId,
                                  reference.sourceId as Id<"sources">,
                              )
                            : await readPreparationSourceDecision(db, {
                                  runId: item.runId,
                                  corpusRevisionId: item.corpusRevisionId,
                                  sourceId: reference.sourceId as Id<"sources">,
                              });
                    } catch {
                        return null;
                    }
                    return decision === "rejected"
                        ? null
                        : {
                              title: source.title,
                              canonicalUrl: source.canonicalUrl,
                          };
                })(),
            );
        }
    }
    const primaryContext = new Map(
        await Promise.all(
            [...primaryReferenceChecks].map(
                async ([key, check]) => [key, await check] as const,
            ),
        ),
    );
    const outcomes: Record<number, SourceComparisonDisposition> = {};
    const details: Record<number, SourceComparisonReviewDetails> = {};
    for (const [findingIndex, { disposition, candidate }] of reviewCandidates) {
        const availablePassages = candidate.primaryPassages.flatMap(
            (reference) => {
                const context = primaryContext.get(
                    primaryReferenceKey(reference),
                );
                return context
                    ? [
                          {
                              ...context,
                              quotation: reference.quotation,
                          },
                      ]
                    : [];
            },
        );
        const primaryPassages = [
            ...new Map(
                availablePassages.map((passage) => [
                    `${passage.canonicalUrl}\u0000${passage.quotation}`,
                    passage,
                ]),
            ).values(),
        ];
        const everyPrimaryPassageValid =
            availablePassages.length === candidate.primaryPassages.length;
        outcomes[findingIndex] =
            disposition === "no_conflict_observed"
                ? everyPrimaryPassageValid && primaryPassages.length > 0
                    ? disposition
                    : "inconclusive"
                : disposition === "possible_conflict"
                  ? primaryPassages.length > 0
                      ? disposition
                      : "inconclusive"
                  : disposition;
        if (primaryPassages.length > 0) {
            details[findingIndex] = {
                explanation: candidate.explanation,
                primaryPassages,
            };
        }
    }
    return {
        outcomes,
        details,
        requiredPrimaryReferences: [...reviewCandidates.values()].flatMap(
            ({ candidate }) => candidate.primaryPassages,
        ),
    };
}

/** Validates immutable content pins. Callers retain proposal, ownership and approval authority. */
export async function readPinnedSourceQualification(
    db: GenericDatabaseReader<DataModel>,
    item: Pick<
        Doc<"sourceSelectionProposalItems">,
        "runId" | "sourceId" | "sourceCaptureId" | "qualificationTaskId"
    >,
    reads?: SourceReviewReads,
) {
    if (!item.sourceCaptureId || !item.qualificationTaskId) return null;
    const [capture, task] = await Promise.all([
        reads?.capture(item.sourceCaptureId) ?? db.get(item.sourceCaptureId),
        reads?.task(item.qualificationTaskId) ??
            db.get(item.qualificationTaskId),
    ]);
    if (
        capture?.status !== "committed" ||
        capture.runId !== item.runId ||
        capture.sourceId !== item.sourceId ||
        !task ||
        ![SOURCE_QUALIFICATION_VERSION, "source-qualification-v2"].includes(
            task.schemaVersion,
        ) ||
        task.runId !== item.runId ||
        task.sourceId !== item.sourceId ||
        task.sourceCaptureId !== capture._id ||
        task.output.kind !== "source_qualification" ||
        task.output.sourceCaptureId !== capture._id ||
        task.output.contentHash !== capture.contentHash
    )
        return null;
    return {
        sourceCaptureId: capture._id,
        contentHash: capture.contentHash,
        qualificationTaskId: task._id,
        qualification: task.output.qualification,
        readingCompleteness: task.output.readingCompleteness,
        qualificationExecutionMode: task.executionMode,
    };
}

/** Resolves usage only from the approved proposal and the version's captured-content identity. */
export async function readPreparedSourceUsage(
    db: GenericDatabaseReader<DataModel>,
    version: Doc<"sourceVersions">,
) {
    const revision = await db.get(version.corpusRevisionId);
    const proposal = revision?.sourceSelectionProposalId
        ? await db.get(revision.sourceSelectionProposalId)
        : null;
    if (!proposal?.sourcePreparationId && !version.sourceCaptureId)
        return undefined;
    const source = await db.get(version.sourceId);
    const item = proposal
        ? await db
              .query("sourceSelectionProposalItems")
              .withIndex("by_proposal_and_source", (q) =>
                  q
                      .eq("proposalId", proposal._id)
                      .eq("sourceId", version.sourceId),
              )
              .unique()
        : null;
    const pinned = item ? await readPinnedSourceQualification(db, item) : null;
    const comparisonReview = item
        ? await readPinnedComparisonReview(db, item, pinned)
        : { outcomes: {}, details: {} };
    const qualified =
        revision?.status === "approved" &&
        proposal?.runId === version.runId &&
        proposal.corpusRevisionId === version.corpusRevisionId &&
        source?.runId === version.runId &&
        item?.runId === version.runId &&
        item.corpusRevisionId === version.corpusRevisionId &&
        pinned !== null &&
        pinned.sourceCaptureId === version.sourceCaptureId &&
        pinned.contentHash === version.contentHash;
    return {
        qualification: qualified ? pinned.qualification : null,
        qualificationTaskId: qualified ? pinned.qualificationTaskId : undefined,
        comparisonOutcomes: qualified ? comparisonReview.outcomes : {},
        comparisonDetails: qualified ? comparisonReview.details : {},
        sourceTitle: source?.title ?? "",
        roleAvailability: item?.roleAvailability ?? [],
    };
}

/** Constructs attribution from the preserved finding, never from caller-authored claim text. */
export function constructAttributedHypothesis(input: {
    qualification: SourceQualification;
    sourceTitle: string;
    role: SourceCoverageRole;
    findingIndex?: number;
    comparisonOutcomes?: Record<number, SourceComparisonDisposition>;
}) {
    const roleFindings = input.qualification.findings
        .map((finding, findingIndex) => ({ finding, findingIndex }))
        .filter(
            ({ finding }) =>
                finding.role === input.role &&
                ["attributed_argument", "forecast"].includes(finding.kind),
        );
    const eligible = roleFindings.filter(
        ({ finding, findingIndex }) =>
            !finding.dependsOnFlaggedAssertion &&
            sourceFindingUsage(
                finding,
                "attributed_argument_only",
                input.comparisonOutcomes?.[findingIndex],
            ) === "attributed_argument_only",
    );
    if (input.findingIndex === undefined && eligible.length > 1)
        throw new Error("Attributed finding selection is ambiguous");
    const selected =
        input.findingIndex === undefined
            ? eligible[0]
            : Number.isSafeInteger(input.findingIndex)
              ? eligible.find(
                    ({ findingIndex }) => findingIndex === input.findingIndex,
                )
              : undefined;
    if (input.qualification.companyMatch !== "subject")
        throw new Error("Independent attributed argument is unavailable");
    if (!selected) {
        if (
            roleFindings.some(
                ({ finding }) => !finding.dependsOnFlaggedAssertion,
            )
        )
            throw new Error("source_usage_restricted");
        throw new Error("Independent attributed argument is unavailable");
    }
    const passage = selected.finding.passages[0];
    if (!passage)
        throw new Error("Independent attributed argument is unavailable");
    const finding = selected.finding;
    const title = [...input.sourceTitle.replace(/\s+/g, " ").trim()]
        .slice(0, 200)
        .join("");
    const quotation = passage.quotation;
    const characters = [...quotation];
    const excerpt = characters.slice(0, 600).join("");
    const statement = `The source ${JSON.stringify(title)} presents this ${finding.kind === "forecast" ? "forecast" : "argument"}${characters.length > 600 ? " (excerpt)" : ""}: ${JSON.stringify(`${excerpt}${characters.length > 600 ? "…" : ""}`)}`;
    if (statement.length > MAX_CLAIM_STATEMENT_CHARS)
        throw new Error(
            "Attributed hypothesis exceeds the claim statement limit",
        );
    return {
        statement,
        classification: "Hypothesis" as const,
        passages: finding.passages,
    };
}

/** Applies the approved qualification to a cited passage without certifying its assertions. */
export function validatePreparedEvidenceUse(input: {
    qualification: SourceQualification | null;
    sourceTitle: string;
    roleAvailability: Array<Pick<SourceRoleAvailability, "role" | "usage">>;
    passage: Pick<Doc<"sourcePassages">, "order" | "exactQuotation">;
    statement: string;
    classification: ClaimClassification;
    relation: EvidenceRelation;
    comparisonOutcomes?: Record<number, SourceComparisonDisposition>;
}):
    | { allowed: true; strengthensFactualSupport: boolean }
    | { allowed: false; reasonCode: "source_usage_restricted" } {
    if (input.relation === "context")
        return { allowed: true, strengthensFactualSupport: false };
    const qualification = input.qualification;
    const passageKey = `p${input.passage.order}`;
    const findings =
        qualification?.findings.filter((finding) =>
            finding.passages.some(
                (reference) =>
                    reference.passageKey === passageKey &&
                    reference.quotation === input.passage.exactQuotation,
            ),
        ) ?? [];
    const flagged = qualification
        ? sourcePassagesRequireVerification(qualification.limitations, [
              { passageKey },
          ])
        : true;
    const usageFor = (finding: SourceQualification["findings"][number]) =>
        sourceFindingUsage(
            finding,
            input.roleAvailability.find(
                (availability) => availability.role === finding.role,
            )?.usage ?? "blocked",
            input.comparisonOutcomes?.[
                qualification?.findings.indexOf(finding) ?? -1
            ],
            qualification?.limitations,
        );
    const documentary =
        qualification?.companyMatch === "subject" &&
        findings.length > 0 &&
        !flagged &&
        findings.every((finding) => usageFor(finding) === "documentary");
    if (documentary)
        return {
            allowed: true,
            strengthensFactualSupport: input.relation === "supporting",
        };
    if (
        qualification?.companyMatch === "subject" &&
        input.classification === "Hypothesis" &&
        findings.every((finding) =>
            ["documentary", "attributed_argument_only"].includes(
                usageFor(finding),
            ),
        )
    ) {
        for (const finding of findings) {
            if (
                usageFor(finding) !== "attributed_argument_only" ||
                !["attributed_argument", "forecast"].includes(finding.kind)
            )
                continue;
            const constructed = constructAttributedHypothesis({
                qualification,
                sourceTitle: input.sourceTitle,
                role: finding.role,
                findingIndex: qualification.findings.indexOf(finding),
                comparisonOutcomes: input.comparisonOutcomes,
            });
            if (input.statement === constructed.statement)
                return { allowed: true, strengthensFactualSupport: false };
        }
    }
    return { allowed: false, reasonCode: "source_usage_restricted" };
}
