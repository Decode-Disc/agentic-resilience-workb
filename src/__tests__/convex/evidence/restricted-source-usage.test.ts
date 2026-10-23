import type { SourceQualification } from "@convex/domain/sourceQualification";
import {
    constructAttributedHypothesis,
    validatePreparedEvidenceUse,
} from "@convex/domain/sourceUsage";
import { expect, test } from "vitest";

const qualification: SourceQualification = {
    companyMatch: "subject",
    companyPassages: [
        {
            passageKey: "p0",
            quotation: "Bundled competitors could pressure workflow pricing.",
        },
    ],
    documentKind: "independent_analysis",
    reportingPeriodEnd: null,
    reportingPeriodPassages: [],
    findings: [
        {
            role: "counter_evidence_primary",
            kind: "attributed_argument",
            summary: "Bundled competitors could pressure workflow pricing.",
            passages: [
                {
                    passageKey: "p0",
                    quotation:
                        "Bundled competitors could pressure workflow pricing.",
                },
            ],
            period: "unspecified",
            periodPassages: [],
            dependsOnFlaggedAssertion: false,
        },
    ],
    limitations: [
        {
            code: "unverified_assertion",
            explanation: "An author argument, not a verified realized outcome.",
            passages: [],
        },
    ],
};
const source = { title: "Workflow competition analysis" };
const primaryComparisonQuote =
    "The annual report says the company competes with enterprise software providers that bundle workflow applications into broader subscriptions.";
const primaryComparisonUrl =
    "https://www.sec.gov/Archives/edgar/data/1373715/000137371526000005/annual-report.htm";
const reference = qualification.findings[0]?.passages[0];
if (!reference) throw new Error("Missing argument fixture reference");
const passage = { order: 0, exactQuotation: reference.quotation };

test("an unverified argument cannot support a factual or inferred claim, including a caller's attribution flag", () => {
    for (const classification of ["Fact", "Inference", "Hypothesis"] as const) {
        const result = validatePreparedEvidenceUse({
            qualification,
            sourceTitle: source.title,
            roleAvailability: [
                {
                    role: "counter_evidence_primary",
                    usage: "attributed_argument_only",
                },
            ],
            passage,
            statement: "Bundled competitors have reduced workflow pricing.",
            classification,
            relation: "supporting",
        });
        expect(result).toEqual({
            allowed: false,
            reasonCode: "source_usage_restricted",
        });
    }
});

test("only the constructed attributed hypothesis can use the independent argument", () => {
    const attributed = constructAttributedHypothesis({
        qualification,
        sourceTitle: source.title,
        role: "counter_evidence_primary",
        comparisonOutcomes: { 0: "no_conflict_observed" },
    });
    expect(attributed).toMatchObject({
        classification: "Hypothesis",
        statement:
            'The source "Workflow competition analysis" presents this argument: "Bundled competitors could pressure workflow pricing."',
    });
    expect(
        validatePreparedEvidenceUse({
            qualification,
            sourceTitle: source.title,
            roleAvailability: [
                {
                    role: "counter_evidence_primary",
                    usage: "attributed_argument_only",
                },
            ],
            comparisonOutcomes: { 0: "no_conflict_observed" },
            passage,
            statement: attributed.statement,
            classification: "Hypothesis",
            relation: "supporting",
        }),
    ).toEqual({ allowed: true, strengthensFactualSupport: false });
});

test("an argument dependent on a flagged premise cannot become an attributed hypothesis", () => {
    const dependent = {
        ...qualification,
        findings: qualification.findings.map((finding) => ({
            ...finding,
            dependsOnFlaggedAssertion: true,
        })),
    };
    expect(() =>
        constructAttributedHypothesis({
            qualification: dependent,
            sourceTitle: source.title,
            role: "counter_evidence_primary",
        }),
    ).toThrow("Independent attributed argument is unavailable");
});

