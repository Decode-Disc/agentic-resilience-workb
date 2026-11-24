/// <reference types="vite/client" />
import type { Id } from "@convex/_generated/dataModel";
import { clearShowcaseManifests } from "@convex/domain/showcaseManifest";
import { preparePassageReproduction } from "@convex/domain/sourcePassages";
import { executeEvidenceMatrixSeedPipeline } from "@convex/e2eFixtures";
import schema from "@convex/schema";
import { makeFunctionReference } from "convex/server";
import { convexTest } from "convex-test";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

import { buildCccShowcaseManifest } from "../../fixtures/evidence/ccc-showcase-manifest";
import rateLimiterTest from "../integrations/rate-limiter-test-register.js";
import workflowTest from "../workflows/workflow-test-register.js";

const modules = import.meta.glob("/convex/**/*.ts");
const originalE2eFixturesEnabled = process.env.E2E_FIXTURES_ENABLED;

const CCC_SHOWCASE_FIXTURE_ID = "ccc-showcase-claims";

const seedEvidenceMatrixScenario = makeFunctionReference<
    "action",
    {
        slotKey: string;
        fixtureKey: string;
        scenarioKind: "showcase" | "unavailable";
    },
    {
        runId: Id<"researchRuns">;
        corpusRevisionId: Id<"corpusRevisions">;
        sourceIds: Array<Id<"sources">>;
        scenarioKind: "showcase" | "unavailable";
        executionGeneration: number;
    }
>("e2eFixtures:seedEvidenceMatrixScenario");

// Intentionally widened ONLY in this test: proves that even a caller who
// fabricates the removed testFailureSeam field cannot execute it, because the
// real action validator rejects the extra field before the handler runs.
const seedEvidenceMatrixScenarioWithForbiddenField = makeFunctionReference<
    "action",
    {
        slotKey: string;
        fixtureKey: string;
        scenarioKind: "showcase" | "unavailable";
        testFailureSeam?: "post_upload_commit_failure";
    },
    {
        runId: Id<"researchRuns">;
        corpusRevisionId: Id<"corpusRevisions">;
        sourceIds: Array<Id<"sources">>;
        scenarioKind: "showcase" | "unavailable";
        executionGeneration: number;
    }
>("e2eFixtures:seedEvidenceMatrixScenario");

type EvidenceMatrixInspection = {
    runId: Id<"researchRuns">;
    fixtureKey: string;
    lifecycleState: string;
    executionStatus: string;
    pauseReason?: string;
    showcase: boolean;
    providerCallCount: number;
    workflowIdPresent: boolean;
    sourceCount: number;
    passageCount: number;
    claimCount: number;
    claimIds: Array<Id<"claims">>;
    claimStatements: Array<string>;
    policyEvaluationCount: number;
};

const inspectEvidenceMatrixScenario = makeFunctionReference<
    "query",
    { runId: Id<"researchRuns">; fixtureKey: string },
    EvidenceMatrixInspection
>("e2eFixtures:inspectEvidenceMatrixScenario");

const getNormalizedClaimInput = makeFunctionReference<
    "query",
    {
        runId: Id<"researchRuns">;
        executionGeneration: number;
    },
    { normalizedInput: any; inputHash: string } | null
>("claimGeneration:getNormalizedClaimInput");

beforeEach(() => {
    vi.stubEnv("CONVEX_CLOUD_URL", "http://127.0.0.1:3210");
});

afterEach(() => {
    vi.unstubAllEnvs();
    clearShowcaseManifests();
    if (originalE2eFixturesEnabled === undefined) {
        delete process.env.E2E_FIXTURES_ENABLED;
    } else {
        process.env.E2E_FIXTURES_ENABLED = originalE2eFixturesEnabled;
    }
    vi.useRealTimers();
    vi.unstubAllGlobals();
});

