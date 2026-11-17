import { internal } from "@convex/_generated/api";
import { sha256Hex } from "@convex/domain/sourcePassages";
import { afterEach, expect, test, vi } from "vitest";
import { seedInspectedEvidence } from "@/__tests__/setup/source-preparation";

afterEach(() => vi.unstubAllGlobals());

test("comparison-only primary evidence survives materialization and reaches analytical input", async () => {
    const targetText =
        "Bundled applications may constrain independent workflow vendors.";
    const quotation =
        "The annual report describes bundled workflow applications and competitive constraints.";
    const primaryText = [
        ...Array.from(
            { length: 600 },
            (_, i) =>
                `Disclosure ${i}. ${"Detailed operating context. ".repeat(170)}`,
        ),
        "# Competition",
        quotation,
    ].join("\n\n");
    const fixture = await seedInspectedEvidence({
        text: targetText,
        comparison: true,
        qualification: {
            companyMatch: "subject",
            companyPassages: [],
            documentKind: "independent_analysis",
            reportingPeriodEnd: null,
            reportingPeriodPassages: [],
            limitations: [],
            findings: [
                {
                    role: "counter_evidence_primary",
                    kind: "attributed_argument",
                    summary: targetText,
                    passages: [{ passageKey: "p0", quotation: targetText }],
                    period: "unspecified",
                    periodPassages: [],
                    dependsOnFlaggedAssertion: false,
                },
            ],
        },
    });
    const { t, args } = fixture;
    const primaryArgs = await t.run(async (ctx) => {
        const task = await ctx.db
            .query("aiTaskResults")
            .filter((q) => q.eq(q.field("taskType"), "source_comparison"))
            .first();
        if (task?.output.kind !== "source_comparison")
            throw new Error("Missing comparison");
        const reference = task.output.findings[0]?.primaryPassages[0];
        if (!reference) throw new Error("Missing primary reference");
        const captureId = ctx.db.normalizeId(
            "sourceCaptures",
            reference.captureId,
        );
        const sourceId = ctx.db.normalizeId("sources", reference.sourceId);
        if (!captureId || !sourceId)
            throw new Error("Invalid fixture identity");
        const contentHash = sha256Hex(primaryText);
        await ctx.db.patch(captureId, {
            storageId: await ctx.storage.store(new Blob([primaryText])),
            byteCount: new TextEncoder().encode(primaryText).length,
            contentHash,
        });
        await ctx.db.patch(task._id, {
            output: {
                ...task.output,
                findings: task.output.findings.map((f) => ({
                    ...f,
                    primaryPassages: [
                        {
                            ...reference,
                            contentHash,
                            quotation,
                            startOffset: primaryText.indexOf(quotation),
                            endOffset: primaryText.length,
                        },
                    ],
                })),
            },
        });
        const head = await ctx.db
            .query("sourceReviewItems")
            .withIndex("by_revision_and_source", (q) =>
                q
                    .eq("corpusRevisionId", args.corpusRevisionId)
                    .eq("sourceId", sourceId),
            )
            .unique();
        if (!head) throw new Error("Missing primary review");
        const acceptedDecisionId = await ctx.db.insert("sourceDecisions", {
            runId: args.runId,
            corpusRevisionId: args.corpusRevisionId,
            sourceId,
            decisionKey: "accepted-primary-fixture",
            decision: "accepted",
            occurredAt: Date.now(),
        });
        await ctx.db.patch(head._id, {
            decision: "accepted",
            latestDecisionId: acceptedDecisionId,
        });
        await ctx.db.insert("evidenceSourceStatuses", {
            ...args,
            sourceId,
            acceptedDecisionId,
            status: "queued",
            requestKey: "primary-evidence",
            createdAt: Date.now(),
            updatedAt: Date.now(),
        });
        return { ...args, sourceId, acceptedDecisionId };
    });
    vi.stubGlobal(
        "fetch",
        vi.fn(() => {
            throw new Error("Unexpected provider call");
        }),
    );
    expect(
        await t.action(
            internal.evidenceActions.retrieveAndNormalizeExaSource,
            args,
        ),
    ).toMatchObject({ status: "succeeded" });
    expect(
        await t.action(
            internal.evidenceActions.retrieveAndNormalizeSecSource,
            primaryArgs,
        ),
    ).toMatchObject({ status: "succeeded" });
    const input = await t.query(
        internal.claimGeneration.getNormalizedClaimInput,
        { runId: args.runId, executionGeneration: args.executionGeneration },
    );
    expect(
        input?.normalizedInput.passages.find(
            (p) => p.exactQuotation === quotation,
        ),
    ).toMatchObject({
        sourceId: primaryArgs.sourceId,
        sourceVersionHash: sha256Hex(primaryText),
        exactQuotation: quotation,
        locator: expect.objectContaining({
            startOffset: primaryText.indexOf(quotation),
            endOffset: primaryText.length,
        }),
    });
});