test("two arguments for the same role require a precise finding selection", () => {
    const first = qualification.findings[0];
    if (!first) throw new Error("Missing argument fixture");
    const multiple: SourceQualification = {
        ...qualification,
        findings: [
            first,
            {
                ...first,
                kind: "forecast",
                passages: [
                    {
                        passageKey: "p1",
                        quotation:
                            "The company expects revenue growth next year.",
                    },
                ],
            },
        ],
    };
    expect(() =>
        constructAttributedHypothesis({
            qualification: multiple,
            sourceTitle: source.title,
            role: first.role,
            comparisonOutcomes: {
                0: "no_conflict_observed",
                1: "no_conflict_observed",
            },
        }),
    ).toThrow("Attributed finding selection is ambiguous");
    const attributed = constructAttributedHypothesis({
        qualification: multiple,
        sourceTitle: source.title,
        role: first.role,
        findingIndex: 1,
        comparisonOutcomes: {
            0: "no_conflict_observed",
            1: "no_conflict_observed",
        },
    });
    expect(attributed.statement).toBe(
        'The source "Workflow competition analysis" presents this forecast: "The company expects revenue growth next year."',
    );
    expect(
        validatePreparedEvidenceUse({
            qualification: multiple,
            sourceTitle: source.title,
            roleAvailability: [
                { role: first.role, usage: "attributed_argument_only" },
            ],
            comparisonOutcomes: {
                0: "no_conflict_observed",
                1: "no_conflict_observed",
            },
            passage: {
                order: 1,
                exactQuotation: "The company expects revenue growth next year.",
            },
            statement: attributed.statement,
            classification: "Hypothesis",
            relation: "supporting",
        }),
    ).toEqual({ allowed: true, strengthensFactualSupport: false });
});

test("unqualified content may explain an unknown but cannot support a fact", () => {
    const input = {
        qualification: null,
        sourceTitle: source.title,
        roleAvailability: [],
        passage,
        statement: "The current commercial terms are not established.",
        classification: "Unknown" as const,
        relation: "context" as const,
    };
    expect(validatePreparedEvidenceUse(input)).toEqual({
        allowed: true,
        strengthensFactualSupport: false,
    });
    expect(
        validatePreparedEvidenceUse({
            ...input,
            classification: "Fact",
            relation: "supporting",
        }),
    ).toEqual({ allowed: false, reasonCode: "source_usage_restricted" });
});

test("a role containing actual results cannot grant factual use to its forecasts or uncertain passages", () => {
    const kinds = [
        "reported_outcome",
        "forecast",
        "mixed_or_uncertain",
    ] as const;
    const grouped: SourceQualification = {
        ...qualification,
        documentKind: "investor_presentation",
        limitations: [],
        findings: kinds.map((kind, order) => ({
            role: "investor_presentation",
            kind,
            summary: "Contribution",
            passages: [
                {
                    passageKey: `p${order}`,
                    quotation:
                        [
                            "Q1 revenue grew 20%.",
                            "Q2 revenue is expected to grow 18%.",
                            "Revenue growth includes uncertain periods.",
                        ][order] ?? "",
                },
            ],
            period: "current",
            periodPassages: [],
            dependsOnFlaggedAssertion: false,
        })),
    };
    for (const [order, finding] of grouped.findings.entries()) {
        const result = validatePreparedEvidenceUse({
            qualification: grouped,
            sourceTitle: source.title,
            roleAvailability: [
                { role: "investor_presentation", usage: "documentary" },
            ],
            passage: {
                order,
                exactQuotation: finding.passages[0]?.quotation ?? "",
            },
            statement: "The company achieved 20% revenue growth.",
            classification: "Fact",
            relation: "supporting",
        });
        expect(result).toEqual(
            order === 0
                ? { allowed: true, strengthensFactualSupport: true }
                : { allowed: false, reasonCode: "source_usage_restricted" },
        );
    }
    const attributed = constructAttributedHypothesis({
        qualification: grouped,
        sourceTitle: source.title,
        role: "investor_presentation",
        comparisonOutcomes: {
            1: "no_conflict_observed",
        },
    });
    expect(
        validatePreparedEvidenceUse({
            qualification: grouped,
            sourceTitle: source.title,
            roleAvailability: [
                { role: "investor_presentation", usage: "blocked" },
            ],
            passage: {
                order: 1,
                exactQuotation: "Q2 revenue is expected to grow 18%.",
            },
            statement: attributed.statement,
            classification: "Hypothesis",
            relation: "supporting",
        }),
    ).toEqual({ allowed: false, reasonCode: "source_usage_restricted" });
});

