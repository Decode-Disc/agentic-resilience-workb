import { internal } from "@convex/_generated/api";
import { recordContextObservation } from "@convex/execution/journal";
import {
    appendRetainedText,
    finalizeRetainedTextStream,
    retainedTextParts,
    stageOperationObservation,
    stageRetainedText,
} from "@convex/execution/retainedText";
import { extractObservedDestinations } from "@convex/integrations/evidenceNormalization";
import { DOSSIER_PURGE_BATCH } from "@convex/resourcePolicy";
import { afterEach, assert, expect, test, vi } from "vitest";
import {
    recordDocumentaryRead,
    seedCapturedSources,
} from "@/__tests__/setup/sources-mission";

import { seedWorkbench } from "@/__tests__/setup/workbench";

afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
});

const runOwned = [
    "sources",
    "sourceCaptures",
    "corpusRevisions",
    "sourceSelectionProposalRebuilds",
    "agentMissions",
    "agentOperationRequests",
    "aiTaskResults",
    "runEvents",
] as const;

test("a research dossier purge removes its owned records and stored captures, restores its analysis and keeps an audit trail", async () => {
    const f = await seedCapturedSources();
    const before = await f.t.run(async (ctx) => {
        const capture = await ctx.db.get(f.captureId);
        await ctx.db.patch(f.runId, { reservationStatus: "consumed" });
        const run = await ctx.db.get(f.runId);
        if (!run?.ownerVisitorId) throw new Error("fixture owner");
        await ctx.db.patch(run.ownerVisitorId, { analysesReserved: 1 });
        return { storageId: capture?.storageId, owner: run.ownerVisitorId };
    });
    expect(before.storageId).toBeDefined();
    const other = await f.t.run(async (ctx) => {
        const run = await ctx.db.get(f.runId);
        const source = await ctx.db.get(f.sourceId);
        assert(run && source);
        const { _id: _runId, _creationTime: _runCreatedAt, ...runFields } = run;
        const runId = await ctx.db.insert("researchRuns", {
            ...runFields,
            reservationStatus: undefined,
        });
        const {
            _id: _sourceId,
            _creationTime: _sourceCreatedAt,
            ...sourceFields
        } = source;
        const sourceId = await ctx.db.insert("sources", {
            ...sourceFields,
            runId,
        });
        const requestId = await ctx.db.insert("agentOperationRequests", {
            runId,
            actor: "system",
            cause: "unrelated-observation",
            logicalKey: "unrelated-observation",
            input: { kind: "consult_run_state" },
            operationVersion: 1,
            expectedGeneration: 3,
            status: "completed",
            createdAt: 1,
        });
        const content = "Keep the other dossier’s retained observation";
        const { manifest } = retainedTextParts(content);
        await stageOperationObservation(ctx, requestId, {
            ...manifest,
            index: 0,
            content,
        });
        const text = await ctx.db
            .query("retainedTexts")
            .withIndex("by_key", (q) =>
                q.eq("key", `operation:${requestId}:observation`),
            )
            .unique();
        assert(text);
        return { runId, sourceId, requestId, textId: text._id, content };
    });

    const result = await f.t.action(
        internal.dossierPurge.purgeResearchDossiers,
        { runIds: [f.runId], reason: "Retired corpus-review dossier cleanup" },
    );
    expect(result).toEqual([expect.objectContaining({ runId: f.runId })]);

    await f.t.run(async (ctx) => {
        expect(await ctx.db.get(f.runId)).toBeNull();
        for (const table of runOwned) {
            const rows = await ctx.db.query(table).collect();
            expect(
                rows.filter((row) => "runId" in row && row.runId === f.runId),
                table,
            ).toEqual([]);
        }
        expect(
            await ctx.db
                .query("sourceSearchPassages")
                .withIndex("by_scope_capture_order", (q) =>
                    q
                        .gte("scopeKey", `${f.runId}:`)
                        .lt("scopeKey", `${f.runId};`),
                )
                .collect(),
        ).toEqual([]);
        if (before.storageId)
            expect(await ctx.storage.get(before.storageId)).toBeNull();
        expect(await ctx.db.get(other.runId)).not.toBeNull();
        expect(await ctx.db.get(other.sourceId)).toMatchObject({
            runId: other.runId,
        });
        expect(await ctx.db.get(other.requestId)).toMatchObject({
            runId: other.runId,
        });
        expect(
            await ctx.db
                .query("retainedTextFragments")
                .withIndex("by_text_and_index", (q) =>
                    q.eq("textId", other.textId).eq("index", 0),
                )
                .unique(),
        ).toMatchObject({ content: other.content });
        expect(await ctx.db.get(before.owner)).toMatchObject({
            analysesReserved: 0,
        });
        expect(
            await ctx.db
                .query("auditEvents")
                .withIndex("by_target", (q) =>
                    q.eq("targetType", "research_run").eq("targetId", f.runId),
                )
                .collect(),
        ).toContainEqual(
            expect.objectContaining({
                action: "dossier_purged",
                reason: "Retired corpus-review dossier cleanup",
            }),
        );
    });
});

