import type { Id } from "@convex/_generated/dataModel";

/**
 * One-shot composer draft handed from another workspace screen to the
 * Workbench composer. Kept in memory only: it never reaches the URL, survives
 * no reload and is never sent without the analyst.
 */
const pending = new Map<Id<"researchRuns">, string>();

export function stashWorkbenchDraft(runId: Id<"researchRuns">, text: string) {
    pending.set(runId, text);
}

export function peekWorkbenchDraft(runId: Id<"researchRuns">) {
    return pending.get(runId);
}

export function clearWorkbenchDraft(runId: Id<"researchRuns">) {
    pending.delete(runId);
}