import { api, internal } from "@convex/_generated/api";
import { seedInspectedEvidence } from "@/__tests__/setup/source-preparation";

test("approved version-two qualifications stay readable after the protocol upgrade", async () => {
    const { t, args, userId, sourceId } = await seedInspectedEvidence({
        qualification,
        text: passage.exactQuotation,
    });
    await t.run(async (ctx) => {
        const task = await ctx.db.query("aiTaskResults").first();
        if (!task) throw new Error("Missing approved qualification");
        await ctx.db.patch(task._id, {
            schemaVersion: "source-qualification-v2",
        });
    });
    const source = await t
        .withIdentity({ subject: userId })
        .query(api.sources.getReviewSource, {
            runId: args.runId,
            corpusRevisionId: args.corpusRevisionId,
            sourceId,
        });
    expect(source).toMatchObject({
        qualificationStatus: "available",
        qualification: { findings: [{ kind: "attributed_argument" }] },
    });
});

test("a clean comparison is unavailable when its primary source record is missing", async () => {
    const { t, args, userId } = await seedInspectedEvidence({
        qualification,
        text: passage.exactQuotation,
        comparison: true,
    });
    const primarySourceId = await t.run(async (ctx) => {
        const sources = await ctx.db
            .query("sources")
            .withIndex("by_run_and_url", (q) => q.eq("runId", args.runId))
            .collect();
        return sources.find((candidate) => candidate.origin === "sec")?._id;
    });
    if (!primarySourceId) throw new Error("Missing primary source fixture");
    await t.run((ctx) => ctx.db.delete(primarySourceId));

    const review = await t
        .withIdentity({ subject: userId })
        .query(api.sources.getReviewSource, {
            runId: args.runId,
            corpusRevisionId: args.corpusRevisionId,
            sourceId: args.sourceId,
        });
    expect(review?.qualification?.findings[0]?.usage).toBe(
        "verification_required",
    );
});

test("a comparison reference with a different content hash cannot reuse a valid capture check", async () => {
    const { t, args, userId } = await seedInspectedEvidence({
        qualification,
        text: passage.exactQuotation,
        comparison: true,
    });
    await t.run(async (ctx) => {
        const task = await ctx.db
            .query("aiTaskResults")
            .withIndex("by_run_and_task_type_and_input_hash", (q) =>
                q.eq("runId", args.runId).eq("taskType", "source_comparison"),
            )
            .first();
        if (task?.output.kind !== "source_comparison")
            throw new Error("Missing source comparison fixture");
        const finding = task.output.findings[0];
        const reference = finding?.primaryPassages[0];
        if (!finding || !reference)
            throw new Error("Missing primary passage reference");
        await ctx.db.patch(task._id, {
            output: {
                ...task.output,
                findings: [
                    {
                        ...finding,
                        primaryPassages: [
                            reference,
                            { ...reference, contentHash: "f".repeat(64) },
                        ],
                    },
                ],
            },
        });
    });

    const review = await t
        .withIdentity({ subject: userId })
        .query(api.sources.getReviewSource, {
            runId: args.runId,
            corpusRevisionId: args.corpusRevisionId,
            sourceId: args.sourceId,
        });
    expect(review?.qualification?.findings[0]?.usage).toBe(
        "verification_required",
    );
});