test("only analyst research dossiers can be purged", async () => {
    const f = await seedCapturedSources();
    await f.t.run((ctx) => ctx.db.patch(f.runId, { purpose: "evaluation" }));
    await expect(
        f.t.action(internal.dossierPurge.purgeResearchDossiers, {
            runIds: [f.runId],
            reason: "Retired corpus-review dossier cleanup",
        }),
    ).rejects.toThrow("Only analyst research dossiers can be purged");
    expect(await f.t.run((ctx) => ctx.db.get(f.runId))).not.toBeNull();
});

test("purging a dossier removes the retained text owned by its operation requests", async () => {
    const f = await seedCapturedSources();
    const { operationId, textId } = await f.t.run(async (ctx) => {
        const operationId = await recordDocumentaryRead(ctx, {
            runId: f.runId,
            captureId: f.captureId,
            evidence: [],
        });
        const retained = retainedTextParts(
            "Retained evidence with a second page. ".repeat(5000),
        );
        for (const [index, content] of retained.parts.entries())
            await stageOperationObservation(ctx, operationId, {
                ...retained.manifest,
                index,
                content,
            });
        const text = await ctx.db
            .query("retainedTexts")
            .withIndex("by_key", (q) =>
                q.eq("key", `operation:${operationId}:observation`),
            )
            .unique();
        if (!text) throw new Error("fixture retained text");
        return { operationId, textId: text._id };
    });
    await f.t.action(internal.dossierPurge.purgeResearchDossiers, {
        runIds: [f.runId],
        reason: "Remove operation-owned retained evidence",
    });
    await f.t.run(async (ctx) => {
        expect(await ctx.db.get(operationId)).toBeNull();
        expect(await ctx.db.get(textId)).toBeNull();
        expect(
            await ctx.db
                .query("retainedTextFragments")
                .withIndex("by_text_and_index", (q) => q.eq("textId", textId))
                .first(),
        ).toBeNull();
    });
});

test("purging an invocation removes its private diagnostic fragments and preserves shared immutable text", async () => {
    const f = await seedCapturedSources();
    const diagnostic = await f.t.run(async (ctx) => {
        const invocationId = await ctx.db.insert("agentInvocations", {
            runId: f.runId,
            generation: 4,
            definitionVersion: 1,
            taskKey: "purge-capture",
            status: "started",
            provenance: "live",
            inputJson: "{}",
            createdAt: Date.now(),
        });
        const textId = await appendRetainedText(
            ctx,
            `${invocationId}:visible`,
            0,
            "private prefix",
        );
        const text = await finalizeRetainedTextStream(ctx, textId);
        await ctx.db.patch(invocationId, {
            visibleOutput: {
                textId,
                complete: false,
                contentHash: text.contentHash,
                sizeBytes: text.sizeBytes,
            },
        });
        const sharedId = await appendRetainedText(
            ctx,
            "other-owner",
            0,
            "preserved",
        );
        return { textId, sharedId };
    });
    await f.t.action(internal.dossierPurge.purgeResearchDossiers, {
        runIds: [f.runId],
        reason: "Remove private diagnostic ownership",
    });
    await f.t.run(async (ctx) => {
        expect(await ctx.db.get(diagnostic.textId)).toBeNull();
        expect(
            await ctx.db
                .query("retainedTextFragments")
                .withIndex("by_text_and_index", (q) =>
                    q.eq("textId", diagnostic.textId),
                )
                .collect(),
        ).toEqual([]);
        expect(await ctx.db.get(diagnostic.sharedId)).not.toBeNull();
    });
});

