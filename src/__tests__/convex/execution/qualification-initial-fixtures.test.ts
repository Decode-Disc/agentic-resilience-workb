import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { api, internal } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { sha256Hex } from "@convex/domain/sourcePassages";
import {
    campaignManifestSchema,
    emptyCampaignLimits,
    framingReplaySchema,
    type QualificationScenario,
} from "@convex/qualificationCampaignPolicy";
import {
    initialDocumentaryMaterial,
    initialFixtureContent,
    initialFixtureIds,
} from "@convex/qualificationInitialFixtures";
import directedMaterial from "@evaluations/workbench-browser/fixtures/directed-framing-20261118/material.json";
import {
    compactFramingReplayDocuments,
    prepareFramingReplay,
} from "@evaluations/workbench-browser/protocol";
import { prepareCampaignScenarios } from "@evaluations/workbench-browser/scenarios";
import { ConvexHttpClient } from "convex/browser";
import { getFunctionName, makeFunctionReference } from "convex/server";
import {
    CommitTsPlaceholder,
    convexToJson,
    type JSONValue,
    jsonToConvex,
    type Value,
} from "convex/values";
import { afterEach, assert, expect, test, vi } from "vitest";
import rateLimiterTest from "@/__tests__/convex/integrations/rate-limiter-test-register.js";
import { dispatchFixtureOperation } from "@/__tests__/setup/pi-mission";
import {
    nativePiFixtureRoute,
    nativeTextReply,
    nativeToolReply,
} from "@/__tests__/setup/pi-native";
import { methodComparisonManifest } from "@/__tests__/setup/qualification-method-comparison";
import { configurableCampaign } from "@/__tests__/setup/qualification-v2";
import { readConversationPageWithBodies } from "@/__tests__/setup/retained-messages";
import {
    activateSourcesMission,
    sourcesTestEnvelope,
} from "@/__tests__/setup/sources-mission";
import { seedWorkbench } from "@/__tests__/setup/workbench";

vi.mock("node:dns/promises", async (importOriginal) => {
    const actual = await importOriginal<typeof import("node:dns/promises")>();
    const lookup = vi.fn(async () => [{ address: "93.184.216.34", family: 4 }]);
    return { ...actual, default: { ...actual, lookup }, lookup };
});

afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

const install = makeFunctionReference<
    "action",
    { runId: Id<"researchRuns">; fixtureKey: string; scenarioId: string },
    {
        preparationId: Id<"sourceSelectionProposalRebuilds">;
        missionId: Id<"agentMissions">;
        captureId: Id<"sourceCaptures">;
    }
>("qualificationInitialFixtureSetup:install");

