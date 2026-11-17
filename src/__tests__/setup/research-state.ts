import { api, internal } from "@convex/_generated/api";
import { getAgentDefinition } from "@convex/execution/agentCatalog";
import { recordContextObservation } from "@convex/execution/journal";
import type { ModelRoute } from "@convex/integrations/modelRouting";
import { assert, vi } from "vitest";
import { installModel } from "./model-configuration";
import { seedCapturedSources } from "./sources-mission";

/** Reconstructs historical persisted material in an isolated database, then admits a real current Workbench turn. */
export async function seedResearchStateScenario(
    options: {
        outcome: "complete" | "partial" | "blocked";
        blockCode?: string;
        historicalTimeLimitNote?: boolean;
        retainedDocumentCount: number;
        capturedDocumentCount: number;
    },
    execution: { simulation?: boolean; route?: ModelRoute } = {},
) {
    const simulation = execution.simulation ?? false;
    vi.useFakeTimers();
    const f = await seedCapturedSources();
    const material = await f.t.run(async (ctx) => {
        const preparation = await ctx.db.get(f.preparationId);
        const source = await ctx.db.get(f.sourceId);
        const capture = await ctx.db.get(f.captureId);
        assert(preparation?.sourcesMission && source && capture?.contentHash);
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
        const documents = [];
        for (const entry of captures.slice(0, options.retainedDocumentCount)) {
            const controlTaskId = await ctx.db.insert("aiTaskResults", {
                runId: f.runId,
                corpusRevisionId: f.corpusRevisionId,
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
                    preparationId: f.preparationId,
                    evidence: [],
                    inputHash: "historical-control",
                    control: { findings: [], coherence: true, limitations: [] },
                },
            });
            const qualificationTaskId = await ctx.db.insert("aiTaskResults", {
                runId: f.runId,
                corpusRevisionId: f.corpusRevisionId,
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
                    preparationId: f.preparationId,
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
        await ctx.db.patch(f.preparationId, {
            status: options.outcome,
            completedAt: 2,
            sourcesMission: {
                ...preparation.sourcesMission,
                captureIds: captures.map((c) => c.captureId),
                result,
            },
        });
        await ctx.db.patch(f.missionId, {
            status:
                options.outcome === "complete" && !options.blockCode
                    ? "completed"
                    : "blocked",
            blockCode: options.blockCode,
        });
        const framingId = await ctx.db.insert("framingRevisions", {
            runId: f.runId,
            revision: 1,
            content: { scope: "Workflow coordination", questions: [] },
            requestKey: "historical-program",
            contentHash: "historical",
            origin: "analyst",
            createdAt: 1,
        });
        await ctx.db.patch(f.runId, {
            startMode: "framed",
            agentExecutionVersion: 3,
            researchStartedAt: 1,
            fixedFramingRevisionId: framingId,
            currentFramingRevisionId: framingId,
            lifecycleState: "sources_prepared",
            executionStatus: "idle",
        });
        const observationId = await recordContextObservation(ctx, f.runId, {
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
                (await ctx.db.get(f.preparationId))?.sourcesMission?.result,
            ),
            observationId,
            sourceIds: captures.map((c) => c.sourceId),
        };
    });
    if (execution.route) await installModel(f.t, execution.route);
    if (simulation) {
        vi.stubEnv("E2E_FIXTURES_ENABLED", "true");
        vi.stubEnv("CONVEX_CLOUD_URL", "http://127.0.0.1:3210");
        await f.t.run((ctx) =>
            ctx.db.patch(f.invitationId, { slotKey: "analyst-4" }),
        );
        const contextId = await f.t.mutation(
            internal.runWorkspace.openBrowserTestContext,
            {
                slotKey: "analyst-4",
                contextKey: "research-state-simulation",
                durationMs: 60000,
            },
        );
        await f.t.run((ctx) =>
            ctx.db.patch(f.runId, {
                purpose: "browser_test",
                browserTestContextId: contextId,
            }),
        );
    }
    await f.t
        .withIdentity({ subject: f.userId })
        .mutation(api.execution.conversations.submit, {
            runId: f.runId,
            requestKey: "research-state",
            text: "What stopped preparation and which documents were retained?",
            delivery: "queue",
        });
    await f.t.run(async (ctx) => {
        const conversation = await ctx.db
            .query("agentConversations")
            .withIndex("by_run", (q) => q.eq("runId", f.runId))
            .unique();
        assert(conversation);
        await ctx.db.patch(conversation._id, {
            definitionId: "workbench_v1",
            definitionVersion: getAgentDefinition("workbench_v1").version,
        });
    });
    const active = await f.t.mutation(
        internal.execution.conversations.startTurn,
        {
            runId: f.runId,
            definitionId: "workbench_v1",
            scope: { kind: "workbench_v1" },
            simulation,
        },
    );
    assert(active);
    return { ...f, ...material, workbenchMissionId: active.missionId };
}
