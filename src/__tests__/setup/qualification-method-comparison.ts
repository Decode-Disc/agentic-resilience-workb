import { internal } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import {
    campaignManifestSchema,
    emptyCampaignLimits,
} from "@convex/qualificationCampaignPolicy";
import { configurableCampaign } from "./qualification-v2";
import type { seedWorkbench } from "./workbench";

export function methodComparisonManifest() {
    const base = configurableCampaign();
    const profile = base.configurations[0];
    if (!profile) throw new Error("Profile required");
    return {
        ...base,
        mode: "deterministic",
        batteryHash: "a".repeat(64),
        perLot: emptyCampaignLimits(),
        total: emptyCampaignLimits(),
        configurations: ["retained_control", "native_skills"].map(
            (taskMethods) => ({
                ...profile,
                id: taskMethods.replaceAll("_", "-"),
                taskMethods,
            }),
        ),
    };
}

/** Admit a real immutable comparison lot for an existing local fixture. */
export async function admitMethodComparison(
    t: Awaited<ReturnType<typeof seedWorkbench>>["t"],
    runId: Id<"researchRuns">,
    method: "retained_control" | "native_skills" = "retained_control",
) {
    const run = await t.run((ctx) => ctx.db.get(runId));
    if (!run?.browserTestContextId)
        throw new Error("Local company fixture required");
    const draft = methodComparisonManifest();
    const scenario = draft.scenarios[0];
    if (!scenario) throw new Error("Scenario required");
    draft.scenarios = [
        {
            ...scenario,
            company: {
                ...scenario.company,
                cik: run.companySnapshot?.cik ?? scenario.company.cik,
            },
        },
    ];
    draft.expectations = [{ id: scenario.id, checks: ["method-parity"] }];
    const manifest = campaignManifestSchema.parse(draft);
    const campaignId = await t.mutation(
        internal.qualificationCampaigns.authorize,
        { manifest },
    );
    const lotId = await t.mutation(internal.qualificationCampaigns.admit, {
        campaignId,
        key: "comparison",
        candidateHash: "b".repeat(64),
        changedPaths: [],
        configurationId: method.replaceAll("_", "-"),
    });
    await t.mutation(internal.qualificationCampaigns.bind, {
        lotId,
        contextId: run.browserTestContextId,
    });
    return {
        campaignId,
        lotId,
        contextId: run.browserTestContextId,
        scenarioId: scenario.id,
    };
}