test("materializes the approved inspected bytes once without retrieval or disposable upload leases", async () => {
    const { t, args, captureId, text } = await seedInspectedEvidence();
    const fetch = vi.fn(() => {
        throw new Error("Unexpected provider call");
    });
    vi.stubGlobal("fetch", fetch);
    const first = await t.action(
        internal.evidenceActions.retrieveAndNormalizeExaSource,
        args,
    );
    const second = await t.action(
        internal.evidenceActions.retrieveAndNormalizeExaSource,
        args,
    );
    expect(first.status).toBe("succeeded");
    expect(second).toMatchObject({
        sourceVersionId: first.sourceVersionId,
        reused: true,
    });
    const artifacts = await t.run(async (ctx) => ({
        capture: await ctx.db.get(captureId),
        versions: await ctx.db.query("sourceVersions").collect(),
        passages: await ctx.db.query("sourcePassages").collect(),
        leases: await ctx.db.query("artifactUploadLeases").collect(),
    }));
    expect(artifacts.versions).toHaveLength(1);
    expect(artifacts.versions[0]).toMatchObject({
        storageId: artifacts.capture?.storageId,
        contentHash: sha256Hex(text),
        acceptedDecisionId: args.acceptedDecisionId,
    });
    expect(artifacts.passages.length).toBeGreaterThan(0);
    expect(artifacts.leases).toHaveLength(0);
    expect(fetch).not.toHaveBeenCalled();
});

test.each([
    "missing",
    "corrupt",
    "missing_pin",
    "missing_proposal",
] as const)("reports a %s approved capture without fetching replacement content", async (mode) => {
    const { t, args, captureId } = await seedInspectedEvidence();
    await t.run(async (ctx) => {
        const capture = await ctx.db.get(captureId);
        if (!capture?.storageId) throw new Error("Missing fixture storage");
        if (mode === "missing") await ctx.storage.delete(capture.storageId);
        else if (mode === "corrupt")
            await ctx.db.patch(captureId, {
                contentHash: sha256Hex("different bytes"),
            });
        else if (mode === "missing_proposal")
            await ctx.db.patch(args.corpusRevisionId, {
                sourceSelectionProposalId: undefined,
            });
        else {
            const item = await ctx.db
                .query("sourceSelectionProposalItems")
                .first();
            if (!item) throw new Error("Missing fixture proposal item");
            await ctx.db.patch(item._id, { sourceCaptureId: undefined });
        }
    });
    const fetch = vi.fn(() => {
        throw new Error("Unexpected provider call");
    });
    vi.stubGlobal("fetch", fetch);
    const result = await t.action(
        internal.evidenceActions.retrieveAndNormalizeExaSource,
        args,
    );
    expect(result).toMatchObject({
        status: "failed",
        failureReason:
            mode === "corrupt" ? "capture_corrupt" : "capture_unavailable",
    });
    expect(fetch).not.toHaveBeenCalled();
    expect(
        await t.run((ctx) => ctx.db.query("sourceVersions").collect()),
    ).toHaveLength(0);
});

test("accepted source decisions cannot materialize a capture before corpus approval", async () => {
    const { t, args } = await seedInspectedEvidence();
    await t.run((ctx) =>
        ctx.db.patch(args.corpusRevisionId, {
            status: "draft",
            approvedAt: undefined,
            approvedByVisitorId: undefined,
        }),
    );
    const fetch = vi.fn(() => {
        throw new Error("Unexpected provider call");
    });
    vi.stubGlobal("fetch", fetch);
    expect(
        await t.action(
            internal.evidenceActions.retrieveAndNormalizeExaSource,
            args,
        ),
    ).toMatchObject({ status: "failed" });
    expect(
        await t.run((ctx) => ctx.db.query("sourceVersions").collect()),
    ).toHaveLength(0);
    expect(fetch).not.toHaveBeenCalled();
});

test.each([
    true,
    false,
])("approval preserves late qualification references with versioned retrieval=%s", async (versioned) => {
    const quotation =
        "The approved late evidence establishes subscription revenue and its fiscal period.";
    const text = [
        ...Array.from(
            { length: 600 },
            (_, i) =>
                `Disclosure ${i}. ${"Detailed financial context. ".repeat(170)}`,
        ),
        "# Revenue",
        quotation,
    ].join("\n\n");
    const qualification = {
        companyMatch: "subject" as const,
        companyPassages: [{ passageKey: "p0", quotation }],
        documentKind: "official_product_documentation" as const,
        reportingPeriodEnd: null,
        reportingPeriodPassages: [],
        findings: [],
        limitations: [],
    };
    const { t, args } = await seedInspectedEvidence({ text, qualification });
    await t.run(async (ctx) => {
        const task = await ctx.db
            .query("aiTaskResults")
            .filter((q) => q.eq(q.field("taskType"), "source_qualification"))
            .first();
        if (task?.output.kind !== "source_qualification")
            throw new Error("Missing qualification fixture");
        const startOffset = text.indexOf(quotation);
        await ctx.db.patch(task._id, {
            output: {
                ...task.output,
                retrieval: versioned
                    ? {
                          version: "structured-v1",
                          requestedMode: "lexical",
                          effectiveMode: "lexical",
                          selectedPassageKeys: ["p0"],
                          omittedCandidateCount: 600,
                      }
                    : undefined,
                selectedPassages: [
                    {
                        passageKey: "p0",
                        startOffset,
                        endOffset: startOffset + quotation.length,
                    },
                ],
            },
        });
    });
    await t.action(
        internal.evidenceActions.retrieveAndNormalizeExaSource,
        args,
    );
    const passages = await t.run((ctx) =>
        ctx.db.query("sourcePassages").collect(),
    );
    expect(passages.some((p) => p.exactQuotation.includes(quotation))).toBe(
        true,
    );
    expect(passages.length).toBeLessThanOrEqual(512);
    const required = passages.find((p) => p.exactQuotation.includes(quotation));
    if (!required) throw new Error("Missing required fixture passage");
    await t.run((ctx) => ctx.db.delete(required._id));
    await expect(
        t.action(internal.evidenceActions.retrieveAndNormalizeExaSource, args),
    ).rejects.toThrow("existing_materialization_incomplete");
});