test("purge reaches execution children beyond two empty parent batches", async () => {
    const f = await seedCapturedSources();
    const owned = await f.t.run(async (ctx) => {
        const originalMission = await ctx.db.get(f.missionId);
        assert(originalMission);
        const { _id, _creationTime, ...mission } = originalMission;
        const parents = 2 * DOSSIER_PURGE_BATCH + 1;
        let missionId = _id;
        for (let index = 0; index < parents; index++)
            missionId = await ctx.db.insert("agentMissions", {
                ...mission,
                status: "completed",
                requestKey: `purge-mission:${index}`,
            });
        let invocationId = await ctx.db.insert("agentInvocations", {
            runId: f.runId,
            generation: 4,
            definitionVersion: 1,
            taskKey: "000",
            status: "returned",
            provenance: "simulation",
            inputJson: "{}",
            createdAt: 1,
        });
        for (let index = 1; index < parents; index++)
            invocationId = await ctx.db.insert("agentInvocations", {
                runId: f.runId,
                generation: 4,
                definitionVersion: 1,
                taskKey: index.toString().padStart(3, "0"),
                status: "returned",
                provenance: "simulation",
                inputJson: "{}",
                createdAt: 1,
            });
        const sessionId = await ctx.db.insert("piSessions", {
            missionId,
            generation: 4,
            writer: "old-writer",
            epoch: 1,
            leaseUntil: 0,
            sequence: 1,
            nextId: 2,
        });
        const staged = retainedTextParts("retained execution bytes");
        const fragment = {
            ...staged.manifest,
            index: 0,
            content: staged.parts[0] ?? "",
        };
        const commitText = await stageRetainedText(
            ctx,
            `${sessionId}:commit`,
            fragment,
        );
        const unpublishedCommit = await stageRetainedText(
            ctx,
            `${sessionId}:unpublished`,
            fragment,
        );
        const commitId = await ctx.db.insert("piCommits", {
            sessionId,
            key: "commit",
            sequence: 1,
            textId: commitText,
        });
        const replyText = await stageRetainedText(
            ctx,
            `${invocationId}:reply`,
            fragment,
        );
        const unpublishedRequest = await stageRetainedText(
            ctx,
            `${invocationId}:request`,
            fragment,
        );
        const unpublishedResponse = await stageRetainedText(
            ctx,
            `${invocationId}:response:${staged.manifest.contentHash}`,
            fragment,
        );
        const unpublishedRaw = await stageRetainedText(
            ctx,
            `${invocationId}:raw_output`,
            fragment,
        );
        const payloadId = await ctx.db.insert("agentInvocationPayloads", {
            invocationId,
            runId: f.runId,
            version: 1,
            part: "reply",
            state: "complete",
            contentHash: staged.manifest.contentHash,
            sizeBytes: staged.manifest.sizeBytes,
            textId: replyText,
            createdAt: 1,
        });
        const lateInvocationId = await ctx.db.insert("agentInvocations", {
            runId: f.runId,
            generation: 4,
            definitionVersion: 1,
            taskKey: "late-observation",
            status: "started",
            provenance: "simulation",
            inputJson: "{}",
            createdAt: 1,
        });
        return {
            lateInvocationId,
            sessionId,
            commitId,
            payloadId,
            texts: [
                commitText,
                unpublishedCommit,
                replyText,
                unpublishedRequest,
                unpublishedResponse,
                unpublishedRaw,
            ],
        };
    });
    const eventId = await f.t.run((ctx) =>
        recordContextObservation(ctx, f.runId, {
            key: "context-purge",
            topic: "research",
            actor: { type: "system" },
            value: { retained: true },
        }),
    );
    const event = await f.t.run((ctx) => ctx.db.get(eventId));
    assert(event?.contextObservation);
    owned.texts.push(event.contextObservation.textId);
    const lease = await f.t.mutation(internal.execution.piStore.claim, {
        missionId: f.missionId,
        expectedGeneration: 4,
        writer: "before-purge",
    });
    await f.t.mutation(internal.dossierPurge.beginPurge, {
        runId: f.runId,
        reason: "Remove all later execution children",
    });
    const retained = retainedTextParts("late");
    await expect(
        f.t.mutation(internal.execution.piStore.stageCommit, {
            ...lease,
            key: "late",
            fragment: { ...retained.manifest, index: 0, content: "late" },
        }),
    ).rejects.toThrow(/pi_writer_fenced|not_authorized/);
    await expect(
        f.t.mutation(internal.execution.invocations.retainOutput, {
            invocationId: owned.lateInvocationId,
            expectedGeneration: 4,
            responseJson: JSON.stringify({ kind: "complete", text: "late" }),
        }),
    ).rejects.toThrow("not_authorized");
    await f.t.action(internal.dossierPurge.purgeResearchDossiers, {
        runIds: [f.runId],
        reason: "Remove all later execution children",
    });
    await f.t.run(async (ctx) => {
        expect.soft(await ctx.db.get(owned.sessionId)).toBeNull();
        expect.soft(await ctx.db.get(owned.commitId)).toBeNull();
        expect.soft(await ctx.db.get(owned.payloadId)).toBeNull();
        for (const id of owned.texts) {
            expect.soft(await ctx.db.get(id)).toBeNull();
            expect
                .soft(
                    await ctx.db
                        .query("retainedTextFragments")
                        .withIndex("by_text_and_index", (q) =>
                            q.eq("textId", id),
                        )
                        .first(),
                )
                .toBeNull();
        }
    });
});