test("a clean comparison requires the primary capture's stored bytes", async () => {
    const { t, args, userId } = await seedInspectedEvidence({
        qualification,
        text: passage.exactQuotation,
        comparison: true,
    });
    await t.run(async (ctx) => {
        const sources = await ctx.db
            .query("sources")
            .withIndex("by_run_and_url", (q) => q.eq("runId", args.runId))
            .collect();
        const primary = sources.find((candidate) => candidate.origin === "sec");
        if (!primary) throw new Error("Missing primary source fixture");
        const capture = await ctx.db
            .query("sourceCaptures")
            .withIndex("by_source_and_status_and_updated_at", (q) =>
                q.eq("sourceId", primary._id).eq("status", "committed"),
            )
            .first();
        if (!capture?.storageId)
            throw new Error("Missing primary capture storage fixture");
        await ctx.storage.delete(capture.storageId);
    });

    const review = await t
        .withIdentity({ subject: userId })
        .query(api.sources.getReviewSource, {
            runId: args.runId,
            corpusRevisionId: args.corpusRevisionId,
            sourceId: args.sourceId,
        });
    expect(review?.qualification?.findings[0]?.usage).toBe(
        "verification_required",
    );
});

test("a rejected primary remains rejected when its review projection is missing", async () => {
    const { t, args, userId } = await seedInspectedEvidence({
        qualification,
        text: passage.exactQuotation,
        comparison: true,
    });
    const primarySourceId = await t.run(async (ctx) => {
        const sources = await ctx.db
            .query("sources")
            .withIndex("by_run_and_url", (q) => q.eq("runId", args.runId))
            .collect();
        return sources.find((candidate) => candidate.origin === "sec")?._id;
    });
    if (!primarySourceId) throw new Error("Missing primary source fixture");
    await t.run(async (ctx) => {
        await ctx.db.insert("sourceDecisions", {
            runId: args.runId,
            corpusRevisionId: args.corpusRevisionId,
            sourceId: primarySourceId,
            decisionKey: "reject-primary-comparison-context",
            decision: "rejected",
            reason: "The captured filing was rejected for this corpus",
            occurredAt: Date.now() + 1,
        });
        const reviewItem = await ctx.db
            .query("sourceReviewItems")
            .withIndex("by_revision_and_source", (q) =>
                q
                    .eq("corpusRevisionId", args.corpusRevisionId)
                    .eq("sourceId", primarySourceId),
            )
            .unique();
        if (!reviewItem) throw new Error("Missing primary review fixture");
        await ctx.db.delete(reviewItem._id);
    });

    const review = await t
        .withIdentity({ subject: userId })
        .query(api.sources.getReviewSource, {
            runId: args.runId,
            corpusRevisionId: args.corpusRevisionId,
            sourceId: args.sourceId,
        });
    expect(review?.qualification?.findings[0]?.usage).toBe(
        "verification_required",
    );
});

test("a new corpus proposal uses its own primary decisions from its first read", async () => {
    const { t, args, userId } = await seedInspectedEvidence({
        qualification,
        text: passage.exactQuotation,
        comparison: true,
    });
    await t.run(async (ctx) => {
        const primary = (
            await ctx.db
                .query("sources")
                .withIndex("by_run_and_url", (q) => q.eq("runId", args.runId))
                .take(3)
        ).find((source) => source.origin === "sec");
        if (!primary) throw new Error("Missing primary");
        const item = await ctx.db
            .query("sourceReviewItems")
            .withIndex("by_revision_and_source", (q) =>
                q
                    .eq("corpusRevisionId", args.corpusRevisionId)
                    .eq("sourceId", primary._id),
            )
            .unique();
        if (!item) throw new Error("Missing primary decision");
        const decisionId = await ctx.db.insert("sourceDecisions", {
            runId: args.runId,
            corpusRevisionId: args.corpusRevisionId,
            sourceId: primary._id,
            decision: "rejected",
            decisionKey: "historical-primary-rejection",
            supersedesDecisionId: item.latestDecisionId,
            occurredAt: Date.now() + 1,
        });
        await ctx.db.patch(item._id, {
            decision: "rejected",
            latestDecisionId: decisionId,
        });
        await ctx.db.patch(args.runId, {
            lifecycleState: "corpus_approved",
            executionStatus: "idle",
        });
    });
    const owner = t.withIdentity({ subject: userId });
    const next = await owner.mutation(
        api.sourceSelectionProposals.startNewCorpusRevision,
        { runId: args.runId, corpusRevisionId: args.corpusRevisionId },
    );
    expect(
        await owner.query(api.sourceSelectionProposals.getCurrent, {
            runId: args.runId,
            corpusRevisionId: next.corpusRevisionId,
        }),
    ).toMatchObject({ effectiveStatus: "ready" });
    const review = await owner.query(api.sources.getReviewSource, {
        runId: args.runId,
        corpusRevisionId: next.corpusRevisionId,
        sourceId: args.sourceId,
    });
    expect(review?.qualification?.findings[0]?.comparisonOutcome).toBe(
        "no_conflict_observed",
    );
});