async function fixture(
    id: (typeof initialFixtureIds)[number],
    presets: readonly (
        | "balanced"
        | "first_party_depth"
        | "independent_scrutiny"
        | undefined
    )[] = [undefined],
    framingRequest?: { text: string; receivedAt: string },
    framingReplay?: QualificationScenario["framingReplay"],
    taskMethods?: "retained_control" | "native_skills",
    company?: QualificationScenario["company"],
) {
    const f = await seedWorkbench(true);
    const raw = taskMethods
        ? methodComparisonManifest()
        : configurableCampaign();
    const configurationId = taskMethods?.replaceAll("_", "-") ?? "first";
    const baseline = raw.scenarios[0];
    assert(baseline);
    if (framingReplay?.case === "nvidia")
        baseline.company = {
            cik: "1045810",
            name: "NVIDIA Corporation",
            ticker: "NVDA",
            websiteUrl: "https://www.nvidia.com",
        };
    if (company) baseline.company = company;
    const scenarios = presets.map((coveragePreset) => ({
        ...baseline,
        ...(framingReplay
            ? { framingReplay, framingPublicContext: true as const }
            : {}),
        ...(framingRequest
            ? {
                  framingRequest,
                  steps: [
                      {
                          id: "settled",
                          action: "wait_for",
                          state: "conversation_settled",
                      },
                  ],
              }
            : {}),
        ...(coveragePreset
            ? {
                  coveragePreset,
                  id: `coverage-${coveragePreset.replaceAll("_", "-")}`,
                  sourcesEnvelope: sourcesTestEnvelope,
              }
            : {}),
        steps: coveragePreset
            ? baseline.steps
            : [
                  {
                      id: "prepared",
                      action: "wait_for",
                      state: "sources_prepared",
                  },
              ],
        ...(coveragePreset
            ? {}
            : {
                  initialFixture: {
                      id,
                      hash: sha256Hex(initialFixtureContent(id)),
                  },
              }),
    }));
    if (framingRequest)
        for (const scenario of scenarios)
            scenario.steps = [
                {
                    id: "settled",
                    action: "wait_for",
                    state: "conversation_settled",
                },
            ];
    const manifest = compactFramingReplayDocuments(
        campaignManifestSchema.parse({
            ...raw,
            mode: "deterministic",
            configurations: taskMethods
                ? raw.configurations
                : raw.configurations.slice(0, 1),
            scenarios,
            expectations: scenarios.map((scenario) => ({
                id: scenario.id,
                checks: ["documentary-handoff"],
            })),
            batteryHash: "a".repeat(64),
            perLot: emptyCampaignLimits(),
            total: emptyCampaignLimits(),
        }),
    );
    const campaignId = await f.t.mutation(
        internal.qualificationCampaigns.authorize,
        { manifest },
    );
    const lotId = await f.t.mutation(internal.qualificationCampaigns.admit, {
        campaignId,
        key: "first",
        configurationId,
        candidateHash: "b".repeat(64),
        changedPaths: [],
    });
    await f.t.run(async (ctx) => {
        const original = await ctx.db.get(f.runId);
        assert(original?.browserTestContextId);
        // The seed dossier supplies the invitation slot. Its queued framing is discarded.
        for (const job of await ctx.db.system
            .query("_scheduled_functions")
            .collect()) {
            if (
                job.state.kind === "pending" &&
                job.name ===
                    getFunctionName(
                        internal.execution.conversations.pumpWorkbench,
                    ) &&
                job.args[0]?.runId === original._id
            )
                await ctx.scheduler.cancel(job._id);
        }
    });
    await f.t.mutation(internal.runWorkspace.closeBrowserTestContext, {
        slotKey: "analyst-4",
        contextKey: "native-workbench",
    });
    assert(manifest.version !== 1);
    const root = mkdtempSync(join(tmpdir(), "workbench-campaign-fixture-"));
    const client = new ConvexHttpClient("http://127.0.0.1:3210", {
        fetch: async (_url, options) => {
            assert(typeof options?.body === "string");
            const request: { path: string; args: [JSONValue] } = JSON.parse(
                options.body,
            );
            const args = jsonToConvex(request.args[0]);
            assert(
                args &&
                    typeof args === "object" &&
                    !Array.isArray(args) &&
                    !(args instanceof ArrayBuffer) &&
                    !(args instanceof CommitTsPlaceholder),
            );
            const result = await f.t.mutation(
                makeFunctionReference<
                    "mutation",
                    Record<string, Value | undefined>,
                    Value
                >(request.path),
                args,
            );
            return Response.json({
                status: "success",
                value: convexToJson(result),
            });
        },
    });
    let dossiers: {
        runId: Id<"researchRuns">;
        fixtureKey: string;
        scenarioId: string;
    }[];
    try {
        await prepareCampaignScenarios(
            client,
            root,
            manifest,
            lotId,
            configurationId,
        );
        const prepared = JSON.parse(
            readFileSync(join(root, "prepared.json"), "utf8"),
        );
        dossiers = prepared.cases.map(
            (entry: {
                runId: Id<"researchRuns">;
                fixtureKey: string;
                id: string;
            }) => ({
                runId: entry.runId,
                fixtureKey: entry.fixtureKey,
                scenarioId: entry.id,
            }),
        );
    } finally {
        rmSync(root, { recursive: true });
    }
    const first = dossiers[0];
    assert(first);
    const firstRun = await f.t.run((ctx) => ctx.db.get(first.runId));
    assert(firstRun?.browserTestContextId);
    return {
        ...f,
        campaignId,
        contextId: firstRun.browserTestContextId,
        runId: first.runId,
        args: first,
        framing: baseline.framing,
        dossiers,
    };
}

test("campaign coverage presets reach genuine Start pins on fresh dossiers", async () => {
    const errors = vi.spyOn(console, "error");
    const network = vi.fn<typeof fetch>(async () => {
        throw new Error("Campaign coverage runs without provider I/O");
    });
    vi.stubGlobal("fetch", network);
    const presets = [
        "balanced",
        "first_party_depth",
        "independent_scrutiny",
    ] as const;
    const f = await fixture("sources_correction", presets);
    expect(new Set(f.dossiers.map(({ runId }) => runId)).size).toBe(3);
    const records = [];
    for (const { runId, fixtureKey } of f.dossiers) {
        await f.t.mutation(internal.execution.fixtures.activateWorkbench, {
            runId,
            fixtureKey,
            researchAngle: f.framing.scope,
        });
        const before = await f.client.query(api.framing.get, { runId });
        assert(before);
        const revision = await f.client.mutation(api.framing.save, {
            runId,
            expectedRevision: before.revision,
            requestKey: "frozen-framing",
            content: f.framing,
        });
        await f.client.mutation(api.framing.startResearch, {
            runId,
            expectedRevision: revision,
            requestKey: "coverage-start",
        });
        const run = await f.t.run((ctx) => ctx.db.get(runId));
        expect(run).toMatchObject({
            sourcesCoveragePolicyVersion: "sources_coverage_v1",
            sourcesEnvelope: sourcesTestEnvelope,
            researchStartRequestKey: "coverage-start",
        });
        expect(
            (await f.client.query(api.framing.get, { runId }))?.content,
        ).toEqual(f.framing);
        const readCoverage = () =>
            f.t.run(async (ctx) => {
                const current = await ctx.db.get(runId);
                return current?.sourcePreparationId
                    ? (await ctx.db.get(current.sourcePreparationId))
                          ?.sourcesMission?.coveragePolicy
                    : undefined;
            });
        await f.t.finishAllScheduledFunctions(
            () => vi.advanceTimersByTime(100),
            200,
        );
        const applied = await readCoverage();
        expect(applied).toEqual({
            version: "sources_coverage_v1",
            preset: run?.coveragePreset,
        });
        records.push(applied?.preset);
        await f.client.mutation(api.workflowControls.cancel, { runId });
    }
    expect(
        errors.mock.calls.filter(([message]) =>
            String(message).startsWith("Error when running scheduled function"),
        ),
    ).toEqual([]);
    expect(records).toEqual(presets);
    expect(network).not.toHaveBeenCalled();
});

