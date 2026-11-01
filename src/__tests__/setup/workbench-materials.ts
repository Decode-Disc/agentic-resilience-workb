import { api, internal } from "@convex/_generated/api";
import { upsertSourceReviewItem } from "@convex/domain/sourceReviewProjection";
import { assert, vi } from "vitest";
import { seedInspectedEvidence } from "./source-preparation";

/** Approved captures and queued messages for exercising real Workbench context admission. */
export async function seedWorkbenchMaterials(
    sourceCount: number,
    messageCount: number,
) {
    vi.useFakeTimers();
    const fixture = await seedInspectedEvidence();
    const { t, runId, corpusRevisionId, sourceId, captureId, userId } = fixture;
    await t.run(async (ctx) => {
        await ctx.db.patch(runId, {
            startMode: "framed",
            agentExecutionVersion: 3,
        });
        const source = await ctx.db.get(sourceId);
        const capture = await ctx.db.get(captureId);
        const revision = await ctx.db.get(corpusRevisionId);
        assert(source && capture && revision?.sourceSelectionProposalId);
        const proposalId = revision.sourceSelectionProposalId;
        const item = await ctx.db
            .query("sourceSelectionProposalItems")
            .withIndex("by_proposal_and_source", (q) =>
                q.eq("proposalId", proposalId).eq("sourceId", sourceId),
            )
            .unique();
        assert(item);
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
        const { _id: _itemId, _creationTime: _itemTime, ...itemFields } = item;
        for (let index = 1; index < sourceCount; index++) {
            const nextSource = await ctx.db.insert("sources", {
                ...sourceFields,
                canonicalUrl: `https://example.com/material/${index}`,
                title: `Material ${index}`,
            });
            const nextCapture = await ctx.db.insert("sourceCaptures", {
                ...captureFields,
                sourceId: nextSource,
                captureKey: `material-${index}`,
            });
            await ctx.db.insert("sourceSelectionProposalItems", {
                ...itemFields,
                sourceId: nextSource,
                sourceCaptureId: nextCapture,
            });
            const decisionId = await ctx.db.insert("sourceDecisions", {
                runId,
                corpusRevisionId,
                sourceId: nextSource,
                decisionKey: `accepted-${index}`,
                decision: "accepted",
                occurredAt: Date.now(),
            });
            await upsertSourceReviewItem(ctx, {
                runId,
                corpusRevisionId,
                sourceId: nextSource,
                decision: "accepted",
                latestDecisionId: decisionId,
                sourceCreatedAt: source.createdAt,
                decisionOccurredAt: Date.now(),
            });
        }
    });
    const client = t.withIdentity({ subject: userId });
    for (let index = 0; index < messageCount; index++)
        await client.mutation(api.execution.conversations.submit, {
            runId,
            requestKey: `message-${index}`,
            text: `Inspect material ${index}.`,
            delivery: "queue",
        });
    const start = () =>
        t.mutation(internal.execution.conversations.startTurn, {
            runId,
            definitionId: "workbench_v1",
            scope: { kind: "workbench_v1" },
            simulation: false,
        });
    return { ...fixture, client, start };
}
