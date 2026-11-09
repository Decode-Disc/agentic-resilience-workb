// @vitest-environment node

import { createHash } from "node:crypto";
import {
    existsSync,
    mkdirSync,
    mkdtempSync,
    readFileSync,
    rmSync,
    writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
    campaignReviewTemplate,
    runCampaign,
} from "@evaluations/workbench-browser/campaign";
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
                : args[0] === "invitation-otp-codes.local"
                  ? JSON.stringify({
                        invitations: [
                            {
                                slotKey: "analyst-4",
                                code: "offline-invitation",
                            },
                        ],
                    })
                  : real.readFileSync(...args),
    };
});

test.each([
    "SEC_USER_AGENT",
    "EXA_API_KEY",
    "OPENROUTER_API_KEY",
    "configured",
])("live research preflight checks configuration before admission: %s", async (missing) => {
    const root = mkdtempSync(join(tmpdir(), "campaign-sec-preflight-"));
    roots.push(root);
    const input = configurableCampaign();
    const manifest = {
        ...input,
        executionSurface: "backend",
        batteryHash: createHash("sha256")
            .update(JSON.stringify(input.scenarios))
            .digest("hex"),
    };
    writeFileSync(
        join(root, "campaign.json"),
        JSON.stringify({
            manifest,
            fingerprints: {},
            campaignId: "fixture-campaign",
        }),
    );
    const paths: string[] = [];
    const fetchRuntime: typeof fetch = async (_url, init) => {
        const { path } = JSON.parse(String(init?.body));
        paths.push(path);
        return Response.json({
            status: "success",
            value:
                path === "qualificationCampaigns:inspect"
                    ? {
                          campaign: { manifest },
                          lots: [],
                          coverage: [],
                          continueCursor: null,
                      }
                    : { held: false, hasActiveWorkers: false },
        });
    };
    vi.stubGlobal("fetch", fetchRuntime);
    cli.mockImplementation((_binary, args: string[]) => ({
        status: args.includes("env") && args.includes("set") ? 1 : 0,
        stdout:
            args.includes("env") && args.includes("list")
                ? ["OPENROUTER_API_KEY", "EXA_API_KEY", "SEC_USER_AGENT"]
                      .filter((name) => name !== missing)
                      .map((name) => `${name}=fixture-only`)
                      .join("\n")
                : "",
        stderr: "",
    }));
    await expect(runCampaign("run", root, {})).rejects.toThrow(
        missing === "configured" ? "Campaign stopped" : missing,
    );
    expect(paths).not.toContain("qualificationCampaigns:admit");
    expect(
        paths.some(
            (path) => path.startsWith("auth:") || path.includes("generate"),
        ),
    ).toBe(false);
    expect(
        cli.mock.calls.some(
            ([, args]) => args.includes("env") && args.includes("set"),
        ),
    ).toBe(missing === "configured");
    expect(existsSync(join(root, "lots"))).toBe(false);
    const readiness = readFileSync(
        join(root, "configuration-readiness.json"),
        "utf8",
    );
    expect(JSON.parse(readiness)).toMatchObject({
        missing: missing === "configured" ? [] : [missing],
    });
    expect(readiness).not.toContain("fixture-only");
});

const roots: string[] = [];

