import { api } from "@convex/_generated/api";
import { SOURCE_COVERAGE_ROLES } from "@convex/domain/sourceSelectionPolicy";
import { workflow } from "@convex/workflow";
import type { WorkflowId } from "@convex-dev/workflow";
import "@convex/researchLaunch";
import "@convex/researchWorkflow";
import "@convex/evidenceWorkflow";
import "@convex/sourcePreparationWorkflow";
import type { Id } from "@convex/_generated/dataModel";
import schema from "@convex/schema";
import "@convex/evidenceActions";
import "@convex/sourcePreparationActions";
import { makeFunctionReference } from "convex/server";
import { convexTest } from "convex-test";
import { afterEach, expect, test, vi } from "vitest";
import { serializeFakeStorageWrites } from "@/__tests__/setup/convex-storage";
import rateLimiterTest from "../integrations/rate-limiter-test-register.js";
import workflowTest from "./workflow-test-register.js";

const { exaSearch } = vi.hoisted(() => ({
    exaSearch: vi.fn(),
}));

vi.mock("exa-js", () => ({
    default: class MockExa {
        search(...args: unknown[]) {
            return exaSearch(...args);
        }
    },
}));

vi.mock("node:dns/promises", async (importOriginal) => {
    const actual = await importOriginal<typeof import("node:dns/promises")>();
    const lookupMock = vi.fn(async () => [
        { address: "93.184.216.34", family: 4 },
    ]);
    return {
        ...actual,
        default: {
            ...((actual as any).default ?? {}),
            lookup: lookupMock,
        },
        lookup: lookupMock,
    };
});

vi.mock("@convex/sourceActions", async (importOriginal) => ({
    ...(await importOriginal<typeof import("@convex/sourceActions")>()),
    requestPinnedPublicSource: vi.fn(async (url, _address, options) =>
        globalThis.fetch(url, {
            headers: options?.headers,
            signal: options?.signal,
        }),
    ),
}));

const modules = import.meta.glob("/convex/**/*.ts");
const originalFetch = globalThis.fetch;
const originalSecUserAgent = process.env.SEC_USER_AGENT;
const originalExaApiKey = process.env.EXA_API_KEY;

afterEach(() => {
    vi.restoreAllMocks();
    exaSearch.mockReset();
    globalThis.fetch = originalFetch;
    if (originalSecUserAgent === undefined) {
        delete process.env.SEC_USER_AGENT;
    } else {
        process.env.SEC_USER_AGENT = originalSecUserAgent;
    }
    if (originalExaApiKey === undefined) {
        delete process.env.EXA_API_KEY;
    } else {
        process.env.EXA_API_KEY = originalExaApiKey;
    }
    vi.unstubAllEnvs();
    vi.useRealTimers();
});
const confirmAndStart = makeFunctionReference<
    "action",
    {
        preflightId: Id<"companyPreflights">;
        idempotencyKey: string;
        coveragePreset: "balanced";
    },
    { runId: Id<"researchRuns">; remainingAnalyses: number }
>("researchLaunch:confirmAndStart");
const decideSource = makeFunctionReference<
    "mutation",
    {
        runId: Id<"researchRuns">;
        corpusRevisionId: Id<"corpusRevisions">;
        sourceId: Id<"sources">;
        decision: "accepted";
        decisionKey: string;
    },
    { accepted: boolean }
>("sources:decide");
const approveCorpus = makeFunctionReference<
    "mutation",
    {
        runId: Id<"researchRuns">;
        corpusRevisionId: Id<"corpusRevisions">;
        proposalId: Id<"sourceSelectionProposals">;
        proposalVersion: number;
        decisionKey: string;
    },
    { accepted: boolean }
>("sourceSelectionProposals:approveProposedCorpus");
const getRun = makeFunctionReference<
    "query",
    { runId: Id<"researchRuns"> },
    unknown
>("researchRuns:get");
const listEvents = makeFunctionReference<
    "query",
    { runId: Id<"researchRuns"> },
    Array<{ lifecycleState: string }>
>("researchRuns:listEvents");

