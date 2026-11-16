import type { api } from "@convex/_generated/api";
import type { Doc, Id } from "@convex/_generated/dataModel";
import { AGENT_IDENTITIES } from "@convex/domain/agentIdentities";
import type { FunctionReturnType } from "convex/server";
import type { BadgeTone } from "@/components/ui/badge";

type ModelConfiguration = FunctionReturnType<
    typeof api.modelConfiguration.list
>;
type CatalogModel = Pick<
    ModelConfiguration["models"][number],
    "_id" | "label" | "status" | "enabled" | "compatible"
>;
type AgentInfo = Pick<
    ModelConfiguration["agents"][number],
    "agent" | "label" | "implemented"
>;
type RunOverview = Pick<
    FunctionReturnType<typeof api.adminOperations.listRunsPage>["page"][number],
    "runId" | "companyLegalName" | "executionStatus" | "withdrawnAt"
>;
type ProviderCall = Pick<
    FunctionReturnType<typeof api.adminOperations.get>["providerCalls"][number],
    "status" | "reportedCost" | "billing"
>;

export type AdminAttentionFacts = {
    paidWorkEnabled: boolean;
    models: readonly CatalogModel[];
    assignments: readonly Pick<
        Doc<"agentModelSettings">,
        "agent" | "catalogId"
    >[];
    agents: readonly AgentInfo[];
    restorableCount: number;
    /** The most recently updated research dossiers; failures older than this page are not reported. */
    recentRuns: readonly RunOverview[];
};

export type AdminAttentionAction =
    | { kind: "enable_paid_work" }
    | { kind: "refresh_model"; catalogId: Id<"modelCatalog"> }
    | { kind: "open_models" }
    | { kind: "open_dossier"; runId: Id<"researchRuns"> }
    | { kind: "open_reservations" };

export type AdminAttentionItem = {
    key: string;
    kind: "paid_work" | "model" | "dossier" | "reservations";
    title: string;
    detail: string;
    action: AdminAttentionAction;
};

/** One readable state per catalogue model, with what it means for analysts; shared by the overview and the model rows. */
export function adminModelStatus(model: CatalogModel): {
    label: string;
    tone: BadgeTone;
    explanation: string;
} {
    if (model.status === "preparing")
        return {
            label: "Checking",
            tone: "accent",
            explanation:
                "The model is being checked with OpenRouter. It becomes usable when the check finishes.",
        };
    if (model.status === "failed")
        return {
            label: "Check failed",
            tone: "destructive",
            explanation:
                "OpenRouter rejected this model or its limits. Edit it and save to check it again; nothing can use it until then.",
        };
    if (!model.compatible)
        return {
            label: "Needs update",
            tone: "review",
            explanation:
                "The Workbench's tools changed after this model was checked. Updating re-measures it for the new tools, offline, with no model call or cost. Nothing can use it until it is updated.",
        };
    if (!model.enabled)
        return {
            label: "Turned off",
            tone: "dashed",
            explanation:
                "Checked and usable, but turned off: no agent or analyst can use it until it is available again.",
        };
    return {
        label: "Ready",
        tone: "success",
        explanation:
            "Checked and usable by the agents and analysts it is offered to.",
    };
}

function agentDisplayName(agent: AgentInfo) {
    return agent.agent in AGENT_IDENTITIES
        ? AGENT_IDENTITIES[agent.agent as keyof typeof AGENT_IDENTITIES].name
        : agent.label;
}

function joinNames(names: readonly string[]) {
    return names.length <= 1
        ? (names[0] ?? "")
        : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
}

function modelItem(
    model: CatalogModel,
    users: readonly string[],
): AdminAttentionItem | null {
    const who = `${joinNames(users)} cannot respond until this is resolved.`;
    const base = { key: `model:${model._id}`, kind: "model" as const };
    if (model.status === "preparing") return null;
    if (model.status === "failed")
        return {
            ...base,
            title: `${model.label} failed its check`,
            detail: `${who} Review its settings and save them again.`,
            action: { kind: "open_models" },
        };
    if (!model.compatible)
        return {
            ...base,
            title: `${model.label} needs an update`,
            detail: `The Workbench changed since this model was checked. ${who} Updating takes a moment and makes no model call.`,
            action: { kind: "refresh_model", catalogId: model._id },
        };
    if (!model.enabled)
        return {
            ...base,
            title: `${model.label} is turned off`,
            detail: `${who} Turn it on or assign another model.`,
            action: { kind: "open_models" },
        };
    return null;
}

