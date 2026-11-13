// @vitest-environment node

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { campaignManifestSchema } from "@convex/qualificationCampaignPolicy";
import { runCampaignScenarios } from "@evaluations/workbench-browser/scenarios";
import { ConvexHttpClient } from "convex/browser";
import { afterEach, assert, expect, test, vi } from "vitest";
import { configurableCampaign } from "@/__tests__/setup/qualification-v2";

const roots: string[] = [];
afterEach(() => {
    vi.useRealTimers();
    for (const root of roots.splice(0))
        rmSync(root, { recursive: true, force: true });
});

async function observe(options: {
    completeAt: number;
    expiresAt: number;
    blockedAt?: number;
    sourcesDeadlineAt?: number;
    blockedWriter?: boolean;
}) {
    const start = Date.now();
    const base = configurableCampaign();
    const manifest = campaignManifestSchema.parse({
        ...base,
        executionSurface: "backend",
        batteryHash: "a".repeat(64),
        scenarios: [
            {
                ...base.scenarios[0],
                steps: [
                    {
                        id: "handoff",
                        action: "wait_for",
                        state: "sources_prepared",
                    },
                ],
            },
        ],
        expectations: [base.expectations[0]],
    });
    assert(manifest.version === 2);
    const root = mkdtempSync(join(tmpdir(), "qualification-observation-"));
    roots.push(root);
    writeFileSync(
        join(root, "protocol.json"),
        `${JSON.stringify({ boundary: "backend" }, null, 2)}\n`,
    );
    writeFileSync(
        join(root, "prepared.json"),
        JSON.stringify({
            cases: [{ id: "claims", runId: "run", fixtureKey: "fixture" }],
        }),
    );
    const transport: typeof fetch = async (_url, init) => {
        const request = JSON.parse(String(init?.body));
        let value: unknown = null;
        if (request.path === "visitors:current") value = { status: "active" };
        else if (request.path === "execution/fixtures:activateWorkbench")
            value = null;
        else if (request.path === "execution/fixtures:qualificationSnapshot") {
            const elapsed = Date.now() - start;
            const complete = elapsed >= options.completeAt;
            const blocked = elapsed >= (options.blockedAt ?? Infinity);
            value = {
                contextExpiresAt: start + options.expiresAt,
                nativeSettled: true,
                conversation: { activeTurnId: null, queuedCount: 0 },
                run: {
                    executionStatus: complete
                        ? "idle"
                        : blocked
                          ? "paused"
                          : "running",
                    lifecycleState: complete
                        ? "sources_prepared"
                        : "discovering_sources",
                },
                sourcesMission: {
                    status: complete || blocked ? "blocked" : "running",
                    blockCode: blocked
                        ? "operation_outcome_unknown"
                        : undefined,
                    piActiveWriter:
                        !complete && blocked && options.blockedWriter,
                    deadlineAt:
                        start +
                        (options.sourcesDeadlineAt ?? options.completeAt),
                },
                preparation: {
                    status: complete ? "partial" : "started",
                    deadlineAt: start + options.completeAt,
                },
            };
        } else if (request.path.startsWith("execution/fixtures:inspect"))
            value = {
                page: [],
                payloads: [],
                downloads: [],
                isDone: true,
                continueCursor: "",
            };
        else throw new Error(`Unexpected external request: ${request.path}`);
        return Response.json({ status: "success", value });
    };
    const client = new ConvexHttpClient("http://127.0.0.1:3210", {
        logger: false,
        fetch: transport,
    });
    const outcome = runCampaignScenarios(
        null,
        client,
        undefined,
        client.url,
        root,
        manifest,
        () => false,
        client,
    ).then(
        () => null,
        (error: unknown) => error,
    );
    return { root, outcome };
}

test("live observation retains the partial handoff after the former fifteen-minute observer cutoff", async () => {
    vi.useFakeTimers({
        toFake: ["Date", "setTimeout", "clearTimeout", "hrtime", "performance"],
    });
    const f = await observe({
        completeAt: 903_000,
        expiresAt: 910_000,
        blockedAt: 899_000,
        sourcesDeadlineAt: 900_000,
        blockedWriter: true,
    });
    await vi.advanceTimersByTimeAsync(906_000);
    expect(await f.outcome).toBeNull();
    expect(
        JSON.parse(
            readFileSync(join(f.root, "claims/published-backend.json"), "utf8"),
        ),
    ).toMatchObject({
        run: { executionStatus: "idle", lifecycleState: "sources_prepared" },
        preparation: { status: "partial" },
    });
    expect(readFileSync(join(f.root, "progress.jsonl"), "utf8")).toContain(
        '"executionIntegrity":"passed"',
    );
});

test("live observation preserves stopped Sources as the failure instead of waiting for context expiry", async () => {
    vi.useFakeTimers({
        toFake: ["Date", "setTimeout", "clearTimeout", "hrtime", "performance"],
    });
    const f = await observe({
        completeAt: 950_000,
        expiresAt: 2_000,
        blockedAt: 500,
        sourcesDeadlineAt: 1_000,
    });
    await vi.advanceTimersByTimeAsync(3_000);
    expect(await f.outcome).toBeInstanceOf(Error);
    expect(
        JSON.parse(readFileSync(join(f.root, "claims/failure.json"), "utf8")),
    ).toMatchObject({
        step: "handoff",
        reason: "Sources blocked before sources_prepared: operation_outcome_unknown",
    });
    expect(readFileSync(join(f.root, "progress.jsonl"), "utf8")).toContain(
        '"executionIntegrity":"failed"',
    );
});

test("live observation stops at the original context expiry without dispatching or reporting completion", async () => {
    vi.useFakeTimers({
        toFake: ["Date", "setTimeout", "clearTimeout", "hrtime", "performance"],
    });
    const f = await observe({ completeAt: 950_000, expiresAt: 2_000 });
    await vi.advanceTimersByTimeAsync(906_000);
    expect(await f.outcome).toBeInstanceOf(Error);
    expect(
        JSON.parse(readFileSync(join(f.root, "claims/failure.json"), "utf8")),
    ).toMatchObject({
        step: "handoff",
        reason: "Qualification observation authority expired before sources_prepared",
    });
    expect(readFileSync(join(f.root, "progress.jsonl"), "utf8")).toContain(
        '"executionIntegrity":"failed"',
    );
});