test("the owned source reader exposes separate uses for findings sharing a documentary role", async () => {
    const first = qualification.findings[0];
    if (!first) throw new Error("Missing contribution fixture");
    const { t, args, userId, sourceId } = await seedInspectedEvidence({
        qualification: {
            ...qualification,
            limitations: [],
            findings: [
                {
                    ...first,
                    role: "investor_presentation",
                    kind: "reported_outcome",
                },
                { ...first, role: "investor_presentation", kind: "forecast" },
            ],
        },
        text: passage.exactQuotation,
        comparison: true,
    });
    await t.run(async (ctx) => {
        const revision = await ctx.db.get(args.corpusRevisionId);
        const proposalId = revision?.sourceSelectionProposalId;
        if (!proposalId) throw new Error("Missing prepared proposal");
        const item = await ctx.db
            .query("sourceSelectionProposalItems")
            .withIndex("by_proposal_and_source", (q) =>
                q.eq("proposalId", proposalId).eq("sourceId", sourceId),
            )
            .unique();
        if (!item) throw new Error("Missing approved proposal item");
        await ctx.db.patch(item._id, {
            roleAvailability: [
                {
                    role: "investor_presentation",
                    state: "available",
                    usage: "documentary",
                    reasonCodes: [],
                },
            ],
        });
    });
    const result = await t
        .withIdentity({ subject: userId })
        .query(api.sources.getReviewSource, {
            runId: args.runId,
            corpusRevisionId: args.corpusRevisionId,
            sourceId,
        });
    expect(result?.qualification?.findings).toMatchObject([
        {
            kind: "reported_outcome",
            usage: "documentary",
            findingKey: expect.any(String),
        },
        {
            kind: "forecast",
            usage: "attributed_argument_only",
            comparisonOutcome: "no_conflict_observed",
            findingKey: expect.any(String),
        },
    ]);
    expect(
        result?.qualification?.findings.find(
            (finding) => finding.kind === "forecast",
        )?.comparisonDetails,
    ).toEqual({
        explanation:
            "The cited primary passage is comparable within the stated scope.",
        primaryPassages: [
            {
                title: "Annual report context",
                canonicalUrl: primaryComparisonUrl,
                quotation: primaryComparisonQuote,
            },
        ],
    });
    expect(
        new Set(
            result?.qualification?.findings.map(
                (finding) => finding.findingKey,
            ),
        ).size,
    ).toBe(2);
});

test("the real evidence policy blocks a factual claim supported by an approved unverified argument", async () => {
    const { t, args } = await seedInspectedEvidence({
        qualification,
        text: passage.exactQuotation,
    });
    const materialized = await t.action(
        internal.evidenceActions.retrieveAndNormalizeExaSource,
        args,
    );
    expect(materialized.status).toBe("succeeded");
    const claimId = await t.run(async (ctx) => {
        const task = await ctx.db.query("aiTaskResults").first();
        const sourcePassage = await ctx.db.query("sourcePassages").first();
        if (!task || !sourcePassage)
            throw new Error("Missing qualified fixture");
        const claimId = await ctx.db.insert("claims", {
            runId: args.runId,
            corpusRevisionId: args.corpusRevisionId,
            statement: "Bundled competitors have reduced workflow pricing.",
            canonicalText: "bundled competitors have reduced workflow pricing",
            classification: "Fact",
            proposingTaskId: task._id,
            schemaVersion: "test-claim-v1",
            createdAt: Date.now(),
        });
        await ctx.db.insert("claimEvidence", {
            claimId,
            sourcePassageId: sourcePassage._id,
            relation: "supporting",
            proposingTaskId: task._id,
            createdAt: Date.now(),
        });
        return claimId;
    });
    await t.action(internal.policyEvaluations.evaluatePolicyForRun, {
        runId: args.runId,
        executionGeneration: args.executionGeneration,
    });
    const evaluation = await t.run((ctx) =>
        ctx.db
            .query("policyEvaluations")
            .withIndex("by_claim", (q) => q.eq("claimId", claimId))
            .first(),
    );
    expect(evaluation).toMatchObject({
        result: "blocked",
        structuralResult: {
            status: "blocked",
            ruleId: "structural.source_usage_restricted",
        },
    });
    expect(evaluation?.normalizedInputs.supportingSourceIds).toEqual([]);
});

