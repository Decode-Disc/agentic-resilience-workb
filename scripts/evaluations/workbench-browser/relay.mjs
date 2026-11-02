import http from "node:http";
import { once } from "node:events";
import {
    readFileSync,
    writeFileSync,
    appendFileSync,
    existsSync,
} from "node:fs";
import { createHash } from "node:crypto";
import { parseEnv } from "node:util";
import { pathToFileURL } from "node:url";

// Retained qualification relay, with its per-lot ledger and explicit fault controls.
export function createQualificationRelay(
    root,
    key,
    providerFetch = globalThis.fetch,
) {
    if (!key) throw new Error("Provider credential unavailable");
    const prior = existsSync(`${root}/ledger.jsonl`)
        ? readFileSync(`${root}/ledger.jsonl`, "utf8")
              .trim()
              .split("\n")
              .filter(Boolean)
              .map(JSON.parse)
        : [];
    let calls = prior.filter((r) => r.event === "dispatch").length,
        reserved = prior
            .filter((r) => r.event === "dispatch")
            .reduce((s, r) => s + r.reserveUsd, 0),
        cost = prior
            .filter((r) => r.event === "response")
            .reduce((s, r) => s + r.cost, 0),
        fatal;
    if (
        prior.some((r) => r.event === "halt") ||
        prior.filter((r) => r.event === "response").length !== calls
    )
        fatal = "Prior unresolved dispatch or halt; no restart retry permitted";
    const gated = new Set(),
        injected = new Set();
    const json = (p, v) =>
        writeFileSync(`${root}/${p}`, `${JSON.stringify(v, null, 2)}\n`);
    const event = (v) =>
        appendFileSync(
            `${root}/ledger.jsonl`,
            `${JSON.stringify({ ...v, at: new Date().toISOString() })}\n`,
        );
    const digest = (v) => createHash("sha256").update(v).digest("hex");
    const pause = (ms) => new Promise((r) => setTimeout(r, ms));
    return http.createServer(async (req, res) => {
        let dispatched = false,
            call,
            control;
        const abort = new AbortController();
        res.once("close", () => abort.abort());
        try {
            if (req.method !== "POST" || req.url !== "/chat/completions")
                throw new Error("Relay endpoint refused");
            const input = [];
            let inputBytes = 0;
            for await (const part of req) {
                inputBytes += part.length;
                if (inputBytes > 131072) throw new Error("Input byte bound");
                input.push(part);
            }
            const text = Buffer.concat(input).toString("utf8");
            control = JSON.parse(readFileSync(`${root}/control.json`, "utf8"));
            if (fatal) throw new Error(fatal);
            const p = JSON.parse(text),
                states = p.messages
                    .filter(
                        (m) =>
                            m.role === "system" &&
                            typeof m.content === "string" &&
                            m.content.includes(
                                "Required current mission state:\n",
                            ),
                    )
                    .map((m) =>
                        JSON.parse(
                            m.content
                                .split("Required current mission state:\n")[1]
                                .split("\n")[0],
                        ),
                    );
            if (
                states.length !== 1 ||
                states[0].mission.runId !== control.runId
            )
                throw new Error("Only the authorized dossier may dispatch");
            json("last-received-request.json", {
                scenario: control.scenario,
                payload: p,
                mode: control.mode,
            });
            if (
                p.model !== "z-ai/glm-5.3-flash" ||
                p.provider?.only?.length !== 1 ||
                p.provider.only[0] !== "open-inference/fp4" ||
                p.provider.allow_fallbacks !== false ||
                p.provider.require_parameters !== true ||
                p.temperature !== 0 ||
                (p.max_tokens ?? p.max_completion_tokens) !== 6144 ||
                p.reasoning?.enabled !== true ||
                p.reasoning?.effort !== "low" ||
                p.reasoning?.exclude !== true
            )
                throw new Error("Route or request contract changed");
            if (
                !Number.isFinite(p.provider.max_price.prompt) ||
                p.provider.max_price.prompt < 0 ||
                p.provider.max_price.prompt > 0.15 ||
                !Number.isFinite(p.provider.max_price.completion) ||
                p.provider.max_price.completion < 0 ||
                p.provider.max_price.completion > 0.6
            )
                throw new Error("Price ceiling changed");
            if (control.mode === "dry") {
                json("dry-request.json", { payload: p, live: false });
                event({
                    event: "dry",
                    live: false,
                    scenario: control.scenario,
                });
                res.writeHead(200, { "content-type": "text/event-stream" });
                return res.end(
                    `data: ${JSON.stringify({ id: "unpaid-relay-check", model: p.model, provider: "Io Net", choices: [{ index: 0, delta: { role: "assistant", content: "Unpaid transport check. No provider was contacted." }, finish_reason: null }] })}\n\ndata: ${JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2, cost: 0 } })}\n\ndata: [DONE]\n\n`,
                );
            }
            if (control.mode !== "live") throw new Error("Paid mode is off");
            const fingerprints = Object.entries(
                JSON.parse(readFileSync(`${root}/fingerprints.json`, "utf8")),
            );
            if (!fingerprints.length)
                throw new Error("Frozen code fingerprints are required");
            for (const [path, hash] of fingerprints)
                if (digest(readFileSync(path)) !== hash)
                    throw new Error("Frozen code changed");
            const reserve =
                ((Buffer.byteLength(text) + 4096) * 0.15) / 1e6 +
                (6144 * 0.6) / 1e6;
            if (calls >= 20 || reserved + reserve > 0.5)
                throw new Error("Authorized aggregate ceiling reached");
            call = ++calls;
            reserved += reserve;
            const scenario = control.scenario;
            json(`request-${call}.json`, {
                call,
                scenario,
                request: p,
                missionId: states[0].mission.id,
                inputHash: digest(
                    p.messages
                        .find(
                            (m) =>
                                m.role === "system" &&
                                typeof m.content === "string" &&
                                m.content.includes(
                                    "Required current mission state:\n",
                                ),
                        )
                        .content.split("Required current mission state:\n")[1]
                        .split("\n")[0],
                ),
                bodySha256: digest(text),
                reserveUsd: reserve,
            });
            const gate = control.hold && !gated.has(scenario);
            if (gate) {
                gated.add(scenario);
                json(`gate-${scenario}.json`, {
                    call,
                    missionId: states[0].mission.id,
                });
            }
            const bufferedFault =
                gate ||
                (control.injectInvalidFraming && !injected.has(scenario));
            event({
                event: "dispatch",
                call,
                scenario,
                reserveUsd: reserve,
                deliveryMode: bufferedFault ? "buffered-fault" : "streaming",
            });
            dispatched = true;
            const start = Date.now();
            const response = await providerFetch(
                "https://openrouter.ai/api/v1/chat/completions",
                {
                    method: "POST",
                    headers: {
                        authorization: `Bearer ${key}`,
                        "content-type": "application/json",
                    },
                    body: text,
                    redirect: "error",
                    signal: AbortSignal.any([
                        abort.signal,
                        AbortSignal.timeout(60000),
                    ]),
                },
            );
            const forwardHeaders = () =>
                res.writeHead(
                    response.status,
                    Object.fromEntries(
                        ["content-type", "x-request-id", "x-generation-id"]
                            .map((name) => [name, response.headers.get(name)])
                            .filter(([, value]) => value),
                    ),
                );
            if (!bufferedFault) forwardHeaders();
            const chunks = [];
            let bytes = 0;
            for await (const chunk of response.body) {
                bytes += chunk.length;
                if (bytes > 1048576) throw new Error("Response byte bound");
                chunks.push(chunk);
                appendFileSync(`${root}/upstream-${call}.sse`, chunk);
                if (!bufferedFault) {
                    if (res.destroyed)
                        throw new Error(
                            "Client disappeared after physical dispatch",
                        );
                    if (!res.write(chunk))
                        await once(res, "drain", { signal: abort.signal });
                    appendFileSync(`${root}/delivered-${call}.sse`, chunk);
                }
            }
            let body = Buffer.concat(chunks).toString("utf8");
            writeFileSync(`${root}/upstream-${call}.sse`, body);
            let usage;
            for (const line of body.split("\n")) {
                if (!line.startsWith("data: ") || line === "data: [DONE]")
                    continue;
                const x = JSON.parse(line.slice(6));
                if (x.usage) usage = x.usage;
            }
            if (!response.ok || !Number.isFinite(usage?.cost) || usage.cost < 0)
                throw new Error("Provider outcome or charge unknown");
            cost += usage.cost;
            event({
                event: "response",
                call,
                scenario,
                status: response.status,
                usage,
                cost: usage.cost,
                elapsedMs: Date.now() - start,
            });
            if (control.injectInvalidFraming && !injected.has(scenario)) {
                let changed = false;
                body = body
                    .split("\n")
                    .map((line) => {
                        if (
                            !line.startsWith("data: ") ||
                            line === "data: [DONE]"
                        )
                            return line;
                        const x = JSON.parse(line.slice(6));
                        for (const c of x.choices ?? [])
                            for (const t of c.delta?.tool_calls ?? []) {
                                if (t.function?.name === "adjust_framing") {
                                    t.function.arguments = "{";
                                    changed = true;
                                } else if (
                                    changed &&
                                    typeof t.function?.arguments === "string"
                                )
                                    t.function.arguments = "";
                            }
                        return `data: ${JSON.stringify(x)}`;
                    })
                    .join("\n");
                if (changed) {
                    injected.add(scenario);
                    json(`fault-${call}.json`, {
                        scenario,
                        kind: "malformed-framing-arguments",
                        disclosure:
                            "Real upstream reply retained unchanged; delivery arguments corrupted once to exercise server refusal and recovery.",
                    });
                }
            }
            if (gate) {
                const until = Date.now() + 20000;
                while (
                    !existsSync(`${root}/release-${scenario}`) &&
                    Date.now() < until
                )
                    await pause(25);
                if (!existsSync(`${root}/release-${scenario}`))
                    throw new Error("Gate was not released within its bound");
            }
            if (res.destroyed)
                throw new Error("Client disappeared after physical dispatch");
            if (bufferedFault) {
                writeFileSync(`${root}/delivered-${call}.sse`, body);
                forwardHeaders();
                res.end(body);
            } else res.end();
            json("relay-summary.json", {
                calls,
                reservedUsd: reserved,
                reportedCostUsd: cost,
                fatal,
            });
        } catch (error) {
            const reason = String(
                error instanceof Error ? error.message : error,
            ).replaceAll(key, "[REDACTED]");
            if (dispatched) {
                fatal = reason;
                event({ event: "halt", call, reason });
            } else
                event({
                    event: "refused_before_dispatch",
                    reason,
                    scenario: control?.scenario,
                });
            json("relay-summary.json", {
                calls,
                reservedUsd: reserved,
                reportedCostUsd: cost,
                fatal,
            });
            if (res.headersSent) {
                res.destroy();
            } else if (!res.destroyed) {
                res.writeHead(400, { "content-type": "application/json" });
                res.end(JSON.stringify({ error: { message: reason } }));
            }
        }
    });
}

if (
    process.argv[1] &&
    import.meta.url === pathToFileURL(process.argv[1]).href
) {
    const root = process.argv[2];
    if (!root)
        throw new Error(
            "Pass the explicitly authorized qualification directory",
        );
    const key = parseEnv(readFileSync(".env.local", "utf8")).OPENROUTER_API_KEY;
    createQualificationRelay(root, key).listen(49176, "127.0.0.1", () =>
        console.log(
            "Bounded qualification relay ready on loopback port 49176; no provider call sent.",
        ),
    );
}