test.each([
    { prepareSources: false, cancelDuringReading: false },
    { prepareSources: true, cancelDuringReading: false },
    { prepareSources: true, cancelDuringReading: true },
])("discovery preserves approval authority with preparation=$prepareSources cancellation=$cancelDuringReading", async ({
    prepareSources,
    cancelDuringReading,
}) => {
    vi.stubEnv(
        "SOURCE_QUALIFICATION_ENABLED",
        prepareSources ? "true" : "false",
    );
    vi.stubEnv("OPENROUTER_API_KEY", prepareSources ? "fixture-model-key" : "");
    vi.useFakeTimers();
    process.env.SEC_USER_AGENT = "Evidence Workbench test@example.com";
    process.env.EXA_API_KEY = "deterministic-test-key";
    exaSearch.mockResolvedValue({
        results: [
            {
                id: "deterministic-exa-source",
                url: "https://example.com/report",
                title: "Public report",
            },
        ],
    });
    let cancelReading: (() => Promise<void>) | undefined;
    globalThis.fetch = vi.fn(async (input: string | URL | Request) => {
        if (String(input).includes("openrouter.ai"))
            return new Response(
                JSON.stringify({
                    id: "phase4-qualification",
                    created: 1,
                    model: "fixture-model",
                    choices: [
                        {
                            index: 0,
                            message: {
                                role: "assistant",
                                content: JSON.stringify({
                                    companyMatch: "uncertain",
                                    companyPassageKeys: [],
                                    documentKind: "unknown",
                                    reportingPeriodEnd: null,
                                    reportingPeriodPassageKeys: [],
                                    contributions: Object.fromEntries(
                                        SOURCE_COVERAGE_ROLES.map((role) => [
                                            role,
                                            null,
                                        ]),
                                    ),
                                    limitations: [],
                                }),
                            },
                            finish_reason: "stop",
                        },
                    ],
                    usage: {
                        prompt_tokens: 10,
                        completion_tokens: 10,
                        total_tokens: 20,
                    },
                }),
                { headers: { "content-type": "application/json" } },
            );
        if (String(input).endsWith(".htm") && cancelReading)
            await cancelReading();
        return String(input).endsWith(".htm")
            ? new Response(
                  "<h1>Platform</h1><p>The public platform supports company workflows through documented integration APIs.</p>",
                  { headers: { "content-type": "text/html" } },
              )
            : Promise.resolve(
                  new Response(
                      JSON.stringify({
                          cik: "0001818201",
                          name: "CCC Intelligent Solutions Holdings Inc.",
                          tickers: ["CCCS"],
                          exchanges: ["Nasdaq"],
                          filings: {
                              recent: {
                                  accessionNumber: ["0001818201-26-000001"],
                                  form: ["10-K"],
                                  filingDate: ["2026-01-29"],
                                  primaryDocument: ["annual-report.htm"],
                              },
                          },
                      }),
                      { status: 200 },
                  ),
              );
    });
    const t = convexTest(schema, modules);
    rateLimiterTest.register(t);
    workflowTest.register(t);
    if (prepareSources) await serializeFakeStorageWrites(t);
    const fixture = await t.run(async (ctx) => {
        const userId = await ctx.db.insert("users", { isAnonymous: true });
        const invitationId = await ctx.db.insert("invitations", {
            slotKey: "analyst-1",
            role: "analyst",
            codeDigest: "phase-4-digest",
            status: "claimed",
            createdAt: 1,
        });
        const visitorId = await ctx.db.insert("visitors", {
            authUserId: userId,
            invitationId,
            role: "analyst",
            status: "active",
            analysesReserved: 0,
            admittedAt: 1,
        });
        await ctx.db.patch(invitationId, { claimedByVisitorId: visitorId });
        const companyId = await ctx.db.insert("companies", {
            cik: "1818201",
            legalName: "CCC Intelligent Solutions Holdings Inc.",
            ticker: "CCCS",
            exchange: "NASDAQ",
            canonicalizedAt: 1,
        });
        const preflightId = await ctx.db.insert("companyPreflights", {
            ownerVisitorId: visitorId,
            query: "CCCS",
            companyId,
            resolverVersion: "sec-company-v1",
            status: "resolved",
            expiresAt: Date.now() + 60_000,
            createdAt: 1,
        });
        return { userId, preflightId };
    });
    const analyst = t.withIdentity({
        subject: `${fixture.userId}|phase-4-session`,
    });
    const { runId } = await analyst.action(confirmAndStart, {
        preflightId: fixture.preflightId,
        idempotencyKey: "phase-4-run",
        coveragePreset: "balanced",
    });
    let canceledHandles: { parent: WorkflowId; child: WorkflowId } | undefined;
    if (cancelDuringReading)
        cancelReading = async () => {
            const run = await t.run((ctx) => ctx.db.get(runId));
            if (!run?.workflowId)
                throw new Error("Missing main workflow handle");
            const parent = run.workflowId as WorkflowId;
            const journal = await t.run((ctx) =>
                workflow.listSteps(ctx, parent),
            );
            const child = journal.page.find((step) => step.kind === "workflow");
            if (child?.kind !== "workflow")
                throw new Error("Missing nested preparation workflow");
            canceledHandles = { parent, child: child.nestedWorkflowId };
            await analyst.mutation(api.workflowControls.cancel, { runId });
        };
    for (let pump = 0; pump < 100; pump++) {
        await t.finishAllScheduledFunctions(() => vi.advanceTimersByTime(100));
        const state = await t.run((ctx) => ctx.db.get(runId));
        if (state?.executionStatus !== "running") break;
    }
    if (cancelDuringReading) {
        const handles = canceledHandles;
        if (!handles)
            throw new Error(
                "Retrieval did not reach the cancellation boundary",
            );
        expect(await t.run((ctx) => ctx.db.get(runId))).toMatchObject({
            executionStatus: "cancelled",
        });
        expect(
            await t.run((ctx) => workflow.status(ctx, handles.parent)),
        ).toMatchObject({ type: "canceled" });
        expect(
            await t.run((ctx) => workflow.status(ctx, handles.child)),
        ).toMatchObject({ type: "canceled" });
        const artifacts = await t.run(async (ctx) => ({
            captures: await ctx.db.query("sourceCaptures").take(5),
            versions: await ctx.db.query("sourceVersions").take(1),
            claims: await ctx.db.query("claims").take(1),
            calls: await ctx.db
                .query("providerCalls")
                .withIndex("by_run", (q) => q.eq("runId", runId))
                .take(60),
        }));
        expect(
            artifacts.captures.filter(
                (capture) => capture.status === "committed",
            ),
        ).toEqual([]);
        expect(artifacts.versions).toEqual([]);
        expect(artifacts.claims).toEqual([]);
        expect(
            artifacts.calls.filter((call) => call.service === "model"),
        ).toEqual([]);
        return;
    }
    expect(await t.run((ctx) => ctx.db.get(runId))).toMatchObject({
        lifecycleState: "awaiting_source_review",
        executionStatus: "paused",
    });
    if (prepareSources) {
        const prepared = await t.run(async (ctx) => {
            const run = await ctx.db.get(runId);
            return {
                run,
                preparation: run?.sourcePreparationId
                    ? await ctx.db.get(run.sourcePreparationId)
                    : null,
                captures: await ctx.db.query("sourceCaptures").take(5),
                versions: await ctx.db.query("sourceVersions").take(1),
                claims: await ctx.db.query("claims").take(1),
            };
        });
        expect(prepared.run?.sourcePreparationId).toBeTruthy();
        expect(prepared.run).toMatchObject({
            lifecycleState: "awaiting_source_review",
            executionStatus: "paused",
            pauseReason: "source_review",
        });
        expect(prepared.run?.workflowId).toBeTruthy();
        expect(prepared.preparation?.status).toBe("partial");
        expect(prepared.captures.some((c) => c.status === "committed")).toBe(
            true,
        );
        expect(prepared.versions).toHaveLength(0);
        expect(prepared.claims).toHaveLength(0);
        return;
    }
    const exaCalls = await t.run(async (ctx) =>
        ctx.db
            .query("providerCalls")
            .filter((builder) =>
                builder.and(
                    builder.eq(builder.field("runId"), runId),
                    builder.eq(builder.field("service"), "exa"),
                ),
            )
            .collect(),
    );
    expect(exaCalls.length).toBeGreaterThan(0);
    expect(exaCalls.every(({ status }) => status === "succeeded")).toBe(true);
    const { corpusRevisionId, proposalId, sourceId } = await t.run(
        async (ctx) => {
            const run = await ctx.db.get(runId);
            if (!run?.activeCorpusRevisionId) {
                throw new Error("Draft corpus revision not found");
            }
            const source = await ctx.db
                .query("sources")
                .withIndex("by_run_and_url", (builder) =>
                    builder.eq("runId", runId),
                )
                .first();
            if (!source) {
                throw new Error("Discovery did not persist a source");
            }
            const revision = await ctx.db.get(run.activeCorpusRevisionId);
            if (!revision?.sourceSelectionProposalId) {
                throw new Error("Source selection proposal not found");
            }
            return {
                corpusRevisionId: run.activeCorpusRevisionId,
                proposalId: revision.sourceSelectionProposalId,
                sourceId: source._id,
            };
        },
    );
    await expect(t.run((ctx) => ctx.db.get(proposalId))).resolves.toMatchObject(
        {
            status: "ready",
            version: 1,
        },
    );

    await expect(
        analyst.mutation(approveCorpus, {
            runId,
            corpusRevisionId,
            proposalId,
            proposalVersion: 1,
            decisionKey: "approve-corpus-1",
        }),
    ).resolves.toEqual({ accepted: true });
    await expect(
        analyst.mutation(approveCorpus, {
            runId,
            corpusRevisionId,
            proposalId,
            proposalVersion: 1,
            decisionKey: "approve-corpus-1",
        }),
    ).resolves.toEqual({ accepted: false });
    for (let pump = 0; pump < 100; pump++) {
        await t.finishAllScheduledFunctions(() => vi.advanceTimersByTime(100));
        const state = await t.run((ctx) => ctx.db.get(runId));
        if (state?.executionStatus !== "running") break;
    }

    await expect(t.query(getRun, { runId })).resolves.toMatchObject({
        lifecycleState: "extracting_evidence",
        executionStatus: "paused",
        pauseReason: "claim_generation_unavailable",
        executionGeneration: 3,
        workflowVersion: 2,
        activeCorpusRevisionId: corpusRevisionId,
    });
    const finishedRun = await t.run(async (ctx) => ctx.db.get(runId));
    expect(finishedRun?.workflowId).toBeUndefined();
    expect(
        (await t.query(listEvents, { runId })).some(
            ({ lifecycleState }) => lifecycleState === "extracting_evidence",
        ),
    ).toBe(true);
    const evidence = await t.run(async (ctx) => ({
        statuses: await ctx.db
            .query("evidenceSourceStatuses")
            .withIndex("by_run_and_execution_generation", (q) =>
                q.eq("runId", runId).eq("executionGeneration", 3),
            )
            .take(49),
        versions: await ctx.db
            .query("sourceVersions")
            .withIndex("by_run", (q) => q.eq("runId", runId))
            .take(49),
        claims: await ctx.db
            .query("claims")
            .withIndex("by_run", (q) => q.eq("runId", runId))
            .take(1),
    }));
    expect(
        evidence.statuses.some((status) => status.status === "succeeded"),
    ).toBe(true);
    expect(evidence.versions.length).toBeGreaterThan(0);
    expect(evidence.claims).toEqual([]);
    await expect(
        t.run(async (ctx) => ctx.db.get(corpusRevisionId)),
    ).resolves.toMatchObject({ status: "approved" });
    const { acceptedDecisions, recommendedCount } = await t.run(async (ctx) => {
        const proposal = await ctx.db.get(proposalId);
        const decisions = await ctx.db
            .query("sourceDecisions")
            .withIndex("by_revision_and_source", (query) =>
                query.eq("corpusRevisionId", corpusRevisionId),
            )
            .collect();
        return {
            acceptedDecisions: decisions.filter(
                ({ decision }) => decision === "accepted",
            ).length,
            recommendedCount: proposal?.counts.recommended,
        };
    });
    expect(acceptedDecisions).toBe(recommendedCount);
    await expect(
        analyst.mutation(decideSource, {
            runId,
            corpusRevisionId,
            sourceId,
            decision: "accepted",
            decisionKey: "late-approved-edit",
        }),
    ).rejects.toThrow("immutable");
});