test("purge drains evidence, source, and review children across both parent levels", async () => {
    const f = await seedCapturedSources();
    const parents = 2 * DOSSIER_PURGE_BATCH + 1;
    const later = await f.t.run(async (ctx) => {
        const source = await ctx.db.get(f.sourceId);
        const capture = await ctx.db.get(f.captureId);
        const preparation = await ctx.db.get(f.preparationId);
        assert(source && capture?.storageId && preparation);
        const {
            _id: _source,
            _creationTime: _sourceTime,
            ...sourceFields
        } = source;
        const {
            _id: _preparation,
            _creationTime: _preparationTime,
            ...preparationFields
        } = preparation;
        let sourceId = f.sourceId;
        let revisionId = f.corpusRevisionId;
        for (let index = 0; index < parents; index++) {
            sourceId = await ctx.db.insert("sources", {
                ...sourceFields,
                canonicalUrl: `https://z.example/${index.toString().padStart(3, "0")}`,
            });
            revisionId = await ctx.db.insert("corpusRevisions", {
                runId: f.runId,
                revision: index + 10,
                status: "draft",
                createdAt: 1,
            });
        }
        const decisionId = await ctx.db.insert("sourceDecisions", {
            runId: f.runId,
            corpusRevisionId: revisionId,
            sourceId,
            decisionKey: "later-source",
            decision: "pending",
            occurredAt: 1,
        });
        const taskId = await ctx.db.insert("aiTaskResults", {
            runId: f.runId,
            corpusRevisionId: revisionId,
            taskType: "showcase_claim_extraction",
            executionMode: "live",
            schemaVersion: "fixture",
            adapterVersion: "fixture",
            inputHash: "fixture",
            output: { kind: "claim_extraction", claimCount: 0, claimIds: [] },
            createdAt: 1,
        });
        const version = {
            runId: f.runId,
            corpusRevisionId: revisionId,
            sourceId,
            acceptedDecisionId: decisionId,
            contentHash: "fixture",
            normalizerVersion: "fixture",
            storageId: capture.storageId,
            mediaType: "text/plain",
            byteCount: 1,
            canonicalUrl: source.canonicalUrl,
            retrievalVersion: "fixture",
            executionGeneration: 4,
            createdAt: 1,
        };
        const claim = {
            runId: f.runId,
            corpusRevisionId: revisionId,
            statement: "A retained claim",
            canonicalText: "a retained claim",
            classification: "Fact" as const,
            proposingTaskId: taskId,
            schemaVersion: "fixture",
            createdAt: 1,
        };
        let sourceVersionId = await ctx.db.insert("sourceVersions", version);
        let claimId = await ctx.db.insert("claims", claim);
        for (let index = 1; index < parents; index++) {
            sourceVersionId = await ctx.db.insert("sourceVersions", version);
            claimId = await ctx.db.insert("claims", claim);
        }
        const passageIds = [];
        for (let order = 0; order <= DOSSIER_PURGE_BATCH; order++)
            passageIds.push(
                await ctx.db.insert("sourcePassages", {
                    sourceVersionId,
                    order,
                    locatorVersion: "web-v1",
                    quotationHash: "fixture",
                    exactQuotation: "x",
                    locator: {
                        kind: "web",
                        canonicalUrl: source.canonicalUrl,
                        sourceVersionHash: "fixture",
                        exactQuotation: "x",
                    },
                    createdAt: 1,
                }),
            );
        const evidenceIds = [];
        const sourcePassageId = passageIds.at(-1);
        assert(sourcePassageId);
        for (let index = 0; index < parents; index++)
            evidenceIds.push(
                await ctx.db.insert("claimEvidence", {
                    claimId,
                    sourcePassageId,
                    relation: "supporting",
                    proposingTaskId: taskId,
                    createdAt: 1,
                }),
            );
        const previewId = await ctx.db.insert("previewCaches", {
            sourceId,
            dataUrl: "data:text/plain,x",
            sizeBytes: 1,
            createdAt: 1,
            expiresAt: 2,
        });
        const reviewId = await ctx.db.insert("sourceReviewItems", {
            runId: f.runId,
            corpusRevisionId: revisionId,
            sourceId,
            decision: "pending",
            decisionRank: 0,
            sourceCreatedAt: 1,
            latestDecisionId: decisionId,
            decisionOccurredAt: 1,
        });
        const rebuildId = await ctx.db.insert(
            "sourceSelectionProposalRebuilds",
            {
                ...preparationFields,
                corpusRevisionId: revisionId,
            },
        );
        const proposal = {
            runId: f.runId,
            corpusRevisionId: f.corpusRevisionId,
            version: 1,
            policyVersion: "fixture",
            coveragePreset: "balanced" as const,
            recommendedTarget: 1,
            candidateFingerprint: "fixture",
            status: "ready" as const,
            counts: { recommended: 0, needsAttention: 0, alternative: 0 },
            gaps: [],
            createdAt: 1,
        };
        let proposalId = await ctx.db.insert(
            "sourceSelectionProposals",
            proposal,
        );
        for (let index = 1; index < parents; index++)
            proposalId = await ctx.db.insert("sourceSelectionProposals", {
                ...proposal,
                version: index + 1,
            });
        const laterRevisionProposal = await ctx.db.insert(
            "sourceSelectionProposals",
            {
                ...proposal,
                corpusRevisionId: revisionId,
            },
        );
        const proposalItem = {
            runId: f.runId,
            corpusRevisionId: f.corpusRevisionId,
            proposalId,
            sourceId,
            disposition: "alternative" as const,
            sourceFamily: "analyst_supplied" as const,
            rank: 1,
            reasonCodes: [],
            createdAt: 1,
        };
        const itemId = await ctx.db.insert(
            "sourceSelectionProposalItems",
            proposalItem,
        );
        const laterRevisionItem = await ctx.db.insert(
            "sourceSelectionProposalItems",
            {
                ...proposalItem,
                corpusRevisionId: revisionId,
                proposalId: laterRevisionProposal,
            },
        );
        return {
            claimId,
            sourceVersionId,
            sourceId,
            revisionId,
            laterRevisionProposal,
            itemId,
            laterRevisionItem,
            reviewId,
            rebuildId,
            previewId,
            passageIds,
            evidenceIds,
        };
    });
    const purge = {
        runId: f.runId,
        reason: "Remove all later documentary children",
    };
    await f.t.mutation(internal.dossierPurge.beginPurge, purge);
    for (let batch = 0; batch < 3; batch++)
        expect(
            await f.t.mutation(internal.dossierPurge.purgeStep, {
                runId: f.runId,
                step: "claims",
            }),
        ).toBe(true);
    await f.t.run(async (ctx) => {
        expect(await ctx.db.get(later.claimId)).not.toBeNull();
        const children = await ctx.db
            .query("claimEvidence")
            .withIndex("by_claim", (q) => q.eq("claimId", later.claimId))
            .collect();
        expect(children).toHaveLength(DOSSIER_PURGE_BATCH + 1);
    });
    await f.t.action(internal.dossierPurge.purgeResearchDossiers, {
        runIds: [purge.runId],
        reason: purge.reason,
    });
    await f.t.action(internal.dossierPurge.purgeResearchDossiers, {
        runIds: [purge.runId],
        reason: purge.reason,
    });
    await f.t.run(async (ctx) => {
        const { passageIds, evidenceIds, ...rows } = later;
        for (const [name, id] of Object.entries(rows))
            expect.soft(await ctx.db.get(id), name).toBeNull();
        for (const ids of [passageIds, evidenceIds]) {
            const remaining = await Promise.all(
                ids.map((id) => ctx.db.get(id)),
            );
            expect.soft(remaining.filter(Boolean)).toHaveLength(0);
        }
    });
});

