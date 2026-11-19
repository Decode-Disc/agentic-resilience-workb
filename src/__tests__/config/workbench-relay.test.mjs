import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { once } from "node:events";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
    createQualificationRelay,
    readRelayContinuation,
} from "../../../scripts/evaluations/workbench-browser/relay.mjs";

function relayMissionState(id) {
    return (
        "Required current mission state:\n" +
        JSON.stringify({
            mission: { runId: "unpaid-fixture", id },
            constraints: {
                resourcePolicy: "authority_native_v1",
                deadlineAt: Date.now() + 90000,
            },
        })
    );
}
function authorizeRelayFixture(root, maximumRequests = 20) {
    writeFileSync(
        join(root, "protocol.json"),
        JSON.stringify({
            version: 3,
            resourcePolicy: "authority_native_v1",
            manifest: { version: 3, costAccountingPolicy: "known_final_v1" },
            maximumRequests,
            maximumCostUsd: 0.5,
        }),
    );
    writeFileSync(
        join(root, "relay-route.json"),
        JSON.stringify({
            resourcePolicy: "authority_native_v1",
            deadlineAt: Date.now() + 120000,
            costAccountingPolicy: "known_final_v1",
            model: "z-ai/glm-5.3-flash",
            reasoningEffort: "low",
            descriptor: {
                contextWindow: 131072,
                maxTokens: 8192,
                inputPrice: 0.15,
                outputPrice: 0.6,
            },
        }),
    );
    writeFileSync(
        join(root, "validation.json"),
        JSON.stringify({
            status: "passed",
            fingerprintsSha256: createHash("sha256")
                .update(readFileSync(join(root, "fingerprints.json")))
                .digest("hex"),
        }),
    );
}

