import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { runCampaign } from "../../../scripts/evaluations/workbench-browser/campaign.ts";

import { configurableCampaign } from "../setup/qualification-v2.ts";

test("prepare freezes three free scenarios and two configurations with allowances above the former lot caps", async () => {
    const root = mkdtempSync(join(tmpdir(), "qualification-v2-"));
    const input = join(root, "input.json");
    writeFileSync(input, JSON.stringify(configurableCampaign()));
    await runCampaign("prepare", root, { manifest: input });
    const retained = JSON.parse(
        readFileSync(join(root, "campaign.json"), "utf8"),
    );
    assert.equal(retained.campaignId, undefined);
    assert.equal(retained.manifest.version, 2);
    assert.deepEqual(
        retained.manifest.scenarios.map((s) => s.id),
        ["claims", "creative", "platform"],
    );
    assert.deepEqual(
        retained.manifest.configurations.map((c) => c.id),
        ["first", "second"],
    );
    assert.deepEqual(retained.manifest.perLot, {
        model: 60,
        search: 6,
        acquisition: 18,
        costUsd: 3,
    });
    assert.match(retained.manifest.batteryHash, /^[a-f0-9]{64}$/);
});

import { campaignManifestSchema } from "../../../convex/qualificationCampaignPolicy.ts";

test("omitted scenarios use the editable default battery and retain explicit steps", async () => {
    const root = mkdtempSync(join(tmpdir(), "qualification-default-"));
    const { scenarios, expectations, ...input } = configurableCampaign();
    const path = join(root, "input.json");
    writeFileSync(path, JSON.stringify(input));
    await runCampaign("prepare", root, { manifest: path });
    const retained = JSON.parse(
        readFileSync(join(root, "campaign.json"), "utf8"),
    ).manifest;
    assert.deepEqual(
        retained.scenarios.map((s) => s.id),
        ["ccc", "adobe"],
    );
    assert(
        retained.scenarios[0].steps.some((s) => s.action === "pause_research"),
    );
    assert.equal(retained.expectations.length, 2);
});
test("unsupported fault combinations and executable configuration are refused before setup", () => {
    const input = { ...configurableCampaign(), batteryHash: "a".repeat(64) };
    assert.equal(
        campaignManifestSchema.safeParse({
            ...input,
            mode: "deterministic",
            perLot: { model: 0, search: 0, acquisition: 0, costUsd: 0 },
            total: { model: 0, search: 0, acquisition: 0, costUsd: 0 },
            scenarios: input.scenarios.map((s) => ({
                ...s,
                steps: [
                    {
                        id: "fault",
                        action: "fault",
                        recipe: "malformed_response",
                    },
                ],
            })),
        }).success,
        false,
    );
    assert.equal(
        campaignManifestSchema.safeParse({
            ...input,
            scenarios: input.scenarios.map((s) => ({
                ...s,
                steps: [
                    {
                        id: "execute",
                        action: "evaluate",
                        script: "arbitrary()",
                    },
                ],
            })),
        }).success,
        false,
    );
});

import {
    configureCampaign,
    restoreCampaignConfiguration,
} from "../../../scripts/evaluations/workbench-browser/campaign-configuration.ts";

test("the selected shared-model profile changes one catalogue default and restores it once", async () => {
    const root = mkdtempSync(join(tmpdir(), "qualification-shared-profile-"));
    const raw = configurableCampaign();
    raw.configurations[1] = {
        id: "second",
        purpose: "harness_stress",
        models: {
            workbench: { model: "fixture/shared", reasoning: "low" },
            sources: { model: "fixture/shared", reasoning: "high" },
        },
    };
    const m = campaignManifestSchema.parse({
        ...raw,
        batteryHash: "a".repeat(64),
    });
    const state = {
        models: [
            {
                _id: "catalogue",
                model: "fixture/shared",
                enabled: true,
                status: "ready",
                currentRevisionId: "revision-1",
                revision: 1,
                reasoning: { preference: "recommended" },
                compatible: true,
            },
        ],
        assignments: ["workbench", "sources"].map((agent) => ({
            agent,
            catalogId: "catalogue",
            revision: 1,
        })),
        responseControl: {
            revision: 1,
            enabled: false,
            model: "fixture/control",
        },
    };
    const preferences = [];
    const client = {
        query: async () => structuredClone(state),
        mutation: async (_ref, args) => {
            assert.equal(args.catalogId, "catalogue");
            assert.equal(args.expectedRevision, state.models[0].revision);
            preferences.push(args.preference);
            const model = state.models[0];
            model.revision++;
            model.currentRevisionId = `revision-${model.revision}`;
            model.reasoning.preference = args.preference;
            return { revision: model.revision };
        },
        action: async () => {
            throw new Error(
                "No profile refresh expected for this prepared fixture",
            );
        },
    };
    await configureCampaign(client, m, root, "second");
    assert.equal(state.models[0].reasoning.preference, "high");
    await restoreCampaignConfiguration(client, root);
    assert.deepEqual(preferences, ["high", "recommended"]);
});

test("campaign cleanup follows every owned context page beyond the legacy 25-page loop", async () => {
    const { closeCampaignContext } = await import(
        "../../../scripts/evaluations/workbench-browser/campaign.ts"
    );
    assert.equal(typeof closeCampaignContext, "function");
    let pages = 0;
    await closeCampaignContext(
        {
            mutation: async (_ref, args) => {
                assert.equal(args.contextKey, "retained-context");
                assert.equal(args.slotKey, "analyst-4");
                assert.equal(args.cursor, pages ? `page-${pages}` : undefined);
                pages++;
                return {
                    done: pages === 27,
                    cursor: `page-${pages}`,
                    cancelled: 0,
                };
            },
        },
        "retained-context",
    );
    assert.equal(pages, 27);
});
test("campaign cleanup refuses a stalled backend cursor instead of looping silently", async () => {
    const { closeCampaignContext } = await import(
        "../../../scripts/evaluations/workbench-browser/campaign.ts"
    );
    assert.equal(typeof closeCampaignContext, "function");
    let pages = 0;
    await assert.rejects(
        () =>
            closeCampaignContext(
                {
                    mutation: async () => {
                        pages++;
                        return { done: false, cursor: "stalled", cancelled: 0 };
                    },
                },
                "retained-context",
            ),
        /cursor did not advance/,
    );
    assert.equal(pages, 2);
});