test("an attributed hypothesis is constructed from approved records and remains outside factual corroboration", async () => {
    const { t, args } = await seedInspectedEvidence({
        qualification,
        text: passage.exactQuotation,
        comparison: true,
    });
    await t.action(
        internal.evidenceActions.retrieveAndNormalizeExaSource,
        args,
    );
    const claimId = await t.mutation(
        internal.claimGeneration.proposeAttributedHypothesis,
        { ...args, role: "counter_evidence_primary" },
    );
    const replay = await t.mutation(
        internal.claimGeneration.proposeAttributedHypothesis,
        { ...args, role: "counter_evidence_primary" },
    );
    expect(replay).toBe(claimId);
    const claim = await t.run((ctx) => ctx.db.get(claimId));
    expect(claim).toMatchObject({
        classification: "Hypothesis",
        statement: expect.stringContaining(
            'The source "Workflow products" presents this argument:',
        ),
    });
    await t.action(internal.policyEvaluations.evaluatePolicyForRun, {
        runId: args.runId,
        executionGeneration: args.executionGeneration,
    });
    const evaluation = await t.run((ctx) =>
        ctx.db
            .query("policyEvaluations")
            .withIndex("by_claim", (q) => q.eq("claimId", claimId))
            .first(),
    );
    expect(evaluation?.structuralResult).toEqual({ status: "valid" });
    expect(evaluation?.normalizedInputs.supportingSourceIds).toEqual([]);
    expect(
        evaluation?.rules.find((rule) => rule.ruleId === "policy.authority")
            ?.outcome,
    ).toBe("needs_review");
});

test("an approved attributed finding without an applicable comparison cannot create a hypothesis", async () => {
    const { t, args } = await seedInspectedEvidence({
        qualification,
        text: passage.exactQuotation,
    });
    await t.action(
        internal.evidenceActions.retrieveAndNormalizeExaSource,
        args,
    );

    await expect(
        t.mutation(internal.claimGeneration.proposeAttributedHypothesis, {
            ...args,
            role: "counter_evidence_primary",
        }),
    ).rejects.toThrow("source_usage_restricted");
    expect(await t.run((ctx) => ctx.db.query("claims").collect())).toHaveLength(
        0,
    );
});