test("initial fixture retention refuses cancellation after the adopted documentary read", async () => {
    const f = await fixture("sources_correction");
    const state = await f.t.mutation(
        internal.qualificationInitialFixtureSetup.seed,
        f.args,
    );
    const text = initialDocumentaryMaterial.text;
    const storageId = await f.t.run((ctx) =>
        ctx.storage.store(
            new Blob([text], { type: "text/plain; charset=utf-8" }),
        ),
    );
    await f.t.mutation(internal.sourceCaptures.attachStorage, {
        preparationId: state.preparationId,
        captureId: state.captureId,
        storageId,
    });
    await f.t.mutation(internal.sourceCaptures.finalize, {
        preparationId: state.preparationId,
        captureId: state.captureId,
        contentHash: sha256Hex(text),
        byteCount: new TextEncoder().encode(text).length,
        resolvedUrl: initialDocumentaryMaterial.url,
        retrievalVersion: "retained-documentary-fixture-v1",
        normalizerVersion: state.normalizerVersion,
        retrievedAt: Date.now(),
        readingCompleteness: "complete",
        representationCompleteness: "complete",
        omittedPassageCount: 0,
    });
    await f.t.action(internal.sourceRetrievalActions.indexCapture, {
        preparationId: state.preparationId,
        captureId: state.captureId,
        mode: "lexical",
        allowProviderCalls: false,
    });
    const readRequestId = await f.t.mutation(
        internal.execution.operations.enqueue,
        {
            missionId: state.missionId,
            expectedGeneration: state.generation,
            cause: "fixture-read-before-cancel",
            input: state.readingInput,
        },
    );
    expect(
        await dispatchFixtureOperation(f.t, {
            requestId: readRequestId,
            expectedGeneration: state.generation,
        }),
    ).toMatchObject({ kind: "success" });
    expect(
        await f.client.mutation(api.workflowControls.cancel, {
            runId: f.runId,
        }),
    ).toEqual({ cancelled: true });
    await expect(
        f.t.mutation(internal.qualificationInitialFixtureSetup.retain, {
            ...f.args,
            readRequestId,
        }),
    ).rejects.toThrow(/stale_execution|mission_cancelled|not_running/);
    expect(
        (await f.t.run((ctx) => ctx.db.get(state.preparationId)))
            ?.sourcesMission?.qualifications,
    ).toEqual([]);
    expect(
        await f.t.run((ctx) =>
            ctx.db
                .query("aiTaskResults")
                .withIndex("by_run", (q) => q.eq("runId", f.runId))
                .collect(),
        ),
    ).toEqual([]);
});

test.each(
    initialFixtureIds,
)("%s reconstructs bounded labelled material through the real local fixture owner", async (id) => {
    const f = await fixture(id);
    const seeded = await f.t.action(install, f.args);
    const preparation = await f.t.run((ctx) =>
        ctx.db.get(seeded.preparationId),
    );
    const mission = await f.t.run((ctx) => ctx.db.get(seeded.missionId));
    const tasks = await f.t.run((ctx) =>
        ctx.db
            .query("aiTaskResults")
            .withIndex("by_run", (q) => q.eq("runId", f.runId))
            .take(10),
    );
    expect(
        tasks.some(
            (task) =>
                task.executionMode === "showcase" && task.fixtureId === id,
        ),
    ).toBe(true);
    expect(
        await f.t.run((ctx) => ctx.db.query("providerCalls").collect()),
    ).toEqual([]);
    if (id === "sources_correction") {
        expect(preparation?.sourcesMission?.qualifications).toHaveLength(1);
        expect(preparation?.sourcesMission?.result).toBeUndefined();
        expect(mission?.status).toBe("ready");
    } else {
        expect(mission?.status).toBe(
            id === "sources_completed_partial" ? "completed" : "blocked",
        );
        const material = await f.client.query(
            api.sourcesMission.getPreparedMaterial,
            { runId: f.runId },
        );
        expect(material?.material?.outcome).toBe("partial");
        expect(material?.material?.documents).toHaveLength(1);
        expect(
            (await f.t.run((ctx) => ctx.db.get(f.runId)))?.lifecycleState,
        ).toBe("sources_prepared");
    }
    const snapshot = await f.t.query(
        internal.execution.fixtures.qualificationSnapshot,
        { runId: f.runId, fixtureKey: f.args.fixtureKey },
    );
    expect(snapshot.nativeSettled).toBe(true);
    const conversation = snapshot.conversation;
    assert(conversation);
    await f.t.run((ctx) =>
        ctx.db.insert("agentConversationTurns", {
            runId: f.runId,
            conversationId: conversation._id,
            status: "interrupted",
            instructionVersion: 1,
            generation: 1,
            messageCount: 1,
            createdAt: Date.now(),
        }),
    );
    expect(
        (
            await f.t.query(internal.execution.fixtures.qualificationSnapshot, {
                runId: f.runId,
                fixtureKey: f.args.fixtureKey,
            })
        ).nativeSettled,
    ).toBe(false);
    await expect(f.t.action(install, f.args)).rejects.toThrow(
        /already|renew|initial/i,
    );
});

