import { internal } from "@convex/_generated/api";
import { requireDossierAuthority } from "@convex/execution/authority";
import { ensureDossierConversation } from "@convex/execution/conversations";
import { vi } from "vitest";
import { seedCapturedSources } from "./sources-mission";

/** A framed Sources run whose mission reached its preparation deadline. */
export async function seedExpiredPreparation(
    prepared?: Awaited<ReturnType<typeof seedCapturedSources>>,
) {
    vi.useFakeTimers();
    const f = prepared ?? (await seedCapturedSources());
    await f.t.run(async (ctx) => {
        const frameId = await ctx.db.insert("framingRevisions", {
            runId: f.runId,
            revision: 1,
            content: { scope: "Fixed workflow", questions: [] },
            requestKey: "fixed",
            contentHash: "fixture",
            origin: "analyst",
            createdAt: 1,
        });
        await ctx.db.patch(f.runId, {
            startMode: "framed",
            agentExecutionVersion: 3,
            fixedFramingRevisionId: frameId,
        });
    });
    vi.advanceTimersByTime(61_000);
    return f;
}

/** Ensures the dossier has a native Workbench conversation for time-limit notices and receipts. */
export async function seedTimeLimitConversation(
    f: Awaited<ReturnType<typeof seedExpiredPreparation>>,
) {
    return f.t.run(async (ctx) => {
        const scope = await requireDossierAuthority(ctx, f.runId);
        return ensureDossierConversation(ctx, scope);
    });
}

/** Reaches the deadline with a mission blocked by an unconfirmed operation, as observed on 2026-11-15. */
export async function reachTimeLimit(
    f: Awaited<ReturnType<typeof seedExpiredPreparation>>,
    options: { completionEventId?: string } = {},
) {
    await f.t.run((ctx) =>
        ctx.db.patch(f.missionId, {
            status: "blocked",
            blockCode: "operation_outcome_unknown",
            ...(options.completionEventId
                ? { completionEventId: options.completionEventId as never }
                : {}),
        }),
    );
    await f.t.mutation(internal.execution.handoffs.finishChild, {
        missionId: f.missionId,
    });
}

export const client = (f: Awaited<ReturnType<typeof seedExpiredPreparation>>) =>
    f.t.withIdentity({ subject: f.userId });
