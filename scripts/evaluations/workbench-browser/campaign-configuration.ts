import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ConvexHttpClient } from "convex/browser";
import type { FunctionReturnType } from "convex/server";
import { api } from "../../../convex/_generated/api.js";
import {
    type CampaignManifest,
    campaignConfiguration,
    campaignConfigurations,
} from "../../../convex/qualificationCampaignPolicy.ts";
import { prepareQualificationModel } from "./model-preparation.ts";

type Configuration = FunctionReturnType<typeof api.modelConfiguration.list>;
type Change = {
    kind: "reasoning" | "assignment" | "controller";
    key: string;
    beforeRevision: number;
    afterRevision: number;
    restored?: boolean;
};
type Saved = { original: Configuration; changes: Change[] };
const file = (root: string) => join(root, "configuration.json");
const save = (root: string, value: Saved) =>
    writeFileSync(file(root), `${JSON.stringify(value, null, 2)}\n`, {
        mode: 0o600,
    });

function campaignModelRoles(manifest: CampaignManifest) {
    return manifest.capability === "sources"
        ? (["workbench", "sources"] as const)
        : (["workbench"] as const);
}

/** Prepares selected catalogue profiles before admission without changing live role assignments. */
export async function prepareCampaignModels(
    client: Pick<ConvexHttpClient, "query" | "action">,
    manifest: CampaignManifest,
    configurationId?: string,
) {
    const profiles = configurationId
        ? [campaignConfiguration(manifest, configurationId)]
        : campaignConfigurations(manifest);
    const prepared = [];
    for (const profile of profiles) {
        for (const role of campaignModelRoles(manifest)) {
            const choice = profile.models[role];
            assert(choice);
            prepared.push({
                configurationId: profile.id,
                role,
                ...(await prepareQualificationModel(client, choice)),
            });
        }
        if (profile.controllerModel) {
            const controller = await client.action(
                api.modelConfigurationActions.verifyResponseControlModel,
                { model: profile.controllerModel },
            );
            prepared.push({
                configurationId: profile.id,
                role: "controller" as const,
                ...controller,
            });
        }
    }
    return prepared;
}

/** Applies only already prepared model choices. Intent is durable before each optimistic mutation. */
export async function configureCampaign(
    client: Pick<ConvexHttpClient, "query" | "mutation" | "action">,
    manifest: CampaignManifest,
    root: string,
    configurationId?: string,
) {
    const profile = campaignConfiguration(manifest, configurationId);
    assert(!existsSync(file(root)), "Configuration setup cannot be replayed");
    const original = await client.query(api.modelConfiguration.list, {});
    const state: Saved = { original, changes: [] };
    save(root, state);
    for (const role of campaignModelRoles(manifest)) {
        const choice = profile.models[role];
        assert(choice);
        let current = await client.query(api.modelConfiguration.list, {});
        let selected = current.models.find(
            (m) => m.model === choice.model && m.provider === choice.provider,
        );
        assert(
            selected?.enabled &&
                selected.status === "ready" &&
                selected.currentRevisionId,
            "Prepare the authorized model through the existing catalogue first",
        );
        const originalAssignment = original.assignments.find(
            (a) => a.agent === role,
        );
        assert(originalAssignment, "A restorable agent assignment is required");
        // A shared catalogue keeps one default; Workbench's existing per-conversation selection carries its own effort.
        const sourcesChoice = profile.models.sources;
        const preference =
            manifest.version !== 1 &&
            role === "workbench" &&
            sourcesChoice?.model === choice.model &&
            sourcesChoice?.provider === choice.provider
                ? sourcesChoice.reasoning
                : choice.reasoning;
        if (selected.reasoning.preference !== preference) {
            state.changes.push({
                kind: "reasoning",
                key: selected._id,
                beforeRevision: selected.revision,
                afterRevision: selected.revision + 1,
            });
            save(root, state);
            await client.mutation(
                api.modelConfiguration.setReasoningPreference,
                {
                    catalogId: selected._id,
                    expectedRevision: selected.revision,
                    requestKey: `${manifest.key}:${role}:reasoning`,
                    preference,
                },
            );
        }
        await prepareQualificationModel(client, choice);
        current = await client.query(api.modelConfiguration.list, {});
        selected = current.models.find((m) => m._id === selected?._id);
        assert(selected);
        const assignment = current.assignments.find((a) => a.agent === role);
        assert(assignment);
        if (assignment.catalogId !== selected._id) {
            state.changes.push({
                kind: "assignment",
                key: role,
                beforeRevision: assignment.revision,
                afterRevision: assignment.revision + 1,
            });
            save(root, state);
            await client.mutation(api.modelConfiguration.assign, {
                agent: role,
                catalogId: selected._id,
                expectedRevision: assignment.revision,
                requestKey: `${manifest.key}:${role}:assign`,
            });
        }
    }
    const current = await client.query(api.modelConfiguration.list, {});
    const policy = current.responseControl;
    if (profile.controllerModel)
        await client.action(
            api.modelConfigurationActions.verifyResponseControlModel,
            { model: profile.controllerModel },
        );
    if (
        policy.enabled !== !!profile.controllerModel ||
        (profile.controllerModel && policy.model !== profile.controllerModel)
    ) {
        state.changes.push({
            kind: "controller",
            key: "global",
            beforeRevision: policy.revision,
            afterRevision: policy.revision + 1,
        });
        save(root, state);
        const { revision: _revision, ...configuration } = policy;
        await client.mutation(api.modelConfiguration.setResponseControl, {
            ...configuration,
            expectedRevision: policy.revision,
            enabled: !!profile.controllerModel,
            model: profile.controllerModel ?? policy.model,
        });
    }
}