test("a purge fences an idle framing turn immediately and restores its quota only once", async () => {
    const { t, runId } = await seedWorkbench();
    const turn = await t.mutation(internal.execution.conversations.startTurn, {
        runId,
        definitionId: "workbench_v1",
        scope: { kind: "workbench_v1" },
        simulation: false,
    });
    assert(turn);
    const ownerId = await t.run(async (ctx) => {
        const run = await ctx.db.get(runId);
        assert(run?.ownerVisitorId);
        expect(run.executionStatus).toBe("idle");
        await ctx.db.patch(runId, { reservationStatus: "consumed" });
        await ctx.db.patch(run.ownerVisitorId, { analysesReserved: 2 });
        return run.ownerVisitorId;
    });
    const args = { runId, reason: "Retire this active framing dossier" };
    await t.mutation(internal.dossierPurge.beginPurge, args);
    await expect(
        t.query(internal.execution.context.build, {
            missionId: turn.missionId,
            expectedGeneration: 1,
        }),
    ).rejects.toThrow("not_authorized");
    await t.mutation(internal.dossierPurge.beginPurge, args);
    expect(await t.run((ctx) => ctx.db.get(ownerId))).toMatchObject({
        analysesReserved: 1,
    });
    expect(await t.run((ctx) => ctx.db.get(runId))).toMatchObject({
        withdrawnAt: expect.any(Number),
    });
});