async function createAdmittedVisitor(
    t: ReturnType<typeof convexTest>,
    slotKey: string,
    options: { claimed: boolean } = { claimed: true },
) {
    return t.run(async (ctx) => {
        const userId = await ctx.db.insert("users", { isAnonymous: true });
        const invitationId = await ctx.db.insert("invitations", {
            slotKey,
            role: "analyst",
            codeDigest: `digest-${slotKey}`,
            status: options.claimed ? "claimed" : "available",
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
        if (options.claimed) {
            await ctx.db.patch(invitationId, {
                claimedByVisitorId: visitorId,
                claimedAt: 1,
            });
        }
        if (slotKey === "analyst-4" && options.claimed)
            await ctx.db.insert("browserTestContexts", {
                ownerVisitorId: visitorId,
                authUserId: userId,
                contextKey: "evidence-unit",
                status: "active",
                expiresAt: Date.now() + 2 * 60 * 60 * 1000,
                createdAt: Date.now(),
            });
        return { userId, invitationId, visitorId };
    });
}

function createHarness() {
    const t = convexTest(schema, modules);
    workflowTest.register(t);
    rateLimiterTest.register(t);
    return t;
}

test("rejects evidence matrix fixtures when the E2E gate is disabled", async () => {
    vi.useFakeTimers();
    process.env.E2E_FIXTURES_ENABLED = "true";
    const t = createHarness();
    await createAdmittedVisitor(t, "analyst-4");

    const seeded = await t.action(seedEvidenceMatrixScenario, {
        slotKey: "analyst-4",
        fixtureKey: "evidence-matrix-disabled",
        scenarioKind: "showcase",
    });
    // Drain the real workflow before disabling the gate so no orphan
    // scheduled run pollutes later tests in this shared scheduler.
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    delete process.env.E2E_FIXTURES_ENABLED;

    await expect(
        t.action(seedEvidenceMatrixScenario, {
            slotKey: "analyst-4",
            fixtureKey: "evidence-matrix-disabled",
            scenarioKind: "showcase",
        }),
    ).rejects.toThrow("E2E fixtures are disabled");
    await expect(
        t.query(inspectEvidenceMatrixScenario, {
            runId: seeded.runId,
            fixtureKey: "evidence-matrix-disabled",
        }),
    ).rejects.toThrow("E2E fixtures are disabled");
});

test("rejects an unknown or unclaimed invitation slot", async () => {
    process.env.E2E_FIXTURES_ENABLED = "true";
    const t = createHarness();
    await createAdmittedVisitor(t, "analyst-4", {
        claimed: false,
    });

    await expect(
        t.action(seedEvidenceMatrixScenario, {
            slotKey: "analyst-4",
            fixtureKey: "evidence-matrix-unclaimed",
            scenarioKind: "unavailable",
        }),
    ).rejects.toThrow("Claimed E2E invitation not found");
    await expect(
        t.action(seedEvidenceMatrixScenario, {
            slotKey: "no-such-slot",
            fixtureKey: "evidence-matrix-unknown-slot",
            scenarioKind: "unavailable",
        }),
    ).rejects.toThrow("Claimed E2E invitation not found");
});

test("showcase scenario runs the real Phase 5 workflow to evidence_ready with persisted claims and policy", async () => {
    vi.useFakeTimers();
    process.env.E2E_FIXTURES_ENABLED = "true";
    const t = createHarness();
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    await createAdmittedVisitor(t, "analyst-4");

    const seeded = await t.action(seedEvidenceMatrixScenario, {
        slotKey: "analyst-4",
        fixtureKey: "evidence-matrix-showcase",
        scenarioKind: "showcase",
    });
    expect(seeded.scenarioKind).toBe("showcase");
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    const inspection = await t.query(inspectEvidenceMatrixScenario, {
        runId: seeded.runId,
        fixtureKey: "evidence-matrix-showcase",
    });
    expect(inspection).toMatchObject({
        lifecycleState: "evidence_ready",
        executionStatus: "idle",
        showcase: true,
        providerCallCount: 0,
        workflowIdPresent: false,
        sourceCount: 1,
        passageCount: 4,
        claimCount: 4,
        policyEvaluationCount: 4,
    });
    expect(fetchSpy).not.toHaveBeenCalled();

    const input = await t.query(getNormalizedClaimInput, {
        runId: seeded.runId,
        executionGeneration: seeded.executionGeneration,
    });
    if (!input) throw new Error("expected normalized claim input");

    const expected = buildCccShowcaseManifest(input.normalizedInput);
    expect(expected.inputHash).toBe(input.inputHash);
    expect([...inspection.claimStatements].sort()).toEqual(
        [...expected.claims.map((claim) => claim.statement)].sort(),
    );
    expect(inspection.claimIds).toHaveLength(4);

    await t.run(async (ctx) => {
        const tasks = await ctx.db
            .query("aiTaskResults")
            .withIndex("by_run", (query) => query.eq("runId", seeded.runId))
            .take(10);
        expect(tasks).toHaveLength(1);
        expect(tasks[0]).toMatchObject({
            executionMode: "showcase",
            fixtureId: CCC_SHOWCASE_FIXTURE_ID,
        });
        const providerCalls = await ctx.db.query("providerCalls").take(100);
        expect(providerCalls).toHaveLength(0);
        const manifestRows = await ctx.db
            .query("showcaseManifestEntries")
            .withIndex("by_input_hash", (query) =>
                query.eq("inputHash", input.inputHash),
            )
            .take(5);
        expect(manifestRows).toHaveLength(1);

        const versions = await ctx.db
            .query("sourceVersions")
            .withIndex("by_run", (query) => query.eq("runId", seeded.runId))
            .take(5);
        expect(versions).toHaveLength(1);
        const firstVersion = versions[0];
        if (!firstVersion) throw new Error("expected a source version");
        const blob = await ctx.storage.get(firstVersion.storageId);
        if (!blob) throw new Error("expected a stored artifact");
        const artifact = new Uint8Array(await blob.arrayBuffer());
        const passages = await ctx.db
            .query("sourcePassages")
            .withIndex("by_source_version_and_order", (query) =>
                query.eq("sourceVersionId", firstVersion._id),
            )
            .take(10);
        expect(passages).toHaveLength(4);
        const reproduce = preparePassageReproduction(artifact);
        for (const passage of passages) {
            const reproduced = reproduce(passage.locator);
            expect(reproduced).toBe(passage.exactQuotation);
        }

        const claims = await ctx.db
            .query("claims")
            .withIndex("by_run", (query) => query.eq("runId", seeded.runId))
            .take(130);
        const evidence = await ctx.db.query("claimEvidence").take(200);
        const links = await ctx.db.query("claimDimensionLinks").take(200);
        expect(claims.length).toBe(4);
        expect(evidence.length).toBeGreaterThanOrEqual(4);
        expect(links.length).toBeGreaterThanOrEqual(4);
        for (const link of links) {
            expect(link.origin).toBe("generated");
            expect((link as { decision?: unknown }).decision).toBeUndefined();
        }

        const events = await ctx.db
            .query("runEvents")
            .withIndex("by_run_and_sequence", (query) =>
                query.eq("runId", seeded.runId),
            )
            .take(65);
        expect(events.some((event) => event.type === "evidence_ready")).toBe(
            true,
        );
        expect(
            events.some((event) => event.type === "claim_generation_paused"),
        ).toBe(false);
    });
});

test("idempotent replay does not duplicate runs, artifacts, claims, policy, events, or workflows", async () => {
    vi.useFakeTimers();
    process.env.E2E_FIXTURES_ENABLED = "true";
    const t = createHarness();
    await createAdmittedVisitor(t, "analyst-4");

    const args = {
        slotKey: "analyst-4",
        fixtureKey: "evidence-matrix-replay",
        scenarioKind: "showcase" as const,
    };
    const first = await t.action(seedEvidenceMatrixScenario, args);
    const second = await t.action(seedEvidenceMatrixScenario, args);
    expect(second).toEqual(first);

    const snapshotCounts = async (runId: Id<"researchRuns">) =>
        t.run(async (ctx) => {
            const firstRun = await ctx.db.get(runId);
            if (!firstRun) throw new Error("Expected first run");
            const runs = await ctx.db
                .query("researchRuns")
                .withIndex("by_owner_and_reservation_key", (query) =>
                    query
                        .eq("ownerVisitorId", firstRun.ownerVisitorId)
                        .eq(
                            "reservationKey",
                            `e2e:${firstRun.browserTestContextId}:evidence-matrix-replay:showcase`,
                        ),
                )
                .collect();
            const sourceVersions = await ctx.db
                .query("sourceVersions")
                .withIndex("by_run", (query) => query.eq("runId", runId))
                .take(10);
            const claims = await ctx.db
                .query("claims")
                .withIndex("by_run", (query) => query.eq("runId", runId))
                .take(130);
            const statuses = await ctx.db
                .query("evidenceSourceStatuses")
                .withIndex("by_run_and_execution_generation", (query) =>
                    query.eq("runId", runId),
                )
                .take(60);
            const events = await ctx.db
                .query("runEvents")
                .withIndex("by_run_and_sequence", (query) =>
                    query.eq("runId", runId),
                )
                .take(65);
            const tasks = await ctx.db
                .query("aiTaskResults")
                .withIndex("by_run", (query) => query.eq("runId", runId))
                .take(10);
            const evaluations = await ctx.db
                .query("policyEvaluations")
                .withIndex("by_run", (query) => query.eq("runId", runId))
                .take(130);
            const manifests = await ctx.db
                .query("showcaseManifestEntries")
                .take(20);
            const providerCalls = await ctx.db.query("providerCalls").take(100);
            const storage = await ctx.db.system.query("_storage").take(100);
            return {
                runReservationCount: runs.length,
                sourceVersionCount: sourceVersions.length,
                claimCount: claims.length,
                statusCount: statuses.length,
                eventCount: events.length,
                aiTaskResultCount: tasks.length,
                policyEvaluationCount: evaluations.length,
                manifestRowCount: manifests.length,
                providerCallCount: providerCalls.length,
                storageCount: storage.length,
            };
        });

    await t.finishAllScheduledFunctions(vi.runAllTimers);
    const countsAfterWorkflow = await snapshotCounts(first.runId);
    expect(countsAfterWorkflow).toMatchObject({
        runReservationCount: 1,
        sourceVersionCount: 1,
        claimCount: 4,
        aiTaskResultCount: 1,
        policyEvaluationCount: 4,
        providerCallCount: 0,
        manifestRowCount: 1,
        storageCount: 1,
    });

    const third = await t.action(seedEvidenceMatrixScenario, args);
    expect(third.runId).toBe(first.runId);
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    const countsAfterReplay = await snapshotCounts(first.runId);
    expect(countsAfterReplay).toEqual(countsAfterWorkflow);
});

test("unavailable scenario pauses at claim_generation_unavailable with zero claims and no Assessment unlock", async () => {
    vi.useFakeTimers();
    process.env.E2E_FIXTURES_ENABLED = "true";
    const t = createHarness();
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    await createAdmittedVisitor(t, "analyst-4");

    const seeded = await t.action(seedEvidenceMatrixScenario, {
        slotKey: "analyst-4",
        fixtureKey: "evidence-matrix-unavailable",
        scenarioKind: "unavailable",
    });
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    const inspection = await t.query(inspectEvidenceMatrixScenario, {
        runId: seeded.runId,
        fixtureKey: "evidence-matrix-unavailable",
    });
    expect(inspection).toMatchObject({
        lifecycleState: "extracting_evidence",
        executionStatus: "paused",
        pauseReason: "claim_generation_unavailable",
        showcase: false,
        providerCallCount: 0,
        workflowIdPresent: false,
        claimCount: 0,
        policyEvaluationCount: 0,
    });
    expect(inspection.sourceCount).toBeGreaterThan(0);
    expect(inspection.passageCount).toBeGreaterThan(0);
    expect(fetchSpy).not.toHaveBeenCalled();

    await t.run(async (ctx) => {
        const claims = await ctx.db.query("claims").take(130);
        expect(claims).toHaveLength(0);
        const tasks = await ctx.db.query("aiTaskResults").take(10);
        expect(tasks).toHaveLength(0);
        const evaluations = await ctx.db.query("policyEvaluations").take(130);
        expect(evaluations).toHaveLength(0);
        const manifestRows = await ctx.db
            .query("showcaseManifestEntries")
            .take(20);
        expect(manifestRows).toHaveLength(0);
        const providerCalls = await ctx.db.query("providerCalls").take(100);
        expect(providerCalls).toHaveLength(0);

        const run = await ctx.db.get(seeded.runId);
        expect(run?.lifecycleState).not.toBe("evidence_ready");
        expect(run?.lifecycleState).not.toBe("assessing_dimensions");
        expect(run?.executionStatus).toBe("paused");

        const events = await ctx.db
            .query("runEvents")
            .withIndex("by_run_and_sequence", (query) =>
                query.eq("runId", seeded.runId),
            )
            .take(65);
        expect(
            events.some((event) => event.type === "claim_generation_paused"),
        ).toBe(true);
        expect(events.some((event) => event.type === "evidence_ready")).toBe(
            false,
        );
    });

    const statusRows = await t.run(async (ctx) =>
        ctx.db
            .query("evidenceSourceStatuses")
            .withIndex("by_run_and_execution_generation", (query) =>
                query
                    .eq("runId", seeded.runId)
                    .eq("executionGeneration", seeded.executionGeneration),
            )
            .take(60),
    );
    expect(statusRows.length).toBeGreaterThan(0);
    expect(
        statusRows.every(
            (status) =>
                status.status === "succeeded" || status.status === "partial",
        ),
    ).toBe(true);
});

test("rejects conflicting scenario replay in both directions", async () => {
    vi.useFakeTimers();
    process.env.E2E_FIXTURES_ENABLED = "true";
    const t = createHarness();
    await createAdmittedVisitor(t, "analyst-4");

    // Direction 1: showcase then unavailable
    const firstShowcase = await t.action(seedEvidenceMatrixScenario, {
        slotKey: "analyst-4",
        fixtureKey: "evidence-matrix-mismatch-1",
        scenarioKind: "showcase",
    });
    expect(firstShowcase.scenarioKind).toBe("showcase");
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    await expect(
        t.action(seedEvidenceMatrixScenario, {
            slotKey: "analyst-4",
            fixtureKey: "evidence-matrix-mismatch-1",
            scenarioKind: "unavailable",
        }),
    ).rejects.toThrow(/conflicting/i);

    // Direction 2: unavailable then showcase
    const firstUnavailable = await t.action(seedEvidenceMatrixScenario, {
        slotKey: "analyst-4",
        fixtureKey: "evidence-matrix-mismatch-2",
        scenarioKind: "unavailable",
    });
    expect(firstUnavailable.scenarioKind).toBe("unavailable");
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    await expect(
        t.action(seedEvidenceMatrixScenario, {
            slotKey: "analyst-4",
            fixtureKey: "evidence-matrix-mismatch-2",
            scenarioKind: "showcase",
        }),
    ).rejects.toThrow(/conflicting/i);
});

test("concurrent same-scenario replay over production pipeline yields one canonical run and deletes loser storage blob", async () => {
    let blobCounter = 0;
    const storedBlobs = new Set<Id<"_storage">>();
    const deletedBlobs = new Set<Id<"_storage">>();
    const commitAttempts: Array<{
        storageId: Id<"_storage">;
        contentHash: string;
        byteCount: number;
    }> = [];

    const canonicalRunId = "run-concurrent-canonical" as Id<"researchRuns">;
    const canonicalCorpusRevisionId =
        "rev-concurrent-canonical" as Id<"corpusRevisions">;
    const canonicalSourceIds = ["source-concurrent-1" as Id<"sources">];

    const storeBlob = vi.fn(async (_blob: Blob) => {
        blobCounter += 1;
        const id = `blob-concurrent-${blobCounter}` as Id<"_storage">;
        storedBlobs.add(id);
        return id;
    });

    const deleteBlob = vi.fn(async (storageId: Id<"_storage">) => {
        storedBlobs.delete(storageId);
        deletedBlobs.add(storageId);
    });

    let firstCommitProcessed = false;
    const commitSeed = vi.fn(
        async (args: {
            slotKey: string;
            fixtureKey: string;
            scenarioKind: "showcase" | "unavailable";
            storageId: Id<"_storage">;
            contentHash: string;
            byteCount: number;
        }) => {
            commitAttempts.push({
                storageId: args.storageId,
                contentHash: args.contentHash,
                byteCount: args.byteCount,
            });

            if (!firstCommitProcessed) {
                firstCommitProcessed = true;
                return {
                    runId: canonicalRunId,
                    corpusRevisionId: canonicalCorpusRevisionId,
                    sourceIds: canonicalSourceIds,
                    scenarioKind: args.scenarioKind,
                    executionGeneration: 1,
                    reused: false,
                };
            }

            return {
                runId: canonicalRunId,
                corpusRevisionId: canonicalCorpusRevisionId,
                sourceIds: canonicalSourceIds,
                scenarioKind: args.scenarioKind,
                executionGeneration: 1,
                reused: true,
            };
        },
    );

    const pipelineArgs = {
        slotKey: "e2e-evidence-concurrent",
        fixtureKey: "evidence-matrix-concurrent",
        scenarioKind: "showcase" as const,
    };

    const [first, second] = await Promise.all([
        executeEvidenceMatrixSeedPipeline(pipelineArgs, {
            storeBlob,
            deleteBlob,
            commitSeed,
        }),
        executeEvidenceMatrixSeedPipeline(pipelineArgs, {
            storeBlob,
            deleteBlob,
            commitSeed,
        }),
    ]);

    expect(first).toEqual({
        runId: canonicalRunId,
        corpusRevisionId: canonicalCorpusRevisionId,
        sourceIds: canonicalSourceIds,
        scenarioKind: "showcase",
        executionGeneration: 1,
    });
    expect(second).toEqual(first);

    expect(storeBlob).toHaveBeenCalledTimes(2);
    expect(commitAttempts).toHaveLength(2);
    const firstUploadedBlob = commitAttempts[0]?.storageId;
    const secondUploadedBlob = commitAttempts[1]?.storageId;
    expect(firstUploadedBlob).toBe("blob-concurrent-1");
    expect(secondUploadedBlob).toBe("blob-concurrent-2");

    expect(deleteBlob).toHaveBeenCalledTimes(1);
    expect(deleteBlob).toHaveBeenCalledWith(secondUploadedBlob);
    expect(deletedBlobs.has(secondUploadedBlob as Id<"_storage">)).toBe(true);
    expect(storedBlobs.size).toBe(1);
    expect(storedBlobs.has(firstUploadedBlob as Id<"_storage">)).toBe(true);

    expect(commitSeed).toHaveBeenCalledTimes(2);
});

test("validator rejects an extra testFailureSeam field instead of executing it", async () => {
    vi.useFakeTimers();
    process.env.E2E_FIXTURES_ENABLED = "true";
    const t = createHarness();
    await createAdmittedVisitor(t, "analyst-4");

    await expect(
        t.action(seedEvidenceMatrixScenarioWithForbiddenField, {
            slotKey: "analyst-4",
            fixtureKey: "evidence-matrix-extra-field",
            scenarioKind: "showcase",
            testFailureSeam: "post_upload_commit_failure",
        }),
    ).rejects.toThrow(/Unexpected field .testFailureSeam. in object/);

    // The handler never ran: no run was inserted and no storage blob was
    // uploaded, so a fabricated failure seam cannot touch the backend.
    await t.run(async (ctx) => {
        const runs = await ctx.db.query("researchRuns").collect();
        expect(runs).toHaveLength(0);
    });
    const storage = await t.run(async (ctx) =>
        ctx.db.system.query("_storage").collect(),
    );
    expect(storage).toHaveLength(0);
});

test("pipeline deletes the stored blob on commit failure and rethrows the exact original error", async () => {
    const storedBlobId = "blob-commit-fail" as Id<"_storage">;
    const storeBlob = vi.fn().mockResolvedValue(storedBlobId);
    const deleteBlob = vi.fn().mockResolvedValue(undefined);
    const originalError = new Error("Database transaction conflict");
    const commitSeed = vi.fn().mockRejectedValue(originalError);

    let caught: unknown;
    try {
        await executeEvidenceMatrixSeedPipeline(
            {
                slotKey: "e2e-slot-commit-fail",
                fixtureKey: "e2e-fixture-commit-fail",
                scenarioKind: "showcase",
            },
            { storeBlob, deleteBlob, commitSeed },
        );
    } catch (error) {
        caught = error;
    }

    // The exact original commit error is rethrown, not a re-wrapped one.
    expect(caught).toBe(originalError);
    expect(deleteBlob).toHaveBeenCalledTimes(1);
    expect(deleteBlob).toHaveBeenCalledWith(storedBlobId);
    expect(storeBlob).toHaveBeenCalledTimes(1);
});

test("ownership derives only from the claimed invitation slot; inspector rejects a fixture key mismatch", async () => {
    vi.useFakeTimers();
    process.env.E2E_FIXTURES_ENABLED = "true";
    const t = createHarness();
    const slotA = await createAdmittedVisitor(t, "analyst-4");
    const slotB = await createAdmittedVisitor(t, "e2e-evidence-owner-b");

    const seeded = await t.action(seedEvidenceMatrixScenario, {
        slotKey: "analyst-4",
        fixtureKey: "evidence-matrix-owner",
        scenarioKind: "showcase",
    });
    const run = await t.run(async (ctx) => ctx.db.get(seeded.runId));
    expect(run?.ownerVisitorId).toBe(slotA.visitorId);
    expect(run?.reservationKey).toBe(
        `e2e:${run?.browserTestContextId}:evidence-matrix-owner:showcase`,
    );

    await expect(
        t.action(seedEvidenceMatrixScenario, {
            slotKey: "e2e-evidence-owner-b",
            fixtureKey: "evidence-matrix-owner-b",
            scenarioKind: "unavailable",
        }),
    ).rejects.toThrow("Active browser test context required");
    expect(slotA.visitorId).not.toBe(slotB.visitorId);
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    await expect(
        t.query(inspectEvidenceMatrixScenario, {
            runId: seeded.runId,
            fixtureKey: "evidence-matrix-owner-b",
        }),
    ).rejects.toThrow(/not found/i);
    expect(
        await t.run((ctx) =>
            ctx.db
                .query("researchRuns")
                .withIndex("by_owner_and_execution_status", (q) =>
                    q.eq("ownerVisitorId", slotB.visitorId),
                )
                .collect(),
        ),
    ).toEqual([]);
});

test("reuse cleanup failure is observable and throws explicit cleanup error", async () => {
    const storeBlob = vi.fn().mockResolvedValue("blob-123" as Id<"_storage">);
    const deleteBlob = vi
        .fn()
        .mockRejectedValue(new Error("Storage service unavailable"));
    const commitSeed = vi.fn().mockResolvedValue({
        runId: "run-1" as Id<"researchRuns">,
        corpusRevisionId: "rev-1" as Id<"corpusRevisions">,
        sourceIds: ["source-1" as Id<"sources">],
        scenarioKind: "showcase" as const,
        executionGeneration: 1,
        reused: true,
    });

    await expect(
        executeEvidenceMatrixSeedPipeline(
            {
                slotKey: "e2e-slot",
                fixtureKey: "e2e-fixture",
                scenarioKind: "showcase",
            },
            {
                storeBlob,
                deleteBlob,
                commitSeed,
            },
        ),
    ).rejects.toThrow(
        "Failed to clean up duplicate storage blob on scenario reuse: Storage service unavailable",
    );
    expect(deleteBlob).toHaveBeenCalledWith("blob-123");
});

test("commit failure cleanup preserves original commit error while attaching cleanup failure evidence", async () => {
    const storeBlob = vi.fn().mockResolvedValue("blob-456" as Id<"_storage">);
    const deleteBlob = vi
        .fn()
        .mockRejectedValue(new Error("Storage delete network timeout"));
    const commitSeed = vi
        .fn()
        .mockRejectedValue(new Error("Database transaction conflict"));

    let caughtError: unknown;
    try {
        await executeEvidenceMatrixSeedPipeline(
            {
                slotKey: "e2e-slot",
                fixtureKey: "e2e-fixture",
                scenarioKind: "showcase",
            },
            {
                storeBlob,
                deleteBlob,
                commitSeed,
            },
        );
    } catch (err) {
        caughtError = err;
    }

    expect(caughtError).toBeInstanceOf(Error);
    expect((caughtError as Error).message).toBe(
        "Database transaction conflict",
    );
    expect(
        (caughtError as Error & { cleanupError?: string }).cleanupError,
    ).toBe("Storage delete network timeout");
    expect(deleteBlob).toHaveBeenCalledWith("blob-456");
});
