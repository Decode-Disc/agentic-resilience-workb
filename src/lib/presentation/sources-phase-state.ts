import type { SourcesPhase } from "@convex/domain/sources";

/** A Sources state's glyph: a live dot while working, otherwise a static mark. */
export type SourcesStateMark =
    | "live"
    | "clock"
    | "pause"
    | "warning"
    | "check"
    | "unfinished-check"
    | "unfinished"
    | "barred";
/** Follows the dossier status tones: accent while working, review when the analyst must look, success once fully handed off. */
export type SourcesStateTone =
    | "accent"
    | "review"
    | "ink"
    | "success"
    | "muted"
    | "destructive";

/**
 * The single owner of each Sources phase's tone and glyph. The stage panel and
 * the dossier badge both read it, so one phase never shows two meanings.
 */
export const sourcesPhaseState: Record<
    SourcesPhase,
    { mark: SourcesStateMark; tone: SourcesStateTone }
> = {
    collecting: { mark: "live", tone: "accent" },
    waiting: { mark: "clock", tone: "muted" },
    paused: { mark: "pause", tone: "ink" },
    time_limit: { mark: "warning", tone: "review" },
    completed: { mark: "check", tone: "success" },
    // Handed off, but some needs ask for the analyst's look.
    completed_with_limits: { mark: "check", tone: "review" },
    ended_without_material: { mark: "barred", tone: "muted" },
    interrupted: { mark: "unfinished", tone: "muted" },
    failed: { mark: "unfinished", tone: "destructive" },
    insufficient_evidence: { mark: "barred", tone: "muted" },
};