test.each([
    "disabled",
    "cloud",
    "foreign-key",
    "undeclared",
    "expired",
    "changed-digest",
] as const)("initial fixture refuses %s before creating captured material", async (variant) => {
    const f = await fixture("sources_completed_partial");
    if (variant === "disabled") vi.stubEnv("E2E_FIXTURES_ENABLED", "false");
    if (variant === "cloud")
        vi.stubEnv("CONVEX_CLOUD_URL", "https://example.convex.cloud");
    if (variant === "expired")
        await f.t.run((ctx) =>
            ctx.db.patch(f.contextId, { expiresAt: Date.now() - 1 }),
        );
    if (variant === "changed-digest")
        await f.t.run(async (ctx) => {
            const campaign = await ctx.db.get(f.campaignId);
            assert(campaign?.manifest.version === 2);
            await ctx.db.patch(campaign._id, {
                manifest: {
                    ...campaign.manifest,
                    scenarios: campaign.manifest.scenarios.map((scenario) => ({
                        ...scenario,
                        initialFixture: {
                            id: "sources_completed_partial" as const,
                            hash: "0".repeat(64),
                        },
                    })),
                },
            });
        });
    await expect(
        f.t.action(install, {
            ...f.args,
            ...(variant === "foreign-key"
                ? { fixtureKey: "another-fixture" }
                : {}),
            ...(variant === "undeclared"
                ? { scenarioId: "another-scenario" }
                : {}),
        }),
    ).rejects.toThrow();
    expect(
        (await f.t.run((ctx) => ctx.db.get(f.runId)))?.sourcePreparationId,
    ).toBeUndefined();
    expect(
        await f.t.run((ctx) => ctx.db.query("sourceCaptures").take(1)),
    ).toEqual([]);
});

