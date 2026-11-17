// @vitest-environment node

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { requireConversationRequestKey } from "@convex/execution/conversations";
import { campaignManifestSchema } from "@convex/qualificationCampaignPolicy";
import { runCampaignScenarios } from "@evaluations/workbench-browser/scenarios";
import { ConvexHttpClient } from "convex/browser";
import { afterEach, assert, expect, test } from "vitest";
import { configurableCampaign } from "@/__tests__/setup/qualification-v2";

const roots: string[] = [];
afterEach(() => {
    for (const root of roots.splice(0))
        rmSync(root, { recursive: true, force: true });
});

test("backend message keys accept the longest step identity, retain retry identity and distinguish steps and dossiers", async () => {
    async function run(fixtureKey: string, stepId: string) {
        const base = configurableCampaign();
        const manifest = campaignManifestSchema.parse({
            ...base,
            executionSurface: "backend",
            mode: "deterministic",
            batteryHash: "a".repeat(64),
            scenarios: [
                {
                    ...base.scenarios[0],
                    steps: [
                        {
                            id: stepId,
                            action: "send_message",
                            text: "Explain the current scope.",
                        },
                    ],
                },
            ],
            expectations: [base.expectations[0]],
            perLot: { model: 0, search: 0, acquisition: 0, costUsd: 0 },
            total: { model: 0, search: 0, acquisition: 0, costUsd: 0 },
        });
        assert(manifest.version === 2);
        const root = mkdtempSync(join(tmpdir(), "backend-request-key-"));
        roots.push(root);
        writeFileSync(
            join(root, "protocol.json"),
            `${JSON.stringify({ boundary: "backend" }, null, 2)}\n`,
        );
        writeFileSync(
            join(root, "prepared.json"),
            JSON.stringify({
                cases: [{ id: "claims", runId: "run", fixtureKey }],
            }),
        );
        const snapshot = {
            nativeSettled: true,
            conversation: { activeTurnId: null, queuedCount: 0 },
            run: { executionStatus: "idle" },
            lastMessage: null as null | { _id: string; text: string },
        };
        let key = "";
        // Only HTTP is simulated; the real client, interpreter and production validator run.
        const transport: typeof fetch = async (_input, init) => {
            expect(typeof init?.body).toBe("string");
            const request: unknown = JSON.parse(String(init?.body));
            if (!request || typeof request !== "object" || !("path" in request))
                throw new Error("Expected a Convex RPC request");
            let value: unknown = null;
            if (request.path === "execution/fixtures:qualificationSnapshot")
                value = snapshot;
            else if (request.path === "visitors:current")
                value = { status: "active" };
            else if (request.path === "execution/conversations:submit") {
                if (!("args" in request) || !Array.isArray(request.args))
                    throw new Error("Expected RPC arguments");
                const args: unknown = request.args[0];
                if (
                    !args ||
                    typeof args !== "object" ||
                    !("requestKey" in args) ||
                    typeof args.requestKey !== "string"
                )
                    throw new Error("Expected a request identity");
                requireConversationRequestKey(args.requestKey);
                key = args.requestKey;
                snapshot.lastMessage = {
                    _id: "reply",
                    text: "Scope explanation retained",
                };
            } else if (request.path !== "execution/fixtures:activateWorkbench")
                value = {
                    page: [],
                    payloads: [],
                    downloads: [],
                    isDone: true,
                    continueCursor: "",
                };
            return new Response(JSON.stringify({ status: "success", value }), {
                status: 200,
                headers: { "Content-Type": "application/json" },
            });
        };
        const client = new ConvexHttpClient("http://127.0.0.1:3210", {
            logger: false,
            fetch: transport,
        });
        await runCampaignScenarios(
            null,
            client,
            undefined,
            client.url,
            root,
            manifest,
            () => false,
            client,
        );
        const retained = JSON.parse(
            readFileSync(join(root, `claims/${stepId}-after.json`), "utf8"),
        );
        expect(retained.lastMessage.text).toBe("Scope explanation retained");
        expect(key.length).toBeLessThanOrEqual(120);
        return key;
    }
    const fixture = "scenario-00000000-0000-4000-8000-000000000000";
    const id = "a".repeat(80);
    const first = await run(fixture, id);
    expect(await run(fixture, id)).toBe(first);
    expect(await run(fixture, `${"a".repeat(79)}b`)).not.toBe(first);
    expect(
        await run("scenario-00000000-0000-4000-8000-000000000001", id),
    ).not.toBe(first);
});
