import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { once } from "node:events";
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createQualificationRelay } from "../../../scripts/evaluations/workbench-browser/relay.mjs";

test("normal qualification forwards the first SSE frame before upstream EOF", async () => {
    const root = mkdtempSync(join(tmpdir(), "workbench-relay-"));
    writeFileSync(
        join(root, "control.json"),
        JSON.stringify({
            runId: "unpaid-fixture",
            mode: "live",
            scenario: "streaming-probe",
        }),
    );
    const control = join(root, "control.json");
    writeFileSync(
        join(root, "fingerprints.json"),
        JSON.stringify({
            [control]: createHash("sha256")
                .update(readFileSync(control))
                .digest("hex"),
        }),
    );
    const prefix =
        'data: {"id":"gen-unpaid","choices":[{"index":0,"delta":{"content":"First frame"}}]}\n\n';
    let upstream;
    const relay = createQualificationRelay(
        root,
        "test-key",
        async () =>
            new Response(
                new ReadableStream({
                    start(controller) {
                        upstream = controller;
                        controller.enqueue(new TextEncoder().encode(prefix));
                    },
                }),
                { headers: { "content-type": "text/event-stream" } },
            ),
    );
    relay.listen(0, "127.0.0.1");
    await once(relay, "listening");
    const abort = new AbortController();
    try {
        const request = {
            model: "z-ai/glm-5.3-flash",
            messages: [
                {
                    role: "system",
                    content:
                        'Required current mission state:\n{"mission":{"runId":"unpaid-fixture","id":"mission-fixture"}}',
                },
            ],
            provider: {
                only: ["open-inference/fp4"],
                allow_fallbacks: false,
                require_parameters: true,
                max_price: { prompt: 0.15, completion: 0.6 },
            },
            reasoning: { enabled: true, effort: "low", exclude: true },
            temperature: 0,
            max_tokens: 6144,
        };
        const response = await fetch(
            `http://127.0.0.1:${relay.address().port}/chat/completions`,
            {
                method: "POST",
                body: JSON.stringify(request),
                signal: AbortSignal.any([
                    abort.signal,
                    AbortSignal.timeout(1000),
                ]),
            },
        );
        const reader = response.body.getReader();
        assert.equal(
            new TextDecoder().decode((await reader.read()).value),
            prefix,
        );
        upstream.enqueue(
            new TextEncoder().encode(
                'data: {"usage":{"cost":0.000001}}\n\ndata: [DONE]\n\n',
            ),
        );
        upstream.close();
        while (!(await reader.read()).done) {
            /* Drain the response to settle the ledger. */
        }
        const ledger = readFileSync(join(root, "ledger.jsonl"), "utf8")
            .trim()
            .split("\n")
            .map(JSON.parse);
        assert.deepEqual(
            ledger.map((entry) => entry.event),
            ["dispatch", "response"],
        );
        assert.equal(ledger[1].cost, 0.000001);
    } finally {
        abort.abort();
        try {
            upstream?.close();
        } catch {
            /* The completed stream is already closed. */
        }
        relay.closeAllConnections();
        await new Promise((resolve) => relay.close(resolve));
        rmSync(root, { recursive: true, force: true });
    }
});