test.each([
    "balanced",
    "first_party_depth",
    "independent_scrutiny",
] as const)("directed framing handoff fixes the agent's program and preset in the first Sources request (%s)", async (preset) => {
    activateSourcesMission();
    vi.stubEnv("SEC_USER_AGENT", "Workbench fixture evidence@example.test");
    vi.stubEnv("OPENROUTER_API_KEY", "fixture-only");
    vi.stubEnv("EXA_API_KEY", "fixture-only");
    vi.stubEnv(
        "WORKBENCH_PUBLIC_CONTEXT_ALLOWANCE",
        JSON.stringify({ searches: 1, readings: 1 }),
    );
    const sourceRequests: string[] = [];
    const errors: unknown[] = [];
    let generation = 0;
    let searchId = "";
    const scope = "Investigate insurer control over estimate review.";
    const questions = [
        {
            id: "control",
            shortLabel: "Control",
            text: "Which review decisions require the platform?",
            rationale: "Locate workflow control.",
        },
        {
            id: "validation",
            shortLabel: "Validation",
            text: "can insurers validate estimates through another workflow?",
            rationale: "Test conditional bypass.",
        },
    ];
    vi.stubGlobal(
        "fetch",
        vi.fn<typeof fetch>(async (url, init) => {
            if (String(url).includes("data.sec.gov/submissions/"))
                return Response.json({
                    cik: "1818201",
                    name: "CCC Intelligent Solutions Holdings Inc.",
                    tickers: ["CCCS"],
                    exchanges: ["NASDAQ"],
                    filings: {
                        recent: {
                            accessionNumber: [],
                            filingDate: [],
                            form: [],
                            primaryDocument: [],
                        },
                    },
                });
            if (String(url).endsWith("/search"))
                return Response.json({
                    results: directedMaterial.ccc.results.map(
                        ({ text: _text, ...lead }) => lead,
                    ),
                });
            if (String(url).endsWith("/contents"))
                return Response.json({ results: directedMaterial.ccc.results });
            try {
                const request = JSON.parse(String(init?.body));
                const section = request.messages.find(
                    (message: { content: string }) =>
                        message.content?.includes(
                            "Required current mission state:",
                        ),
                );
                assert(section);
                const state = JSON.parse(
                    section.content
                        .split("Required current mission state:\n")[1]
                        .split("\n")[0],
                );
                if (state.definition.id === "sources_v1") {
                    sourceRequests.push(section.content);
                    const completionPayload = {
                        kind: "complete",
                        needs: state.activeWork.needs.map(
                            (need: { id: string }) => ({
                                needId: need.id,
                                unfinished: [
                                    "Offline fixture ends before documentary collection.",
                                ],
                            }),
                        ),
                    };
                    return state.constraints?.completion?.format === "tool"
                        ? nativeToolReply(
                              "submit_completion",
                              completionPayload,
                          )
                        : nativeTextReply(JSON.stringify(completionPayload));
                }
                if (generation++ === 0) {
                    expect(state.domain.coveragePreset).toBe(preset);
                    return nativeToolReply("search_public_context", {
                        query: "validation rights",
                    });
                }
                const result = JSON.parse(
                    request.messages
                        .filter(
                            (message: { role: string }) =>
                                message.role === "tool",
                        )
                        .at(-1).content,
                );
                expect(result.kind).toBe("success");
                if (generation === 2) {
                    searchId = result.value.searchId;
                    return nativeToolReply("read_public_context", {
                        target: { kind: "candidate", searchId, index: 0 },
                    });
                }
                if (generation === 3)
                    return nativeToolReply("adjust_framing", {
                        content: { scope, questions },
                        eventBasis: {
                            kind: "open",
                            activityExcerpt: "estimate review",
                            conditions: [
                                {
                                    questionId: "validation",
                                    hypothesis:
                                        "the announcement changes validation rights",
                                    basis: {
                                        kind: "public",
                                        readIds: [result.value.readId],
                                    },
                                },
                            ],
                        },
                    });
                return nativeTextReply(
                    "The provisional estimate-review program is saved. Choose Start research when ready.",
                );
            } catch (error) {
                errors.push(error);
                throw error;
            }
        }),
    );
    const f = await seedWorkbench(
        false,
        nativePiFixtureRoute,
        60000,
        "Investigate estimate review after the latest validation-rights announcement.",
        undefined,
        undefined,
        preset,
    );
    rateLimiterTest.register(f.t);
    const conversation = await f.t.run((ctx) =>
        ctx.db
            .query("agentConversations")
            .withIndex("by_run", (q) => q.eq("runId", f.runId))
            .unique(),
    );
    expect(conversation?.definitionVersion).toBe(5);
    const configured = await f.t.run(async (ctx) => {
        const catalog = (await ctx.db.query("modelCatalog").collect()).find(
            (entry) =>
                entry.model === nativePiFixtureRoute.model &&
                entry.provider === nativePiFixtureRoute.provider,
        );
        const invitation = await ctx.db
            .query("invitations")
            .withIndex("by_slot_key", (q) => q.eq("slotKey", "admin"))
            .unique();
        const visitor = invitation?.claimedByVisitorId
            ? await ctx.db.get(invitation.claimedByVisitorId)
            : null;
        const assignment = (
            await ctx.db.query("agentModelSettings").collect()
        ).find((entry) => entry.agent === "sources");
        assert(catalog && visitor);
        return {
            catalogId: catalog._id,
            subject: visitor.authUserId,
            revision: assignment?.revision ?? 0,
        };
    });
    await f.t
        .withIdentity({ subject: configured.subject })
        .mutation(api.modelConfiguration.assign, {
            agent: "sources",
            catalogId: configured.catalogId,
            expectedRevision: configured.revision,
            requestKey: "directed-source-model",
        });
    await f.t.finishAllScheduledFunctions(
        () => vi.advanceTimersByTime(10),
        1000,
    );
    if (errors.length) throw errors[0];
    expect(generation).toBe(4);
    expect(sourceRequests).toEqual([]);
    const draft = await f.client.query(api.framing.get, { runId: f.runId });
    assert(draft);
    expect(
        (await f.t.run((ctx) => ctx.db.get(f.runId)))?.sourcePreparationId,
    ).toBeUndefined();
    const start = {
        runId: f.runId,
        expectedRevision: draft.revision,
        requestKey: "directed-start",
    };
    expect(await f.client.mutation(api.framing.startResearch, start)).toBe(
        f.runId,
    );
    expect(await f.client.mutation(api.framing.startResearch, start)).toBe(
        f.runId,
    );
    await f.t.finishAllScheduledFunctions(
        () => vi.advanceTimersByTime(10),
        1000,
    );
    if (errors.length) throw errors[0];
    const saved = await f.t.run(async (ctx) => {
        const run = await ctx.db.get(f.runId);
        assert(
            run?.fixedFramingRevisionId &&
                run.sourcePreparationId &&
                run.ownerVisitorId,
        );
        return {
            run,
            fixed: await ctx.db.get(run.fixedFramingRevisionId),
            preparation: await ctx.db.get(run.sourcePreparationId),
            visitor: await ctx.db.get(run.ownerVisitorId),
            missions: await ctx.db.query("agentMissions").collect(),
        };
    });
    expect(saved.fixed?.content).toEqual(draft.content);
    expect(saved.visitor?.analysesReserved).toBe(1);
    expect(saved.preparation?.sourcesMission?.coveragePolicy?.preset).toBe(
        preset,
    );
    for (const question of draft.content.questions)
        expect(
            saved.preparation?.sourcesMission?.needs.find((need) =>
                need.questionIds.includes(question.id),
            )?.information,
        ).toBe(question.text);
    expect(
        saved.preparation?.sourcesMission?.needs.find(
            (need) => need.commonContext,
        )?.information,
    ).toContain(draft.content.scope);
    expect(
        saved.missions.some((mission) => mission.definitionId === "sources_v1"),
    ).toBe(true);
    expect(sourceRequests).toHaveLength(1);
    const wire = JSON.parse(
        sourceRequests[0]
            ?.split("Required current mission state:\n")[1]
            ?.split("\n")[0] ?? "null",
    );
    expect(wire.domain.framing).toMatchObject({
        scope: draft.content.scope,
        questions: draft.content.questions,
        fixed: true,
    });
    expect(wire.domain.coveragePolicy?.preset).toBe(preset);
    for (const question of draft.content.questions)
        expect(
            wire.activeWork.needs.find((need: { questionIds: string[] }) =>
                need.questionIds.includes(question.id),
            )?.information,
        ).toBe(question.text);
}, 30000);

test("dated fresh framing fixture preserves the exact original request before any dispatch", async () => {
    const request = {
        text: "will it survive after the recent crisis ?",
        receivedAt: "2026-11-18T09:00:00.000Z",
    };
    const f = await fixture("sources_correction", ["balanced"], request);
    await f.t.mutation(internal.execution.fixtures.activateWorkbench, {
        runId: f.runId,
        fixtureKey: f.args.fixtureKey,
    });
    const initial = await f.t.run(async (ctx) => ({
        run: await ctx.db.get(f.runId),
        revisions: await ctx.db
            .query("framingRevisions")
            .filter((q) => q.eq(q.field("runId"), f.runId))
            .collect(),
        deliveries: await ctx.db
            .query("agentMessageDeliveries")
            .withIndex("by_run_and_key", (q) => q.eq("runId", f.runId))
            .collect(),
        missions: await ctx.db
            .query("agentMissions")
            .filter((q) => q.eq(q.field("runId"), f.runId))
            .collect(),
    }));
    expect(initial.revisions).toHaveLength(1);
    expect(initial.revisions[0]).toMatchObject({
        origin: "initial",
        content: { scope: "", questions: [] },
    });
    expect(initial.run?.researchStartedAt).toBeUndefined();
    expect(initial.run?.sourcePreparationId).toBeUndefined();
    expect(
        initial.missions.filter((m) => m.definitionId === "sources_v1"),
    ).toEqual([]);
    const messages = await readConversationPageWithBodies(f.client, {
        runId: f.runId,
        paginationOpts: { numItems: 20, cursor: null },
    });
    expect(messages.page.filter((d) => d.role === "user")).toMatchObject([
        { text: request.text, createdAt: Date.parse(request.receivedAt) },
    ]);
});

