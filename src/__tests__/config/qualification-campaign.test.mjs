import assert from "node:assert/strict";
import test from "node:test";
import { campaignManifestSchema } from "../../../convex/qualificationCampaignPolicy.ts";

test("a campaign cannot silently default its spending allowance or expiration", () => {
    assert.equal(
        campaignManifestSchema.safeParse({ objective: "Qualify Sources" })
            .success,
        false,
    );
});

import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCampaign } from "../../../scripts/evaluations/workbench-browser/campaign.ts";
import { sha256 } from "../../../scripts/evaluations/workbench-browser/protocol.ts";

const makeManifest = () => ({
    version: 1,
    key: "prepared",
    objective: "Qualify the protected Workbench path",
    capability: "workbench",
    mode: "deterministic",
    batteryHash: sha256(
        readFileSync(
            "scripts/evaluations/workbench-browser/browser-cases.json",
        ),
    ),
    expectations: [
        { id: "initial-framing", checks: ["proposed-framing-is-saved"] },
    ],
    models: { workbench: { model: "fixture", reasoning: "recommended" } },
    correctionPaths: ["convex/execution"],
    maximumLots: 2,
    repetitionsPerCandidate: 1,
    expiresAt: Date.now() + 60000,
    perLot: { model: 0, search: 0, acquisition: 0, costUsd: 0 },
    total: { model: 0, search: 0, acquisition: 0, costUsd: 0 },
});
test("prepare retains a reviewable mandate without authorizing a lot or contacting a service", async () => {
    const root = mkdtempSync(join(tmpdir(), "campaign-test-"));
    const input = join(root, "input.json");
    writeFileSync(input, JSON.stringify(makeManifest()));
    await runCampaign("prepare", root, { manifest: input });
    const retained = JSON.parse(
        readFileSync(join(root, "campaign.json"), "utf8"),
    );
    assert.equal(retained.manifest.key, "prepared");
    assert.equal(retained.campaignId, undefined);
    assert.equal(existsSync(join(root, "lots")), false);
});

import {
    acquireCampaignLock,
    assessCampaignLot,
    campaignReviewTemplate,
} from "../../../scripts/evaluations/workbench-browser/campaign.ts";

test("a mechanical completion still needs a judgment bound to unchanged evidence", () => {
    const root = mkdtempSync(join(tmpdir(), "campaign-review-"));
    writeFileSync(
        join(root, "campaign-lot.json"),
        JSON.stringify({
            manifest: makeManifest(),
            candidateHash: "b".repeat(64),
            fingerprints: {},
        }),
    );
    writeFileSync(
        join(root, "campaign-result.json"),
        JSON.stringify({ completed: true, cleanupCompleted: true }),
    );
    writeFileSync(
        join(root, "published.json"),
        JSON.stringify({ text: "Research has not started." }),
    );
    const review = campaignReviewTemplate(root);
    review.cases[0].finding = "The saved program matches the retained reply.";
    review.cases[0].evidence = ["published.json"];
    assert.equal(assessCampaignLot(root, review).verdict, "inconclusive");
    review.cases[0].checks["proposed-framing-is-saved"] = "passed";
    assert.equal(assessCampaignLot(root, review).verdict, "passed");
    writeFileSync(
        join(root, "published.json"),
        JSON.stringify({ text: "Different answer" }),
    );
    assert.throws(() => assessCampaignLot(root, review), /Stale/);
});
test("the qualification lock stays held until cleanup releases it", async () => {
    const root = mkdtempSync(join(tmpdir(), "campaign-lock-"));
    const lock = join(root, "lock");
    const release = await acquireCampaignLock(lock);
    await assert.rejects(acquireCampaignLock(lock), /active/);
    await release();
    await (await acquireCampaignLock(lock))();
});

import { sourcesBatterySchema } from "../../../scripts/evaluations/workbench-browser/protocol.ts";

test("a Sources protocol records lower search and acquisition allowances without claiming the maxima", () => {
    const battery = JSON.parse(
        readFileSync(
            "scripts/evaluations/workbench-browser/sources-cases.json",
            "utf8",
        ),
    );
    assert.equal(
        sourcesBatterySchema.safeParse({
            ...battery,
            maximumSearchAttempts: 1,
            maximumAcquisitions: 2,
        }).success,
        true,
    );
});

test("a retained execution failure blocks acceptance even when an earlier completion flag is true", () => {
    const root = mkdtempSync(join(tmpdir(), "campaign-failure-review-"));
    writeFileSync(
        join(root, "campaign-lot.json"),
        JSON.stringify({
            manifest: makeManifest(),
            candidateHash: "b".repeat(64),
            fingerprints: {},
        }),
    );
    writeFileSync(
        join(root, "campaign-result.json"),
        JSON.stringify({
            completed: true,
            cleanupCompleted: true,
            failure: "Candidate changed after the browser scenarios completed",
        }),
    );
    const review = campaignReviewTemplate(root);
    for (const c of review.cases) {
        c.checks = Object.fromEntries(
            Object.keys(c.checks).map((key) => [key, "passed"]),
        );
        c.finding = "Published evidence meets the declared expectation.";
        c.evidence = ["campaign-result.json"];
    }
    assert.equal(assessCampaignLot(root, review).verdict, "failed");
});