/** Restores only revisions still owned by this attempt; concurrent administrator changes remain visible. */
export async function restoreCampaignConfiguration(
    client: Pick<ConvexHttpClient, "query" | "mutation" | "action">,
    root: string,
) {
    if (!existsSync(file(root))) return;
    let state: Saved;
    try {
        state = JSON.parse(readFileSync(file(root), "utf8"));
    } catch (error) {
        throw new Error("Retained configuration cannot be restored", {
            cause: error,
        });
    }
    for (const change of [...state.changes].reverse()) {
        if (change.restored) continue;
        const current = await client.query(api.modelConfiguration.list, {});
        const revision =
            change.kind === "reasoning"
                ? current.models.find((m) => m._id === change.key)?.revision
                : change.kind === "assignment"
                  ? current.assignments.find((a) => a.agent === change.key)
                        ?.revision
                  : current.responseControl.revision;
        if (revision === change.beforeRevision) {
            change.restored = true;
            save(root, state);
            continue;
        }
        assert(
            revision !== undefined,
            "Configuration disappeared during restoration",
        );
        assert.equal(
            revision,
            change.afterRevision,
            "Configuration changed concurrently; restoration requires inspection",
        );
        if (change.kind === "reasoning") {
            const original = state.original.models.find(
                (m) => m._id === change.key,
            );
            assert(original);
            await client.mutation(
                api.modelConfiguration.setReasoningPreference,
                {
                    catalogId: original._id,
                    expectedRevision: revision,
                    requestKey: `${change.key}:campaign-restore:${change.afterRevision}`,
                    preference: original.reasoning.preference ?? "recommended",
                },
            );
        } else if (change.kind === "assignment") {
            const original = state.original.assignments.find(
                (a) => a.agent === change.key,
            );
            assert(original);
            await client.mutation(api.modelConfiguration.assign, {
                agent: original.agent,
                catalogId: original.catalogId,
                expectedRevision: revision,
                requestKey: `${change.key}:campaign-restore:${change.afterRevision}`,
            });
        } else {
            const { revision: _revision, ...original } =
                state.original.responseControl;
            await client.mutation(api.modelConfiguration.setResponseControl, {
                ...original,
                expectedRevision: revision,
            });
        }
        change.restored = true;
        save(root, state);
    }
}