test("a possible conflict remains visible when the same captured passage is requalified as a factual result", async () => {
    const { t, userId, args, sourceId, corpusRevisionId, captureId } =
        await seedInspectedEvidence({
            qualification,
            text: passage.exactQuotation,
            comparison: true,
        });
    await t.run(async (ctx) => {
        const comparisonTask = await ctx.db
            .query("aiTaskResults")
            .withIndex("by_run_and_task_type_and_input_hash", (q) =>
                q.eq("runId", args.runId).eq("taskType", "source_comparison"),
            )
            .first();
        const originalTask = await ctx.db
            .query("aiTaskResults")
            .withIndex("by_run_and_task_type_and_input_hash", (q) =>
                q
                    .eq("runId", args.runId)
                    .eq("taskType", "source_qualification"),
            )
            .first();
        const revision = await ctx.db.get(corpusRevisionId);
        if (
            comparisonTask?.output.kind !== "source_comparison" ||
            !originalTask ||
            originalTask.output.kind !== "source_qualification" ||
            !revision?.sourceSelectionProposalId
        )
            throw new Error("Missing source comparison fixture");
        await ctx.db.patch(comparisonTask._id, {
            output: {
                ...comparisonTask.output,
                findings: comparisonTask.output.findings.map((finding) => ({
                    ...finding,
                    disposition: "possible_conflict" as const,
                })),
            },
        });
        const requalifiedId = await ctx.db.insert("aiTaskResults", {
            runId: args.runId,
            corpusRevisionId,
            sourceId,
            sourceCaptureId: captureId,
            taskType: "source_qualification",
            executionMode: "live",
            schemaVersion: originalTask.schemaVersion,
            adapterVersion: "requalification-fixture",
            inputHash: "a".repeat(64),
            output: {
                ...originalTask.output,
                qualification: {
                    ...qualification,
                    findings: qualification.findings.map((finding) => ({
                        ...finding,
                        kind: "asserted_fact" as const,
                    })),
                },
            },
            createdAt: Date.now() + 1,
        });
        const proposalId = revision.sourceSelectionProposalId;
        if (!proposalId) throw new Error("Missing prepared proposal");
        const item = await ctx.db
            .query("sourceSelectionProposalItems")
            .withIndex("by_proposal_and_source", (q) =>
                q.eq("proposalId", proposalId).eq("sourceId", sourceId),
            )
            .unique();
        if (!item) throw new Error("Missing proposal item");
        await ctx.db.patch(item._id, { qualificationTaskId: requalifiedId });
    });

    const review = await t
        .withIdentity({ subject: userId })
        .query(api.sources.getReviewSource, {
            runId: args.runId,
            corpusRevisionId,
            sourceId,
        });
    expect(review?.qualification?.findings[0]).toMatchObject({
        kind: "asserted_fact",
        usage: "verification_required",
        comparisonOutcome: "possible_conflict",
        comparisonDetails: {
            explanation:
                "The cited primary passage is comparable within the stated scope.",
            primaryPassages: [
                {
                    title: "Annual report context",
                    canonicalUrl: primaryComparisonUrl,
                    quotation: primaryComparisonQuote,
                },
            ],
        },
    });
});

test("hypothesis persistence respects the approved finding's usage restriction", async () => {
    const { t, args } = await seedInspectedEvidence({
        qualification,
        text: passage.exactQuotation,
    });
    await t.action(
        internal.evidenceActions.retrieveAndNormalizeExaSource,
        args,
    );
    await t.run(async (ctx) => {
        const item = await ctx.db.query("sourceSelectionProposalItems").first();
        if (!item) throw new Error("Missing approved proposal item");
        await ctx.db.patch(item._id, {
            roleAvailability: [
                {
                    role: "counter_evidence_primary",
                    state: "not_established",
                    usage: "blocked",
                    reasonCodes: ["test_restriction"],
                },
            ],
        });
    });
    await expect(
        t.mutation(internal.claimGeneration.proposeAttributedHypothesis, {
            ...args,
            role: "counter_evidence_primary",
        }),
    ).rejects.toThrow("source_usage_restricted");
    expect(await t.run((ctx) => ctx.db.query("claims").collect())).toHaveLength(
        0,
    );
});

test("precise hypothesis creation selects the second finding and replays without duplicate claims", async () => {
    const first = qualification.findings[0];
    if (!first) throw new Error("Missing argument fixture");
    const forecast = "The company expects revenue growth next year.";
    const text = `${passage.exactQuotation}\n\n${forecast}`;
    const { t, args } = await seedInspectedEvidence({
        text,
        comparison: true,
        qualification: {
            ...qualification,
            findings: [
                first,
                {
                    ...first,
                    kind: "forecast",
                    passages: [{ passageKey: "p1", quotation: forecast }],
                },
            ],
        },
    });
    await t.run(async (ctx) => {
        const task = await ctx.db.query("aiTaskResults").first();
        if (task?.output.kind !== "source_qualification")
            throw new Error("Missing captured qualification");
        await ctx.db.patch(task._id, {
            output: {
                ...task.output,
                selectedPassages: [
                    {
                        passageKey: "p0",
                        startOffset: 0,
                        endOffset: passage.exactQuotation.length,
                    },
                    {
                        passageKey: "p1",
                        startOffset: passage.exactQuotation.length + 2,
                        endOffset: text.length,
                    },
                ],
            },
        });
    });
    await t.action(
        internal.evidenceActions.retrieveAndNormalizeExaSource,
        args,
    );
    await expect(
        t.mutation(internal.claimGeneration.proposeAttributedHypothesis, {
            ...args,
            role: "counter_evidence_primary",
        }),
    ).rejects.toThrow("Attributed finding selection is ambiguous");
    const selected = {
        ...args,
        role: "counter_evidence_primary" as const,
        findingIndex: 1,
    };
    const id = await t.mutation(
        internal.claimGeneration.proposeAttributedHypothesis,
        selected,
    );
    expect(
        await t.mutation(
            internal.claimGeneration.proposeAttributedHypothesis,
            selected,
        ),
    ).toBe(id);
    expect(await t.run((ctx) => ctx.db.get(id))).toMatchObject({
        statement:
            'The source "Workflow products" presents this forecast: "The company expects revenue growth next year."',
    });
    expect(await t.run((ctx) => ctx.db.query("claims").collect())).toHaveLength(
        1,
    );
});