test("original Nvidia request reaches the first native dispatch with an empty program and its November date", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-18T09:00:00.000Z"));
    vi.stubEnv("OPENROUTER_API_KEY", "fixture-only");
    let first = "";
    vi.stubGlobal(
        "fetch",
        vi.fn<typeof fetch>(async (_url, init) => {
            first = String(init?.body);
            return nativeTextReply(
                "Which crisis do you mean? The initial program remains open.",
            );
        }),
    );
    const f = await seedWorkbench(
        false,
        nativePiFixtureRoute,
        60000,
        "will it survive after the recent crisis ?",
        {
            cik: "1045810",
            legalName: "NVIDIA Corporation",
            ticker: "NVDA",
            exchange: "NASDAQ",
        },
    );
    const before = await f.client.query(api.framing.get, { runId: f.runId });
    expect(before).toMatchObject({
        origin: "initial",
        content: { scope: "", questions: [] },
    });
    await f.t.finishAllScheduledFunctions(
        () => vi.advanceTimersByTime(10),
        1000,
    );
    const request = JSON.parse(first);
    const section = request.messages.find((message: { content?: string }) =>
        message.content?.includes("Required current mission state:"),
    );
    assert(section);
    const state = JSON.parse(
        section.content
            .split("Required current mission state:\n")[1]
            .split("\n")[0],
    );
    expect(state.conversationInstructions.messages).toEqual([
        expect.objectContaining({
            text: "will it survive after the recent crisis ?",
            receivedAt: "2026-11-18T09:00:00.000Z",
        }),
    ]);
    expect(state.domain.framing).toMatchObject({
        scope: "",
        questions: [],
        origin: "initial",
    });
    expect(first).not.toContain("nvda-20261111.htm");
    expect(first).not.toContain("Huang");
    const run = await f.t.run((ctx) => ctx.db.get(f.runId));
    expect(run?.researchStartedAt).toBeUndefined();
    expect(run?.sourcePreparationId).toBeUndefined();
    expect(await f.client.query(api.framing.get, { runId: f.runId })).toEqual(
        before,
    );
});

