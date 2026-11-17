"use client";

import type { api } from "@convex/_generated/api";
import type { FunctionReturnType } from "convex/server";

import { Badge, type BadgeTone } from "@/components/ui/badge";
import {
    checkpointDecisionLabel,
    providerStatusLabel,
} from "@/lib/presentation/research-copy";

type Operations = FunctionReturnType<typeof api.adminOperations.get>;
type ProviderStatus = Operations["providerCalls"][number]["status"];
type ReviewDecision = Operations["checkpoints"][number]["decision"];

// The single owner of admin badge meaning and colour; dossier status itself comes from
// the shared `DossierStatusBadge`. Technical success uses
// Quiet Sage (success), running work Research Violet (accent), attention review,
// failure destructive and inactive states dashed. Approval Teal (approved) is
// used only for an analyst's own approval.
const providerTones = {
    started: "accent",
    succeeded: "success",
    partial: "review",
    failed: "destructive",
} satisfies Record<ProviderStatus, BadgeTone>;

const decisionTones = {
    approved: "approved",
    recheck: "review",
    force_continue: "review",
    complete_insufficient: "dashed",
} satisfies Record<ReviewDecision, BadgeTone>;

const marks = {
    withdrawn: { label: "Withdrawn", tone: "dashed" },
    edited: { label: "Edited", tone: "accent" },
    unassigned: { label: "Unassigned", tone: "review" },
    reservedForValidation: { label: "Reserved for validation", tone: "review" },
    simulation: { label: "Simulation · Not live", tone: "dashed" },
} satisfies Record<string, { label: string; tone: BadgeTone }>;

/** Provider attempt outcome with its analyst label and semantic tone. */
export function ProviderStatusBadge({ status }: { status: ProviderStatus }) {
    return (
        <Badge tone={providerTones[status]}>
            {providerStatusLabel(status)}
        </Badge>
    );
}

/** An analyst's review decision; only an approval takes the approval colour. */
export function ReviewDecisionBadge({
    decision,
}: {
    decision: ReviewDecision;
}) {
    return (
        <Badge tone={decisionTones[decision]}>
            {checkpointDecisionLabel(decision)}
        </Badge>
    );
}

/** A fixed admin marker such as Withdrawn or Edited, with its one label and tone. */
export function AdminMarkBadge({ mark }: { mark: keyof typeof marks }) {
    return <Badge tone={marks[mark].tone}>{marks[mark].label}</Badge>;
}