/** What blocks analysts right now, limited to the conditions the administration brief accepted. */
export function adminAttention(
    facts: AdminAttentionFacts,
): AdminAttentionItem[] {
    const items: AdminAttentionItem[] = [];
    if (!facts.paidWorkEnabled)
        items.push({
            key: "paid-work",
            kind: "paid_work",
            title: "Paid work is stopped",
            detail: "No new research, source preparation or Workbench reply can start. Existing results stay readable.",
            action: { kind: "enable_paid_work" },
        });
    for (const model of facts.models) {
        const users = facts.agents
            .filter(
                (agent) =>
                    agent.implemented &&
                    facts.assignments.some(
                        (assignment) =>
                            assignment.agent === agent.agent &&
                            assignment.catalogId === model._id,
                    ),
            )
            .map(agentDisplayName);
        const item = users.length ? modelItem(model, users) : null;
        if (item) items.push(item);
    }
    for (const run of facts.recentRuns) {
        if (run.executionStatus !== "failed" || run.withdrawnAt !== undefined)
            continue;
        items.push({
            key: `dossier:${run.runId}`,
            kind: "dossier",
            title: `${run.companyLegalName ?? "A dossier"} stopped with a failure`,
            detail: "Its analyst cannot continue it. Inspect what happened before deciding whether to withdraw it.",
            action: { kind: "open_dossier", runId: run.runId },
        });
    }
    if (facts.restorableCount > 0)
        items.push({
            key: "reservations",
            kind: "reservations",
            title: `${facts.restorableCount} unused ${facts.restorableCount === 1 ? "reservation" : "reservations"} can be restored`,
            detail: "These dossiers never started. Restoring returns the analysis to its analyst, with a recorded reason.",
            action: { kind: "open_reservations" },
        });
    return items;
}

/** One reading of an attempt's cost, shared by the billing line, the activity table and the spend totals. */
export type ProviderCostState =
    | { kind: "confirmed"; amount: number }
    | { kind: "conflict" }
    | { kind: "unavailable" }
    | { kind: "checking" }
    | { kind: "none" };

export function providerCostState(
    call: Partial<Pick<ProviderCall, "reportedCost" | "billing">>,
): ProviderCostState {
    if (call.billing?.state === "conflict") return { kind: "conflict" };
    if (call.reportedCost !== undefined)
        return { kind: "confirmed", amount: call.reportedCost };
    if (call.billing?.state === "unavailable") return { kind: "unavailable" };
    if (call.billing) return { kind: "checking" };
    return { kind: "none" };
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** Spend over the recent provider attempts the operations view already loads; not a deployment total. */
export function adminRecentSpend(
    calls: readonly (ProviderCall & { createdAt?: number })[],
    now = Date.now(),
) {
    let confirmedCost = 0;
    let unconfirmed = 0;
    let failed = 0;
    let lastDay = 0;
    for (const call of calls) {
        const cost = providerCostState(call);
        if (cost.kind === "confirmed") confirmedCost += cost.amount;
        else if (cost.kind !== "none") unconfirmed += 1;
        if (call.status === "failed") failed += 1;
        if (call.createdAt !== undefined && now - call.createdAt < DAY_MS)
            lastDay += 1;
    }
    return {
        attempts: calls.length,
        confirmedCost: Math.round(confirmedCost * 1e6) / 1e6,
        unconfirmed,
        failed,
        lastDay,
    };
}

/** Provider costs are fractions of a cent; keep enough precision to stay truthful. */
export function formatAdminCost(value: number) {
    return value.toLocaleString("en", {
        style: "currency",
        currency: "USD",
        minimumFractionDigits: 2,
        maximumFractionDigits: 4,
    });
}