test.each(
    (
        [
            ["nvidia", "balanced"],
            ["ccc", "balanced"],
            ["ccc", "first_party_depth"],
            ["ccc", "independent_scrutiny"],
            ["lookupUnavailable", "balanced"],
            ["insufficientDatedSupport", "balanced"],
        ] as const
    ).flatMap(([replayCase, preset]) =>
        (["retained_control", "native_skills"] as const).map(
            (methods) => [replayCase, preset, methods] as const,
        ),
    ),
)("bound campaign replay supplies actual framing operations without network (%s, %s, %s)", async (replayCase, preset, methods) => {
    const path = resolve(
        "scripts/evaluations/workbench-browser/fixtures/directed-framing-20261118/material.json",
    );
    const replay = framingReplaySchema.parse(
        prepareFramingReplay({
            materialPath: path,
            materialHash: createHash("sha256")
                .update(readFileSync(path))
                .digest("hex"),
            case: replayCase,
        }),
    );
    const sharedCase =
        replayCase === "nvidia" &&
        preset === "balanced" &&
        methods === "native_skills";
    const f = await fixture(
        "sources_correction",
        sharedCase
            ? ["balanced", "first_party_depth", "independent_scrutiny"]
            : [preset],
        {
            text:
                replayCase === "nvidia"
                    ? "will it survive after the recent crisis ?"
                    : "Investigate estimate review after the latest announcement.",
            receivedAt: "2026-11-18T09:00:00.000Z",
        },
        replay,
        methods,
    );
    if (sharedCase) {
        const stored = await f.t.run((ctx) => ctx.db.get(f.campaignId));
        assert(stored?.manifest.version !== 1 && stored);
        expect(
            Object.keys(stored.manifest.sharedFramingDocuments ?? {}),
        ).toHaveLength(1);
        expect(
            stored.manifest.scenarios.every(
                (s) => s.framingReplay && "documentsRef" in s.framingReplay,
            ),
        ).toBe(true);
    }
    await f.t.mutation(internal.execution.fixtures.activateWorkbench, {
        runId: f.runId,
        fixtureKey: f.args.fixtureKey,
    });
    const active = await f.t.mutation(
        internal.execution.conversations.startTurn,
        {
            runId: f.runId,
            definitionId: "workbench_v1",
            scope: { kind: "workbench_v1" },
            simulation: true,
        },
    );
    assert(active);
    const message = await f.t.run((ctx) =>
        ctx.db
            .query("agentMessageDeliveries")
            .withIndex("by_turn", (q) => q.eq("turnId", active.turnId))
            .first(),
    );
    assert(message);
    const initial = await f.t.query(internal.execution.context.build, {
        missionId: active.missionId,
        expectedGeneration: 1,
    });
    assert(initial.kind === "ready");
    expect(initial.inputJson).not.toContain(replay.materialHash);
    expect(initial.inputJson).not.toContain("Illustrative fixture:");
    expect(initial.inputJson).not.toContain("Huang");
    expect(initial.inputJson).not.toContain("nvda-20261111.htm");
    const dns = vi.mocked((await import("node:dns/promises")).lookup);
    dns.mockClear();
    const network = vi.fn<typeof fetch>(async () => {
        throw new Error("Frozen replay must not access network");
    });
    vi.stubGlobal("fetch", network);
    const searchId = await f.t.mutation(internal.execution.operations.enqueue, {
        missionId: active.missionId,
        expectedGeneration: 1,
        cause: "replay-search",
        input: {
            kind: "search_public_context",
            messageId: message._id,
            query: "latest announcement",
        },
    });
    const searched = await dispatchFixtureOperation(f.t, {
        requestId: searchId,
        expectedGeneration: 1,
    });
    if (replay.unavailable)
        expect(searched).toMatchObject({
            kind: "unavailable",
            code: "missing_configuration",
        });
    else {
        assert(searched.kind === "success");
        const result = JSON.parse(searched.valueJson);
        expect(result.replayCorpusHash).toBe(replay.materialHash);
        expect(
            result.candidates.map((lead: { url: string }) => lead.url),
        ).toEqual(replay.documents.map((doc) => doc.url));
        expect(result.candidates[0]).not.toHaveProperty("text");
        const readId = await f.t.mutation(
            internal.execution.operations.enqueue,
            {
                missionId: active.missionId,
                expectedGeneration: 1,
                cause: "replay-read",
                input: {
                    kind: "read_public_context",
                    messageId: message._id,
                    target: { kind: "candidate", searchId, index: 0 },
                },
            },
        );
        const read = await dispatchFixtureOperation(f.t, {
            requestId: readId,
            expectedGeneration: 1,
        });
        assert(read.kind === "success");
        expect(JSON.parse(read.valueJson)).toMatchObject({
            replayCorpusHash: replay.materialHash,
        });
        if (replayCase === "nvidia")
            expect(JSON.parse(read.valueJson).reference).toMatchObject({
                excerpt: expect.stringContaining("resignation"),
                publishedAt: "2026-11-12T00:00:00.000Z",
            });
        else
            expect(JSON.parse(read.valueJson).reference.excerpt).toBe(
                replay.documents[0]?.text,
            );
        if (replayCase === "insufficientDatedSupport")
            expect(JSON.parse(read.valueJson).reference).not.toHaveProperty(
                "publishedAt",
            );
        if (replayCase === "insufficientDatedSupport") {
            const editId = await f.t.mutation(
                internal.execution.operations.enqueue,
                {
                    missionId: active.missionId,
                    expectedGeneration: 1,
                    cause: "undated-replay-cannot-identify-event",
                    input: {
                        kind: "adjust_framing",
                        messageId: message._id,
                        expectedRevision: 1,
                        content: {
                            scope: "Investigate estimate review.",
                            questions: [
                                {
                                    id: "control",
                                    shortLabel: "Control",
                                    text: "Which review decisions require the platform?",
                                    rationale: "Locate control.",
                                },
                            ],
                        },
                        eventBasis: {
                            kind: "public",
                            label: "The announcement",
                            readIds: [readId],
                        },
                    },
                },
            );
            expect(
                await dispatchFixtureOperation(f.t, {
                    requestId: editId,
                    expectedGeneration: 1,
                }),
            ).toMatchObject({
                kind: "refused",
                code: "framing_public_reference_undated",
            });
        }
    }
    expect(
        await f.client.query(api.framing.get, { runId: f.runId }),
    ).toMatchObject({ revision: 1, content: { scope: "", questions: [] } });
    expect(
        (await f.t.run((ctx) => ctx.db.get(f.runId)))?.sourcePreparationId,
    ).toBeUndefined();
    expect(network).not.toHaveBeenCalled();
    expect(dns).not.toHaveBeenCalled();
    expect(
        await f.t.run((ctx) =>
            ctx.db
                .query("providerCalls")
                .withIndex("by_run", (q) => q.eq("runId", f.runId))
                .collect(),
        ),
    ).toEqual([]);
});