test("purge finishes a maximum-size retained observation within transaction limits", async () => {
    const { t, runId } = await seedWorkbench(
        false,
        undefined,
        60000,
        undefined,
        undefined,
        5,
        "balanced",
        true,
    );
    const operationId = await t.run((ctx) =>
        ctx.db.insert("agentOperationRequests", {
            runId,
            actor: "system",
            cause: "old-public-observation",
            logicalKey: "old-public-observation",
            input: { kind: "consult_run_state" },
            operationVersion: 1,
            expectedGeneration: 1,
            status: "completed",
            createdAt: 1,
        }),
    );
    const retained = retainedTextParts(`${"界".repeat(5592405)}x`);
    expect(retained.manifest.sizeBytes).toBe(16 * 1024 * 1024);
    for (const [index, content] of retained.parts.entries())
        await t.run((ctx) =>
            stageOperationObservation(ctx, operationId, {
                ...retained.manifest,
                index,
                content,
            }),
        );
    const textId = await t.run(async (ctx) => {
        const stored = await ctx.db
            .query("retainedTexts")
            .withIndex("by_key", (q) =>
                q.eq("key", `operation:${operationId}:observation`),
            )
            .unique();
        assert(stored);
        return stored._id;
    });
    const reason = "Remove all retained fragments";
    await t.mutation(internal.dossierPurge.beginPurge, { runId, reason });
    const firstBatch = await t.run(async (ctx) => {
        const more = await ctx.runMutation(internal.dossierPurge.purgeStep, {
            runId,
            step: "agentOperationRequests",
        });
        return { more, metrics: await ctx.meta.getTransactionMetrics() };
    });
    expect(firstBatch.more).toBe(true);
    expect(firstBatch.metrics.bytesRead.used).toBeLessThan(16 * 1024 * 1024);
    expect(firstBatch.metrics.documentsWritten.used).toBeGreaterThan(0);
    await t.action(internal.dossierPurge.purgeResearchDossiers, {
        runIds: [runId],
        reason,
    });
    await t.run(async (ctx) => {
        expect(await ctx.db.get(runId)).toBeNull();
        expect(await ctx.db.get(operationId)).toBeNull();
        expect(await ctx.db.get(textId)).toBeNull();
        expect(
            await ctx.db
                .query("retainedTextFragments")
                .withIndex("by_text_and_index", (q) => q.eq("textId", textId))
                .first(),
        ).toBeNull();
    });
}, 30000);

