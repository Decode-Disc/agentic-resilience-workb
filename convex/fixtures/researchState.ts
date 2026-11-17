import type { Id } from "@convex/_generated/dataModel";
import type { MutationCtx } from "@convex/_generated/server";
import { recordContextObservation } from "@convex/execution/journal";

export type ResearchStateFixtureOptions = {
    outcome: "complete" | "partial" | "blocked";
    blockCode?: string;
    historicalTimeLimitNote?: boolean;
    retainedDocumentCount: number;
    capturedDocumentCount: number;
    uncapturedDocumentCount?: number;
};
/** Historical documentary state shared by deterministic tests and protected loopback verification fixtures. */
export async function seedHistoricalResearchState(
    ctx: MutationCtx,
    fixture: {
        runId: Id<"researchRuns">;
        preparationId: Id<"sourceSelectionProposalRebuilds">;
        sourceId: Id<"sources">;
        captureId: Id<"sourceCaptures">;
        corpusRevisionId: Id<"corpusRevisions">;
        missionId: Id<"agentMissions">;
    },
    options: ResearchStateFixtureOptions,
) {
    const preparation = await ctx.db.get(fixture.preparationId);
    const source = await ctx.db.get(fixture.sourceId);
    const capture = await ctx.db.get(fixture.captureId);
    if (!preparation?.sourcesMission || !source || !capture?.contentHash)
        throw new Error("Historical source fixture requires captured material");
    const {
        _id: _sourceId,
        _creationTime: _sourceTime,
        ...sourceFields
    } = source;
    const {
        _id: _captureId,
        _creationTime: _captureTime,
        ...captureFields
    } = capture;
    const captures = [
        {
            sourceId: source._id,
            captureId: capture._id,
            contentHash: capture.contentHash,
        },
    ];
    for (let i = 1; i < options.capturedDocumentCount; i++) {
        const sourceId = await ctx.db.insert("sources", {
            ...sourceFields,
            title: `Retained workflow document ${i + 1}`,
            canonicalUrl: `https://example.com/workflow/${i + 1}`,
        });
        const captureId = await ctx.db.insert("sourceCaptures", {
            ...captureFields,
            sourceId,
            captureKey: `research-state-${i}`,
        });
        captures.push({
            sourceId,
            captureId,
            contentHash: capture.contentHash,
        });
    }
    const uncapturedSourceIds = [];
    for (let i = 0; i < (options.uncapturedDocumentCount ?? 0); i++) {
        uncapturedSourceIds.push(
            await ctx.db.insert("sources", {
                ...sourceFields,
                title: `Candidate ${i + 1}`,
                canonicalUrl: `https://example.com/candidate/${i + 1}`,
            }),
        );
    }
    const documents = [];
    for (const entry of captures.slice(0, options.retainedDocumentCount)) {
        const controlTaskId = await ctx.db.insert("aiTaskResults", {
            runId: fixture.runId,
            corpusRevisionId: fixture.corpusRevisionId,
            sourceId: entry.sourceId,
            sourceCaptureId: entry.captureId,
            taskType: "documentary_control",
            executionMode: "live",
            schemaVersion: "sources_mission_v1",
            adapterVersion: "historical-fixture",
            inputHash: "historical-control",
            createdAt: 1,
            output: {
                kind: "documentary_control",
                preparationId: fixture.preparationId,
                evidence: [],
                inputHash: "historical-control",
                control: { findings: [], coherence: true, limitations: [] },
            },
        });
        const qualificationTaskId = await ctx.db.insert("aiTaskResults", {
            runId: fixture.runId,
            corpusRevisionId: fixture.corpusRevisionId,
            sourceId: entry.sourceId,
            sourceCaptureId: entry.captureId,
            taskType: "documentary_qualification",
            executionMode: "live",
            schemaVersion: "sources_mission_v1",
            adapterVersion: "historical-fixture",
            inputHash: "historical-qualification",
            createdAt: 1,
            output: {
                kind: "documentary_qualification",
                preparationId: fixture.preparationId,
                captureId: entry.captureId,
                contentHash: entry.contentHash,
                version: 1,
                contributions: [],
                controlTaskId,
            },
        });
        documents.push({
            ...entry,
            qualificationTaskId,
            qualificationVersion: 1,
            contributions: [],
        });
    }
    const result = {
        version: 1 as const,
        needsRevision: preparation.sourcesMission.needsRevision,
        outcome: options.outcome,
        documents,
        needs: preparation.sourcesMission.needs.map((need) => ({
            needId: need.id,
            contributions: [],
            unfinished: options.historicalTimeLimitNote
                ? [
                      "The Sources Agent stopped here because its time window ended.",
                  ]
                : [],
            workRequestIds: [],
        })),
        retentionAuthority: "system_mandate" as const,
        policyVersion: "sources_mission_v1" as const,
    };
    await ctx.db.patch(fixture.preparationId, {
        status: options.outcome,
        completedAt: 2,
        sourcesMission: {
            ...preparation.sourcesMission,
            captureIds: captures.map((c) => c.captureId),
            qualifications: documents.map(
                (document) => document.qualificationTaskId,
            ),
            result,
        },
    });
    await ctx.db.patch(fixture.missionId, {
        status:
            options.outcome === "complete" && !options.blockCode
                ? "completed"
                : "blocked",
        blockCode: options.blockCode,
    });
    const framingId = await ctx.db.insert("framingRevisions", {
        runId: fixture.runId,
        revision: 1,
        content: { scope: "Workflow coordination", questions: [] },
        requestKey: "historical-program",
        contentHash: "historical",
        origin: "analyst",
        createdAt: 1,
    });
    await ctx.db.patch(fixture.runId, {
        startMode: "framed",
        agentExecutionVersion: 3,
        researchStartedAt: 1,
        fixedFramingRevisionId: framingId,
        currentFramingRevisionId: framingId,
        lifecycleState: "sources_prepared",
        executionStatus: "idle",
    });
    const observationId = await recordContextObservation(ctx, fixture.runId, {
        key: "historical-source-handoff",
        topic: "research",
        actor: { type: "system" },
        value: {
            event: "sources_prepared",
            summary: "The Sources Agent reached its time limit.",
            material: result,
        },
    });
    return {
        resultJson: JSON.stringify(
            (await ctx.db.get(fixture.preparationId))?.sourcesMission?.result,
        ),
        observationId,
        uncapturedSourceIds,
        sourceIds: captures.map((c) => c.sourceId),
    };
}