test("paired Sources fixture pins both agents before preparation and reads native resources", async () => {
    const { getAgentDefinition } = await import(
        "@convex/execution/agentCatalog"
    );
    const { agentToolSchemas } = await import(
        "@convex/execution/agentDefinition"
    );
    const { buildMissionContext } = await import("@convex/execution/context");
    const f = await fixture(
        "sources_correction",
        undefined,
        undefined,
        undefined,
        "retained_control",
    );
    const state = await f.t.mutation(
        internal.qualificationInitialFixtureSetup.seed,
        f.args,
    );
    const mission = await f.t.run((ctx) => ctx.db.get(state.missionId));
    expect(mission?.definitionVersion).toBe(6);
    const conversation = await f.t.run((ctx) =>
        ctx.db
            .query("agentConversations")
            .withIndex("by_run", (q) => q.eq("runId", f.runId))
            .unique(),
    );
    expect(conversation?.definitionVersion).toBe(8);
    const control = getAgentDefinition("sources_v1", 6);
    const treatment = getAgentDefinition("sources_v1", 5);
    expect(control.context).toBe(treatment.context);
    expect(control.instructions).toContain(
        "Prepare each shared need by selecting relevant sources",
    );
    expect(control.instructions).not.toContain("<available_skills>");
    const context = await f.t.run((ctx) =>
        buildMissionContext(ctx, state.missionId, state.generation),
    );
    assert(context.kind === "ready");
    expect(agentToolSchemas(control, JSON.parse(context.inputJson))).toEqual(
        agentToolSchemas(treatment, JSON.parse(context.inputJson)),
    );
    const requestId = await f.t.mutation(
        internal.execution.operations.enqueue,
        {
            missionId: state.missionId,
            expectedGeneration: state.generation,
            cause: "read-control-method",
            input: {
                kind: "read",
                path: "/agent-skills/research-methods-v1/source-preparation/SKILL.md",
            },
        },
    );
    await dispatchFixtureOperation(f.t, {
        requestId,
        expectedGeneration: state.generation,
    });
    await f.t.action(internal.integrations.agentSkillReader.execute, {
        epoch: 1,
        requestId,
        expectedGeneration: state.generation,
    });
    const request = await f.t.run((ctx) => ctx.db.get(requestId));
    expect(request?.status).toBe("completed");
    assert(request?.outcome?.kind === "success");
    expect(JSON.parse(request.outcome.valueJson)).toMatchObject({
        packageId: "research-methods-v1",
        resourceHash: expect.stringMatching(/^[a-f0-9]{64}$/),
        text: expect.stringContaining("#"),
    });
    expect(
        await f.t.run((ctx) =>
            ctx.db
                .query("providerCalls")
                .withIndex("by_run", (q) => q.eq("runId", f.runId))
                .collect(),
        ),
    ).toEqual([]);
});

const frozenMethodCases: { scenarios: QualificationScenario[] } = JSON.parse(
    readFileSync(
        "scripts/evaluations/workbench-browser/fixtures/native-task-methods-20261119/cases.json",
        "utf8",
    ),
);
for (const scenario of frozenMethodCases.scenarios.filter(
    (s) => s.framingReplay,
)) {
    test.each([
        "retained_control",
        "native_skills",
    ] as const)(`${scenario.id}: %s receives the frozen historical or held-out observations`, async (method) => {
        assert(scenario.framingReplay && scenario.framingRequest);
        assert("documents" in scenario.framingReplay);
        const documents = scenario.framingReplay.documents;
        const f = await fixture(
            "sources_correction",
            [scenario.coveragePreset],
            scenario.framingRequest,
            scenario.framingReplay,
            method,
            scenario.company,
        );
        await f.t.mutation(internal.execution.fixtures.activateWorkbench, {
            runId: f.runId,
            fixtureKey: f.args.fixtureKey,
        });
        const active = await f.t.mutation(
            internal.execution.conversations.startTurn,
            {
                runId: f.runId,
                definitionId: "workbench_v1",
                scope: { kind: "workbench_v1" },
                simulation: true,
            },
        );
        assert(active);
        const message = await f.t.run((ctx) =>
            ctx.db
                .query("agentMessageDeliveries")
                .withIndex("by_turn", (q) => q.eq("turnId", active.turnId))
                .first(),
        );
        assert(message);
        const network = vi.fn<typeof fetch>(async () => {
            throw new Error("Frozen case accessed network");
        });
        vi.stubGlobal("fetch", network);
        const searchId = await f.t.mutation(
            internal.execution.operations.enqueue,
            {
                missionId: active.missionId,
                expectedGeneration: 1,
                cause: "frozen-search",
                input: {
                    kind: "search_public_context",
                    messageId: message._id,
                    query: "announcement workflow and relevant event",
                },
            },
        );
        const searched = await dispatchFixtureOperation(f.t, {
            requestId: searchId,
            expectedGeneration: 1,
        });
        if (scenario.framingReplay.unavailable)
            expect(searched).toMatchObject({
                kind: "unavailable",
                code: "missing_configuration",
            });
        else {
            assert(searched.kind === "success", JSON.stringify(searched));
            expect(
                JSON.parse(searched.valueJson).candidates.map(
                    (c: { url: string }) => c.url,
                ),
            ).toEqual(documents.map((d) => d.url));
            for (const [index, doc] of documents.entries()) {
                const requestId = await f.t.mutation(
                    internal.execution.operations.enqueue,
                    {
                        missionId: active.missionId,
                        expectedGeneration: 1,
                        cause: "frozen-read",
                        input: {
                            kind: "read_public_context",
                            messageId: message._id,
                            target: { kind: "candidate", searchId, index },
                        },
                    },
                );
                const read = await dispatchFixtureOperation(f.t, {
                    requestId,
                    expectedGeneration: 1,
                });
                assert(read.kind === "success", JSON.stringify(read));
                const value = JSON.parse(read.valueJson);
                expect(value.document.contentHash).toBe(sha256Hex(doc.text));
                expect(value.document.characters).toBe(doc.text.length);
                expect(doc.text).toContain(value.reference.excerpt);
                expect(value.replayCorpusHash).toBe(
                    scenario.framingReplay.materialHash,
                );
            }
        }
        expect(network).not.toHaveBeenCalled();
        expect(
            await f.t.run((ctx) => ctx.db.query("providerCalls").collect()),
        ).toEqual([]);
    });
}