test("dossier purge advances across a batch of large inline invocations", async () => {
    const f = await seedWorkbench(
        false,
        undefined,
        60000,
        undefined,
        undefined,
        5,
        "balanced",
        true,
    );
    const rawOutputJson = JSON.stringify({ text: "x".repeat(200_000) });
    for (let index = 0; index < DOSSIER_PURGE_BATCH; index++)
        await f.t.run((ctx) =>
            ctx.db.insert("agentInvocations", {
                runId: f.runId,
                generation: 4,
                definitionVersion: 1,
                taskKey: `large-output-${index}`,
                status: "returned",
                provenance: "live",
                inputJson: "{}",
                rawOutputJson,
                createdAt: 1,
            }),
        );
    const reason = "Remove dossier with large inline invocation history";
    await f.t.mutation(internal.dossierPurge.beginPurge, {
        runId: f.runId,
        reason,
    });
    await expect(
        f.t.mutation(internal.dossierPurge.purgeStep, {
            runId: f.runId,
            step: "agentInvocations",
        }),
    ).resolves.toBe(true);
    await f.t.action(internal.dossierPurge.purgeResearchDossiers, {
        runIds: [f.runId],
        reason,
    });
    await f.t.run(async (ctx) => {
        expect(await ctx.db.get(f.runId)).toBeNull();
        expect(
            await ctx.db
                .query("agentInvocations")
                .withIndex("by_run_and_task_key", (q) => q.eq("runId", f.runId))
                .first(),
        ).toBeNull();
    });
});

test("dossier purge drains capture batches with large observed destination metadata", async () => {
    const f = await seedCapturedSources();
    const urls = Array.from(
        { length: 64 },
        (_, index) =>
            `https://example.com/${String(index).padStart(2, "0")}/${"x".repeat(2025)}`,
    );
    const observedDestinations = extractObservedDestinations(
        urls.join("\n"),
        "https://example.com/",
    );
    expect(observedDestinations).toHaveLength(urls.length);
    const capture = await f.t.run((ctx) => ctx.db.get(f.captureId));
    assert(capture);
    const { _id, _creationTime, ...fields } = capture;
    for (let index = 0; index < DOSSIER_PURGE_BATCH; index++)
        await f.t.run((ctx) =>
            ctx.db.insert("sourceCaptures", {
                ...fields,
                captureKey: `large-destinations-${index}`,
                observedDestinations,
            }),
        );
    const reason = "Remove dossier with large capture metadata";
    await f.t.mutation(internal.dossierPurge.beginPurge, {
        runId: f.runId,
        reason,
    });
    let more: boolean;
    do {
        more = await f.t.run((ctx) =>
            ctx.runMutation(
                internal.dossierPurge.purgeStep,
                { runId: f.runId, step: "sources" },
                { transactionLimits: { bytesRead: 16 * 1024 * 1024 } },
            ),
        );
    } while (more);
    expect(await f.t.run((ctx) => ctx.db.get(f.sourceId))).toBeNull();
    expect(
        await f.t.run((ctx) =>
            ctx.db
                .query("sourceCaptures")
                .withIndex("by_source_and_updated_at", (q) =>
                    q.eq("sourceId", f.sourceId),
                )
                .first(),
        ),
    ).toBeNull();
});
