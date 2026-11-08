// @vitest-environment node

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCampaign } from "@evaluations/workbench-browser/campaign";
import { afterEach, expect, test, vi } from "vitest";
import { configurableCampaign } from "@/__tests__/setup/qualification-v2";

const cli = vi.hoisted(() => vi.fn());
vi.mock("node:child_process", async (original) => ({
    ...(await original<typeof import("node:child_process")>()),
    spawnSync: cli,
}));
vi.mock("../../../scripts/local-runtime.ts", () => ({
    resolveLocalRuntime: async () => ({
        origins: { convex: "http://127.0.0.1:3216" },
    }),
}));
vi.mock("node:fs", async (original) => {
    const real = await original<typeof import("node:fs")>();
    return {
        ...real,
        readFileSync: (...args: Parameters<typeof real.readFileSync>) =>
            args[0] === ".convex/local/default/config.json"
                ? JSON.stringify({ adminKey: "test-local-admin-key" })
                : real.readFileSync(...args),
    };
});

const roots: string[] = [];
afterEach(() => {
    vi.unstubAllGlobals();
    cli.mockReset();
    for (const root of roots.splice(0)) rmSync(root, { recursive: true });
});

test("campaign environment inspection targets the verified loopback origin without cloud selection or credentials in arguments", async () => {
    const root = mkdtempSync(join(tmpdir(), "campaign-local-target-"));
    roots.push(root);
    writeFileSync(
        join(root, "campaign.json"),
        JSON.stringify({
            manifest: {
                ...configurableCampaign(),
                batteryHash: "a".repeat(64),
            },
            fingerprints: {},
        }),
    );
    vi.stubGlobal("fetch", async () =>
        Response.json({
            status: "success",
            value: { held: false, hasActiveWorkers: false },
        }),
    );
    // Stop at the external CLI boundary, before flags, admission or inference.
    cli.mockReturnValue({ status: 1, stdout: "", stderr: "" });
    await expect(runCampaign("authorize", root, {})).rejects.toThrow(
        "Local campaign operation failed",
    );
    expect(cli).toHaveBeenCalledOnce();
    expect(cli.mock.calls[0]?.[1]).toEqual([
        "node_modules/convex/bin/main.js",
        "env",
        "list",
        "--url",
        "http://127.0.0.1:3216",
    ]);
});