import {
    CLAIM_SCHEMA_VERSION,
    clearShowcaseManifests,
    registerShowcaseManifest,
    SHOWCASE_ADAPTER_VERSION,
    SHOWCASE_FIXTURE_VERSION,
} from "@convex/domain/showcaseManifest";
import { afterEach } from "vitest";

afterEach(() => clearShowcaseManifests());

test("claim persistence rejects a fixture that promotes an unverified argument to fact", async () => {
    const { t, args } = await seedInspectedEvidence({
        qualification,
        text: passage.exactQuotation,
    });
    await t.action(
        internal.evidenceActions.retrieveAndNormalizeExaSource,
        args,
    );
    const input = await t.query(
        internal.claimGeneration.getNormalizedClaimInput,
        { runId: args.runId, executionGeneration: args.executionGeneration },
    );
    if (!input?.normalizedInput.passages[0])
        throw new Error("Missing claim fixture input");
    const reference = input.normalizedInput.passages[0];
    registerShowcaseManifest({
        fixtureId: "restricted-argument-fact",
        fixtureVersion: SHOWCASE_FIXTURE_VERSION,
        schemaVersion: CLAIM_SCHEMA_VERSION,
        adapterVersion: SHOWCASE_ADAPTER_VERSION,
        inputHash: input.inputHash,
        claims: [
            {
                statement: "Bundled competitors have reduced workflow pricing.",
                classification: "Fact",
                evidence: [
                    {
                        quotationHash: reference.quotationHash,
                        passageKey: reference.passageKey,
                        sourceVersionHash: reference.sourceVersionHash,
                        relation: "supporting",
                    },
                ],
                dimensionLinks: [],
            },
        ],
    });
    await expect(
        t.mutation(internal.claimGeneration.generateClaimsForRun, {
            runId: args.runId,
            executionGeneration: args.executionGeneration,
        }),
    ).rejects.toThrow("source_usage_restricted");
    expect(await t.run((ctx) => ctx.db.query("claims").collect())).toHaveLength(
        0,
    );
});

test("the same attributed passage under two documentary roles proposes one hypothesis", async () => {
    const finding = qualification.findings[0];
    if (!finding) throw new Error("Missing fixture argument");
    const { t, args } = await seedInspectedEvidence({
        comparison: true,
        qualification: {
            ...qualification,
            findings: [
                finding,
                { ...finding, role: "counter_evidence_secondary" },
            ],
        },
        text: passage.exactQuotation,
    });
    await t.action(
        internal.evidenceActions.retrieveAndNormalizeExaSource,
        args,
    );
    const first = await t.mutation(
        internal.claimGeneration.proposeAttributedHypothesis,
        { ...args, role: "counter_evidence_primary" },
    );
    expect(
        await t.mutation(internal.claimGeneration.proposeAttributedHypothesis, {
            ...args,
            role: "counter_evidence_secondary",
        }),
    ).toBe(first);
    expect(await t.run((ctx) => ctx.db.query("claims").collect())).toHaveLength(
        1,
    );
});