test("relay rejects a malformed retained protocol before any provider call", () => {
    const root = mkdtempSync(join(tmpdir(), "relay-invalid-protocol-"));
    try {
        writeFileSync(join(root, "protocol.json"), "{");
        assert.throws(
            () =>
                createQualificationRelay(root, "synthetic-key", () =>
                    assert.fail("no provider call"),
                ),
            /Invalid retained qualification protocol/,
        );
    } finally {
        rmSync(root, { recursive: true, force: true });
    }
});

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
    authorizeRelayFixture(root);
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
                    content: relayMissionState("mission-fixture"),
                },
            ],
            provider: {
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
                'data: {"choices":[{"finish_reason":"stop"}],"usage":{"cost":0.000001}}\n\ndata: [DONE]\n\n',
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

async function withRelay(providerFetch, check, maximumRequests) {
    const root = mkdtempSync(join(tmpdir(), "workbench-relay-outcome-"));
    const fixture = join(root, "code.txt");
    writeFileSync(fixture, "frozen unpaid probe");
    writeFileSync(
        join(root, "fingerprints.json"),
        JSON.stringify({
            [fixture]: createHash("sha256")
                .update(readFileSync(fixture))
                .digest("hex"),
        }),
    );
    authorizeRelayFixture(root, maximumRequests);
    let relay;
    const restart = async () => {
        if (relay) {
            relay.closeAllConnections();
            await new Promise((resolve) => relay.close(resolve));
        }
        relay = createQualificationRelay(root, "test-key", providerFetch);
        relay.listen(0, "127.0.0.1");
        await once(relay, "listening");
    };
    const request = async (scenario, overrides = {}) => {
        writeFileSync(
            join(root, "control.json"),
            JSON.stringify({
                runId: "unpaid-fixture",
                mode: "live",
                scenario,
            }),
        );
        const body = JSON.stringify({
            model: "z-ai/glm-5.3-flash",
            messages: [
                {
                    role: "system",
                    content: relayMissionState("mission-fixture"),
                },
            ],
            provider: {
                require_parameters: true,
                max_price: { prompt: 0.15, completion: 0.6 },
            },
            reasoning: { enabled: true, effort: "low", exclude: true },
            temperature: 0,
            max_tokens: 6144,
            ...overrides,
        });
        return fetch(
            `http://127.0.0.1:${relay.address().port}/chat/completions`,
            {
                method: "POST",
                headers: {
                    "x-workbench-relay-dispatch": JSON.stringify({
                        invocationId: "fixture-invocation",
                        generation: 1,
                        bodyHash: createHash("sha256")
                            .update(body)
                            .digest("hex"),
                    }),
                },
                body,
                signal: AbortSignal.timeout(2000),
            },
        );
    };
    const send = async (scenario, overrides) => {
        const response = await request(scenario, overrides);
        return {
            status: response.status,
            body: await response.text(),
            retryAfter: response.headers.get("retry-after"),
        };
    };
    try {
        await restart();
        await check({
            root,
            send,
            request,
            restart,
            ledger: () =>
                readFileSync(join(root, "ledger.jsonl"), "utf8")
                    .trim()
                    .split("\n")
                    .map(JSON.parse),
        });
    } finally {
        relay.closeAllConnections();
        await new Promise((resolve) => relay.close(resolve));
        rmSync(root, { recursive: true, force: true });
    }
}
test("local refusal retains exact non-dispatch proof before acknowledging it", async () => {
    await withRelay(
        async () => assert.fail("provider must not be called"),
        async ({ request, ledger }) => {
            const response = await request("local-refusal", { temperature: 1 });
            assert.equal(response.status, 400);
            const proof = JSON.parse(
                response.headers.get("x-workbench-relay-not-dispatched") ??
                    "null",
            );
            assert.equal(proof?.invocationId, "fixture-invocation");
            assert.equal(proof?.generation, 1);
            assert.match(proof?.bodyHash ?? "", /^[a-f0-9]{64}$/);
            assert.deepEqual(
                ledger().find((e) => e.event === "refused_before_dispatch")
                    .correlation,
                proof,
            );
        },
    );
});

test("relay carries remaining native authority and full prepared capacity into dispatch", async (t) => {
    const now = Date.now();
    t.mock.method(Date, "now", () => now);
    const timeout = AbortSignal.timeout.bind(AbortSignal);
    let latestTimeout;
    let dispatchedTimeout;
    t.mock.method(AbortSignal, "timeout", (ms) => {
        latestTimeout = ms;
        return timeout(ms);
    });
    await withRelay(
        async (_url, init) => {
            dispatchedTimeout = latestTimeout;
            assert.equal(init.signal.aborted, false);
            return complete();
        },
        async ({ send, ledger }) => {
            assert.equal((await send("native-authority")).status, 200);
            assert.equal(dispatchedTimeout, 90000);
            assert.equal(
                ledger().find((r) => r.event === "dispatch").reserveUsd,
                0.0233472,
            );
        },
    );
});

for (const resourcePolicy of [undefined, "unsupported"])
    test(`relay refuses retained policy ${resourcePolicy} without inference`, async () => {
        let calls = 0;
        await withRelay(
            async () => {
                calls++;
                return complete();
            },
            async ({ root, restart }) => {
                const path = join(root, "protocol.json");
                const protocol = JSON.parse(readFileSync(path, "utf8"));
                writeFileSync(
                    path,
                    JSON.stringify({ ...protocol, resourcePolicy }),
                );
                await assert.rejects(restart(), /resource_policy_unsupported/);
                assert.equal(calls, 0);
            },
        );
    });

test("relay rejects exhausted absolute authority before upstream I/O", async (t) => {
    let calls = 0;
    const future = Date.now() + 180000;
    await withRelay(
        async () => {
            calls++;
            return complete();
        },
        async ({ send }) => {
            t.mock.method(Date, "now", () => future);
            const result = await send("expired-authority");
            assert.equal(result.status, 400);
            assert.match(result.body, /execution_deadline/);
            assert.equal(calls, 0);
        },
    );
});

const complete = (usage = { cost: 0.000001 }) =>
    new Response(
        `data: ${JSON.stringify({ id: "gen-unpaid", provider: "Unpaid fixture", choices: [{ delta: { content: "Complete" }, finish_reason: "stop" }], usage })}\n\ndata: [DONE]\n\n`,
        { headers: { "content-type": "text/event-stream" } },
    );

test("relay forwards the Workbench price ceiling even when the catalogue price is lower", async () => {
    let dispatches = 0;
    await withRelay(
        async (_url, init) => {
            dispatches++;
            assert.deepEqual(JSON.parse(init.body).provider.max_price, {
                prompt: 0.15,
                completion: 0.6,
            });
            return complete({ cost: 0.023 });
        },
        async ({ root, send, ledger }) => {
            const path = join(root, "relay-route.json");
            const route = JSON.parse(readFileSync(path, "utf8"));
            route.descriptor.outputPrice = 0.5;
            writeFileSync(path, JSON.stringify(route));
            assert.equal((await send("nvidia-framing")).status, 200);
            const events = ledger();
            assert.deepEqual(
                events.map((event) => event.event),
                ["dispatch", "response"],
            );
            assert.equal(events[0].reserveUsd, 0.0233472);
            assert.equal(events[1].cost, 0.023);
            const over = await send("above-workbench-ceiling", {
                provider: {
                    require_parameters: true,
                    max_price: { prompt: 0.15, completion: 0.61 },
                },
            });
            assert.equal(over.status, 400);
            assert.match(over.body, /Price ceiling changed/);
            assert.equal(dispatches, 1);
        },
    );
});

test("relay admits against settled charges and retains unknown charges across restart", async () => {
    let calls = 0;
    await withRelay(
        async () => (++calls === 1 ? complete({ cost: 0.001 }) : complete({})),
        async ({ root, send, restart, ledger }) => {
            const path = join(root, "protocol.json");
            const protocol = JSON.parse(readFileSync(path, "utf8"));
            protocol.manifest.costAccountingPolicy = "known_final_v1";
            protocol.maximumCostUsd = 0.037;
            writeFileSync(path, JSON.stringify(protocol));
            await restart();
            assert.equal((await send("settled")).status, 200);
            await restart();
            assert.equal((await send("unknown-charge")).status, 200);
            await restart();
            const blocked = await send("exhausted");
            assert.equal(blocked.status, 400);
            assert.match(blocked.body, /Authorized aggregate ceiling reached/);
            assert.equal(calls, 2);
            assert.deepEqual(
                ledger()
                    .filter((event) => event.event === "response")
                    .map(({ billing, cost }) => ({ billing, cost })),
                [
                    { billing: "reported", cost: 0.001 },
                    { billing: "unknown", cost: undefined },
                ],
            );
        },
    );
});

test("contradictory final costs for one dispatch remain blocked after ledger replay", async () => {
    let calls = 0;
    await withRelay(
        async () => {
            calls++;
            return complete({ cost: 0.001 });
        },
        async ({ root, send, restart, ledger }) => {
            assert.equal((await send("first-cost")).status, 200);
            const response = ledger().find(
                (entry) => entry.event === "response",
            );
            const path = join(root, "ledger.jsonl");
            writeFileSync(
                path,
                readFileSync(path, "utf8") +
                    JSON.stringify({ ...response, cost: 0.002 }) +
                    "\n",
            );
            await restart();
            const blocked = await send("after-conflict");
            assert.equal(blocked.status, 400);
            assert.match(blocked.body, /Conflicting provider cost/);
            assert.equal(calls, 1);
        },
    );
});

test("a received 429 survives restart and permits an independent scenario without erasing its charge reservation", async () => {
    let calls = 0;
    await withRelay(
        async () =>
            ++calls === 1
                ? new Response('{"error":{"message":"Rate limited"}}', {
                      status: 429,
                      headers: { "retry-after": "30" },
                  })
                : complete(),
        async ({ send, restart, ledger }) => {
            const refused = await send("refused");
            assert.equal(refused.status, 429);
            assert.equal(refused.retryAfter, "30");
            await restart();
            assert.equal((await send("independent")).status, 200);
            assert.equal(calls, 2);
            const entries = ledger();
            assert.equal(entries.filter((x) => x.event === "halt").length, 0);
            const refusal = entries.find(
                (x) => x.event === "response" && x.status === 429,
            );
            assert.equal(refusal.billing, "unknown");
            assert.equal(refusal.outcome, "http_refusal");
            assert.ok(
                entries
                    .filter((x) => x.event === "dispatch")
                    .reduce((sum, x) => sum + x.reserveUsd, 0) > 0.007,
            );
        },
    );
});

test("a missing charge is retained without preventing a later completed scenario", async () => {
    let calls = 0;
    await withRelay(
        async () => complete(++calls === 1 ? {} : { cost: 0.000001 }),
        async ({ send, restart, ledger }) => {
            assert.equal((await send("unpriced")).status, 200);
            await restart();
            assert.equal((await send("next")).status, 200);
            const responses = ledger().filter((x) => x.event === "response");
            assert.equal(responses[0].billing, "unknown");
            assert.equal(responses[0].cost, undefined);
            assert.equal(responses[1].cost, 0.000001);
        },
    );
});

test("an ambiguous dispatch cannot replay its scenario after restart but retains budget for independent work", async () => {
    let calls = 0;
    await withRelay(
        async () => {
            if (++calls === 1)
                throw new Error("upstream connection disappeared");
            return complete();
        },
        async ({ send, restart, ledger }) => {
            assert.equal((await send("ambiguous")).status, 400);
            await restart();
            assert.match((await send("ambiguous")).body, /cannot be replayed/);
            assert.equal(calls, 1);
            assert.equal((await send("independent")).status, 200);
            assert.equal(
                ledger().filter((x) => x.event === "dispatch").length,
                2,
            );
            assert.equal(
                ledger().filter((x) => x.event === "uncertain").length,
                1,
            );
        },
    );
});

test("a scenario respects Retry-After and admits at most one controlled recovery", async (t) => {
    let now = 100000,
        calls = 0;
    t.mock.method(Date, "now", () => now);
    await withRelay(
        async () => {
            calls++;
            return new Response("Rate limited", {
                status: 429,
                headers: { "retry-after": "30" },
            });
        },
        async ({ send }) => {
            assert.equal((await send("rate-limited")).status, 429);
            now += 16000;
            assert.equal((await send("rate-limited")).status, 400);
            assert.equal(calls, 1);
            now += 15000;
            assert.equal((await send("rate-limited")).status, 429);
            now += 31000;
            assert.equal((await send("rate-limited")).status, 400);
            assert.equal(calls, 2);
        },
    );
});

test("the cumulative twenty-request ceiling survives relay restart", async () => {
    let calls = 0;
    await withRelay(
        async () => {
            calls++;
            return complete();
        },
        async ({ send, restart, ledger }) => {
            for (let index = 0; index < 20; index++)
                assert.equal((await send(`case-${index}`)).status, 200);
            await restart();
            assert.match((await send("over-budget")).body, /ceiling reached/);
            assert.equal(calls, 20);
            assert.equal(
                ledger().filter((x) => x.event === "dispatch").length,
                20,
            );
        },
    );
});

test("a reported charge outside its reserved envelope stops further dispatch", async () => {
    let calls = 0;
    await withRelay(
        async () => {
            calls++;
            return complete({ cost: 0.1 });
        },
        async ({ send, ledger }) => {
            await send("unexpected-charge");
            assert.equal((await send("independent")).status, 400);
            assert.equal(calls, 1);
            assert.equal(ledger().filter((x) => x.event === "halt").length, 1);
        },
    );
});

test("EOF without a terminal SSE event remains an uncertain execution", async () => {
    let calls = 0;
    await withRelay(
        async () =>
            ++calls === 1
                ? new Response(
                      'data: {"id":"gen-incomplete","choices":[{"delta":{"content":"Partial"}}]}\n\n',
                      { headers: { "content-type": "text/event-stream" } },
                  )
                : complete(),
        async ({ send, ledger }) => {
            await send("incomplete").catch(() => undefined);
            assert.match((await send("incomplete")).body, /cannot be replayed/);
            assert.equal(calls, 1);
            assert.equal(
                ledger().filter((x) => x.event === "uncertain").length,
                1,
            );
        },
    );
});

test("closing after terminal SSE retains the completed response and charge without waiting for HTTP EOF", async () => {
    let calls = 0,
        upstreamAborted;
    const aborted = new Promise((resolve) => {
        upstreamAborted = resolve;
    });
    await withRelay(
        async (_url, init) => {
            if (++calls > 1) return complete();
            const body = (await complete().text()).replaceAll("\n", "\r\n");
            return new Response(
                new ReadableStream({
                    start(controller) {
                        controller.enqueue(new TextEncoder().encode(body));
                        init.signal.addEventListener(
                            "abort",
                            () => {
                                controller.error(
                                    new DOMException(
                                        "Client closed after terminal event",
                                        "AbortError",
                                    ),
                                );
                                upstreamAborted();
                            },
                            { once: true },
                        );
                    },
                }),
                { headers: { "content-type": "text/event-stream" } },
            );
        },
        async ({ request, send, restart, ledger }) => {
            const response = await request("completed-before-eof");
            const reader = response.body.getReader();
            await reader.read();
            await reader.cancel();
            await aborted;
            await new Promise((resolve) => setImmediate(resolve));
            const outcome = ledger().find(
                (entry) => entry.event === "response",
            );
            assert.equal(outcome?.cost, 0.000001);
            assert.equal(outcome.outcome, "response_received");
            assert.equal(outcome.transport, "closed_after_terminal");
            assert.equal(
                ledger().filter((entry) => entry.event === "uncertain").length,
                0,
            );
            await restart();
            assert.equal((await send("independent")).status, 200);
            assert.equal(
                ledger()
                    .filter((entry) => entry.event === "response")
                    .reduce((sum, entry) => sum + (entry.cost ?? 0), 0),
                0.000002,
            );
        },
    );
});

test("a smaller authorized request allowance stops before another upstream call", async () => {
    let calls = 0;
    await withRelay(
        async () => {
            calls++;
            return complete();
        },
        async ({ send }) => {
            assert.equal((await send("first")).status, 200);
            assert.equal((await send("second")).status, 400);
            assert.equal(calls, 1);
        },
        1,
    );
});

test("a versioned qualification refuses inference before a passing validation of these fingerprints", async () => {
    let calls = 0;
    await withRelay(
        async () => {
            calls++;
            return complete();
        },
        async ({ root, send, restart }) => {
            writeFileSync(
                join(root, "protocol.json"),
                JSON.stringify({
                    ...JSON.parse(
                        readFileSync(join(root, "protocol.json"), "utf8"),
                    ),
                    version: 3,
                }),
            );
            rmSync(join(root, "validation.json"));
            await restart();
            assert.equal((await send("unchecked")).status, 400);
            assert.equal(calls, 0);
            writeFileSync(
                join(root, "validation.json"),
                JSON.stringify({
                    status: "failed",
                    fingerprintsSha256: "wrong",
                }),
            );
            assert.equal((await send("failed-checks")).status, 400);
            assert.equal(calls, 0);
            const fingerprintsSha256 = createHash("sha256")
                .update(readFileSync(join(root, "fingerprints.json")))
                .digest("hex");
            writeFileSync(
                join(root, "validation.json"),
                JSON.stringify({ status: "passed", fingerprintsSha256 }),
            );
            assert.equal((await send("validated")).status, 200);
            assert.equal(calls, 1);
        },
    );
});

for (const version of [2, 3])
    test(`a v${version} campaign relay accepts its frozen route and allowance above legacy samples`, async () => {
        const root = mkdtempSync(join(tmpdir(), "relay-v2-"));
        const fixture = join(root, "frozen.txt");
        writeFileSync(fixture, "retained");
        const fingerprints = {
            [fixture]: createHash("sha256").update("retained").digest("hex"),
        };
        writeFileSync(
            join(root, "fingerprints.json"),
            JSON.stringify(fingerprints),
        );
        writeFileSync(
            join(root, "validation.json"),
            JSON.stringify({
                status: "passed",
                fingerprintsSha256: createHash("sha256")
                    .update(readFileSync(join(root, "fingerprints.json")))
                    .digest("hex"),
            }),
        );
        writeFileSync(
            join(root, "protocol.json"),
            JSON.stringify({
                version: 3,
                resourcePolicy: "authority_native_v1",
                manifest: { version, costAccountingPolicy: "known_final_v1" },
                maximumRequests: 24,
                maximumCostUsd: 4,
            }),
        );
        writeFileSync(
            join(root, "relay-route.json"),
            JSON.stringify({
                resourcePolicy: "authority_native_v1",
                deadlineAt: Date.now() + 120000,
                costAccountingPolicy: "known_final_v1",
                model: "fixture/alternative",
                reasoningEffort: "high",
                descriptor: {
                    contextWindow: 1048576,
                    maxTokens: 12000,
                    inputPrice: 0.15,
                    outputPrice: 0.5,
                },
            }),
        );
        writeFileSync(
            join(root, "control.json"),
            JSON.stringify({
                runId: "unpaid-fixture",
                mode: "live",
                scenario: "free-scenario",
            }),
        );
        let dispatches = 0;
        let relay;
        try {
            relay = createQualificationRelay(root, "fixture-key", async () => {
                dispatches++;
                return new Response(
                    'data: {"choices":[{"finish_reason":"stop"}],"usage":{"cost":0}}\n\ndata: [DONE]\n\n',
                    { headers: { "content-type": "text/event-stream" } },
                );
            });
            relay.listen(0, "127.0.0.1");
            await once(relay, "listening");
            const request = {
                model: "fixture/alternative",
                messages: [
                    {
                        role: "system",
                        content: relayMissionState("fixture"),
                    },
                ],
                max_tokens: 12000,
                provider: {
                    require_parameters: true,
                    max_price: { prompt: 0.15, completion: 0.6 },
                },
                reasoning: { enabled: true, effort: "high", exclude: true },
                temperature: 0,
            };
            for (let i = 0; i < 24; i++) {
                const r = await fetch(
                    `http://127.0.0.1:${relay.address().port}/chat/completions`,
                    { method: "POST", body: JSON.stringify(request) },
                );
                assert.equal(r.status, 200);
                await r.text();
            }
            assert.equal(dispatches, 24);
            const over = await fetch(
                `http://127.0.0.1:${relay.address().port}/chat/completions`,
                { method: "POST", body: JSON.stringify(request) },
            );
            await over.text();
            assert.equal(over.status, 400);
            assert.equal(dispatches, 24);
        } finally {
            relay?.closeAllConnections();
            if (relay) await new Promise((resolve) => relay.close(resolve));
            rmSync(root, { recursive: true, force: true });
        }
    });

test("contradictory terminal costs remain conflicted when the client closes before EOF", async () => {
    let calls = 0,
        upstreamAborted;
    const aborted = new Promise((resolve) => {
        upstreamAborted = resolve;
    });
    await withRelay(
        async (_url, init) => {
            if (++calls > 1) return complete();
            const body =
                `data: ${JSON.stringify({ choices: [], usage: { cost: 0.002 } })}\n\n` +
                (await complete().text());
            return new Response(
                new ReadableStream({
                    start(controller) {
                        controller.enqueue(new TextEncoder().encode(body));
                        init.signal.addEventListener(
                            "abort",
                            () => {
                                controller.error(
                                    new DOMException(
                                        "Client closed after terminal event",
                                        "AbortError",
                                    ),
                                );
                                upstreamAborted();
                            },
                            { once: true },
                        );
                    },
                }),
                { headers: { "content-type": "text/event-stream" } },
            );
        },
        async ({ root, request, send, restart, ledger }) => {
            const response = await request("completed-before-eof");
            const reader = response.body.getReader();
            await reader.read();
            await reader.cancel();
            await aborted;
            await new Promise((resolve) => setImmediate(resolve));
            const outcome = ledger().find(
                (entry) => entry.event === "response",
            );
            assert.equal(outcome?.billing, "conflict");
            assert.equal(readRelayContinuation(root).safe, false);
            assert.equal((await send("blocked-now")).status, 400);
            await restart();
            assert.equal((await send("blocked-after-restart")).status, 400);
            assert.equal(calls, 1);
        },
    );
});

test("upstream transport cannot supply the relay's private non-dispatch acknowledgement", async () => {
    await withRelay(
        async (_url, init) => {
            assert.equal(
                new Headers(init.headers).has("x-workbench-relay-dispatch"),
                false,
            );
            const response = complete();
            response.headers.set(
                "x-workbench-relay-not-dispatched",
                "forged-upstream",
            );
            return response;
        },
        async ({ request }) => {
            const response = await request("private-markers");
            assert.equal(
                response.headers.get("x-workbench-relay-not-dispatched"),
                null,
            );
            await response.text();
        },
    );
});