test("closing an unsettled lot preserves its initial failure and publishes a valid evidence revision", async () => {
    const root = mkdtempSync(join(tmpdir(), "campaign-unsettled-close-"));
    roots.push(root);
    const raw = configurableCampaign();
    const manifest = {
        ...raw,
        executionSurface: "backend",
        batteryHash: createHash("sha256")
            .update(JSON.stringify(raw.scenarios))
            .digest("hex"),
    };
    const directory = join(root, "lots", "lot-1");
    mkdirSync(directory, { recursive: true });
    writeFileSync(
        join(root, "campaign.json"),
        JSON.stringify({
            manifest,
            fingerprints: {},
            campaignId: "fixture-campaign",
        }),
    );
    writeFileSync(
        join(directory, "campaign-lot.json"),
        JSON.stringify({
            manifest,
            fingerprints: {},
            candidateHash: "b".repeat(64),
        }),
    );
    writeFileSync(
        join(directory, "campaign-result.json"),
        JSON.stringify({
            completed: false,
            cleanupCompleted: true,
            evidenceCaptureFailed: false,
            failure: "Original interrupted generation",
            diagnostics: [],
        }),
    );
    writeFileSync(
        join(directory, "reconciliation.json"),
        JSON.stringify({ reconciled: false, usage: manifest.perLot }),
    );
    const first = campaignReviewTemplate(directory);
    writeFileSync(
        join(directory, "review-template.json"),
        JSON.stringify(first),
    );
    const originalIndex = readFileSync(
        join(directory, `evidence-index-${first.evidenceHash}.json`),
        "utf8",
    );
    const flags = new Map<string, string>();
    cli.mockImplementation((_binary, args: string[]) => {
        const env = args.indexOf("env");
        if (env !== -1) {
            const operation = args[env + 1];
            const name = args[env + 2];
            if (operation === "set") {
                const value = args[env + 3];
                if (!name || value === undefined)
                    throw new Error("Incomplete fixture env set");
                flags.set(name, value);
            }
            if (operation === "remove") {
                if (!name) throw new Error("Missing fixture env name");
                flags.delete(name);
            }
        }
        return {
            status: 0,
            stdout: args.includes("list")
                ? [...flags]
                      .map(([name, value]) => `${name}=${value}`)
                      .join("\n")
                : "",
            stderr: "",
        };
    });
    let closed = false;
    const paths: string[] = [];
    vi.stubGlobal(
        "fetch",
        vi.fn<typeof fetch>(async (url, init) => {
            expect(String(url)).toMatch(/^http:\/\/127\.0\.0\.1:3216\//);
            const request = JSON.parse(String(init?.body));
            paths.push(request.path);
            let value: unknown;
            switch (request.path) {
                case "qualificationCampaigns:inspect":
                    value = {
                        campaign: {
                            manifest,
                            activeLotId: "lot",
                            status: closed ? "closed" : "active",
                        },
                        lots: [
                            {
                                _id: "lot",
                                key: "lot-1",
                                status: "closing",
                                contextId: "context",
                                contextKey: "owned-context",
                            },
                        ],
                        coverage: [],
                        continueCursor: null,
                    };
                    break;
                case "qualificationCampaigns:close":
                    closed = true;
                    value = null;
                    break;
                case "qualificationCampaigns:beginCleanup":
                    value = null;
                    break;
                case "qualificationCampaigns:reconcile":
                    value = { reconciled: false, usage: manifest.perLot };
                    break;
                case "execution/piControl:publicationStatus":
                    value = { held: false, hasActiveWorkers: false };
                    break;
                case "auth:signIn":
                    value = {
                        tokens: {
                            token: `e30.${Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 3600 })).toString("base64url")}.offline`,
                            refreshToken: "offline-refresh",
                        },
                    };
                    break;
                case "invitations:claim":
                    value = {};
                    break;
                case "auth:signOut":
                    value = null;
                    break;
                case "runWorkspace:closeBrowserTestContext":
                    value = { done: true, cursor: null, cancelled: 0 };
                    break;
                default:
                    throw new Error(
                        `Unexpected qualification I/O: ${request.path}`,
                    );
            }
            return Response.json({ status: "success", value });
        }),
    );
    await runCampaign("close", root, {});
    expect(closed).toBe(true);
    expect(
        JSON.parse(readFileSync(join(root, "cleanup.json"), "utf8")),
    ).toMatchObject({ completed: true });
    expect(
        JSON.parse(
            readFileSync(join(directory, "campaign-result.json"), "utf8"),
        ),
    ).toMatchObject({
        failure: "Original interrupted generation",
        completed: false,
    });
    expect(
        readFileSync(
            join(directory, `evidence-index-${first.evidenceHash}.json`),
            "utf8",
        ),
    ).toBe(originalIndex);
    const latest = JSON.parse(
        readFileSync(join(directory, "review-template.json"), "utf8"),
    );
    expect(campaignReviewTemplate(directory)).toEqual(latest);
    expect(flags.size).toBe(0);
    expect(paths).not.toContain("qualificationCampaigns:admit");
});

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
