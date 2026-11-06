import { createHash } from "node:crypto";
import { once } from "node:events";
import {
    appendFileSync,
    existsSync,
    readFileSync,
    writeFileSync,
} from "node:fs";
import http from "node:http";
import { pathToFileURL } from "node:url";
import { parseEnv } from "node:util";

/** Retains observable provider facts even when the consumer closes after the terminal SSE frame. */
function sseFacts(body) {
    let usage, cost, generationId, provider;
    let terminal = false,
        done = false,
        invalidFrame = false;
    for (const raw of body.split("\n")) {
        const line = raw.trimEnd();
        if (line === "data: [DONE]") {
            done = true;
            continue;
        }
        if (!line.startsWith("data: ")) continue;
        let frame;
        try {
            frame = JSON.parse(line.slice(6));
        } catch {
            invalidFrame = true;
            continue;
        }
        if (!frame || typeof frame !== "object" || Array.isArray(frame)) {
            invalidFrame = true;
            continue;
        }
        if (frame.usage) usage = frame.usage;
        if (Number.isFinite(frame.usage?.cost) && frame.usage.cost >= 0)
            cost = frame.usage.cost;
        if (
            Array.isArray(frame.choices) &&
            frame.choices.some(
                (choice) => choice && typeof choice.finish_reason === "string",
            )
        )
            terminal = true;
        if (typeof frame.id === "string") generationId = frame.id;
        if (typeof frame.provider === "string") provider = frame.provider;
    }
    return {
        usage,
        cost,
        generationId,
        provider,
        terminal,
        done,
        invalidFrame,
    };
}

// Retained qualification relay, with its per-lot ledger and explicit fault controls.
export function createQualificationRelay(
    root,
    key,
    providerFetch = globalThis.fetch,
) {
    if (!key) throw new Error("Provider credential unavailable");
    const protocol = existsSync(`${root}/protocol.json`)
        ? JSON.parse(readFileSync(`${root}/protocol.json`, "utf8"))
        : null;
    const configurable = protocol?.manifest?.version === 2;
    const maximumRequests = protocol?.maximumRequests ?? 20;
    const maximumCostUsd = configurable ? protocol.maximumCostUsd : 0.5;
    if (
        !Number.isSafeInteger(maximumRequests) ||
        maximumRequests < 1 ||
        (!configurable && maximumRequests > 20) ||
        !Number.isFinite(maximumCostUsd) ||
        maximumCostUsd <= 0
    )
        throw new Error("Invalid qualification request allowance");
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
            .filter((r) => r.event === "response" || r.event === "uncertain")
            .reduce((s, r) => s + (r.cost ?? 0), 0),
        fatal;
    if (
        prior.some((r) => r.event === "halt") ||
        prior.some(
            (r) =>
                r.event === "dispatch" &&
                !prior.some(
                    (outcome) =>
                        outcome.call === r.call &&
                        ["response", "uncertain"].includes(outcome.event),
                ),
        )
    )
        fatal = "Prior unresolved dispatch or halt; no restart retry permitted";
    const gated = new Set(
            prior
                .filter((e) => e.event === "gate_armed")
                .map((e) => e.scenario),
        ),
        injected = new Set(
            prior
                .filter((e) => e.event === "fault_applied")
                .map((e) => e.scenario),
        );
    const json = (p, v) =>
        writeFileSync(`${root}/${p}`, `${JSON.stringify(v, null, 2)}\n`);
    const event = (v) => {
        const entry = { ...v, at: new Date().toISOString() };
        appendFileSync(`${root}/ledger.jsonl`, `${JSON.stringify(entry)}\n`);
        prior.push(entry);
    };
    const digest = (v) => createHash("sha256").update(v).digest("hex");
    const pause = (ms) => new Promise((r) => setTimeout(r, ms));
    return http.createServer(async (req, res) => {
        let dispatched = false,
            call,
            control,
            httpStatus,
            startedAt,
            responseRecorded = false;
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
            if (
                prior.some(
                    (entry) =>
                        entry.event === "uncertain" &&
                        entry.scenario === control.scenario,
                )
            )
                throw new Error(
                    "Uncertain execution cannot be replayed in the same scenario",
                );
            const refusals = prior.filter(
                (entry) =>
                    entry.event === "response" &&
                    entry.scenario === control.scenario &&
                    entry.outcome === "http_refusal",
            );
            const refusal = refusals.at(-1);
            if (
                refusal &&
                (refusals.length >= 2 ||
                    !refusal.retryable ||
                    Date.now() < refusal.retryAfterAt)
            )
                throw new Error(
                    "Scenario recovery is unavailable or still cooling down",
                );
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
            const route = configurable
                ? JSON.parse(readFileSync(`${root}/relay-route.json`, "utf8"))
                : null;
            const inputPrice = route?.descriptor.inputPrice ?? 0.15,
                outputPrice = route?.descriptor.outputPrice ?? 0.6,
                maxTokens = route?.descriptor.maxTokens ?? 6144;
            if (configurable) {
                if (
                    p.model !== route.model ||
                    p.temperature !== 0 ||
                    (p.max_tokens ?? p.max_completion_tokens) > maxTokens ||
                    !Number.isSafeInteger(
                        p.max_tokens ?? p.max_completion_tokens,
                    ) ||
                    (p.max_tokens ?? p.max_completion_tokens) < 1 ||
                    p.reasoning?.effort !== route.reasoningEffort ||
                    (route.provider
                        ? JSON.stringify(p.provider?.only) !==
                          JSON.stringify([route.provider])
                        : p.provider?.only !== undefined) ||
                    p.provider?.require_parameters !== true
                )
                    throw new Error("Route or request contract changed");
                if (
                    !Number.isFinite(p.provider.max_price?.prompt) ||
                    p.provider.max_price.prompt < 0 ||
                    p.provider.max_price.prompt > inputPrice ||
                    !Number.isFinite(p.provider.max_price.completion) ||
                    p.provider.max_price.completion < 0 ||
                    p.provider.max_price.completion > outputPrice
                )
                    throw new Error("Price ceiling changed");
            } else {
                if (
                    p.model !== "z-ai/glm-5.3-flash" ||
                    p.provider?.only !== undefined ||
                    p.provider?.order !== undefined ||
                    p.provider?.allow_fallbacks === false ||
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
            }
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
            const protocol = existsSync(`${root}/protocol.json`)
                ? JSON.parse(readFileSync(`${root}/protocol.json`, "utf8"))
                : null;
            if (protocol?.version >= 2) {
                const validation = JSON.parse(
                    readFileSync(`${root}/validation.json`, "utf8"),
                );
                if (
                    validation.status !== "passed" ||
                    validation.fingerprintsSha256 !==
                        digest(readFileSync(`${root}/fingerprints.json`))
                )
                    throw new Error("Candidate validation is missing or stale");
            }
            const fingerprints = Object.entries(
                JSON.parse(readFileSync(`${root}/fingerprints.json`, "utf8")),
            );
            if (!fingerprints.length)
                throw new Error("Frozen code fingerprints are required");
            for (const [path, hash] of fingerprints)
                if (digest(readFileSync(path)) !== hash)
                    throw new Error("Frozen code changed");
            const reserve =
                ((Buffer.byteLength(text) + 4096) * inputPrice) / 1e6 +
                ((p.max_tokens ?? p.max_completion_tokens) * outputPrice) / 1e6;
            if (
                calls >= maximumRequests ||
                reserved + reserve > maximumCostUsd
            ) {
                event({
                    event: "budget_exhausted",
                    scenario: control.scenario,
                });
                throw new Error("Authorized aggregate ceiling reached");
            }
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
                event({ event: "gate_armed", scenario, call });
                gated.add(scenario);
                json(`gate-${scenario}.json`, {
                    call,
                    missionId: states[0].mission.id,
                });
            }
            const bufferedFault =
                gate ||
                ((control.injectInvalidFraming || control.injectHttpRefusal) &&
                    !injected.has(scenario));
            event({
                event: "dispatch",
                call,
                scenario,
                reserveUsd: reserve,
                deliveryMode: bufferedFault ? "buffered-fault" : "streaming",
            });
            dispatched = true;
            startedAt = Date.now();
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
            httpStatus = response.status;
            const forwardHeaders = () =>
                res.writeHead(
                    response.status,
                    Object.fromEntries(
                        [
                            "content-type",
                            "x-request-id",
                            "x-generation-id",
                            "retry-after",
                        ]
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
            const {
                usage,
                generationId,
                provider: resolvedProvider,
                terminal,
                done,
                invalidFrame,
                cost: reportedCost,
            } = sseFacts(response.ok ? body : "");
            if (reportedCost !== undefined) cost += reportedCost;
            const retryable =
                [408, 429].includes(response.status) || response.status >= 500;
            const retryAfter = response.headers.get("retry-after");
            const delay = retryAfter === null ? 0 : Number(retryAfter);
            const retryAfterAt = Math.max(
                Date.now() + 15000,
                Number.isFinite(delay)
                    ? Date.now() + delay * 1000
                    : Date.parse(retryAfter),
            );
            event({
                event: "response",
                call,
                scenario,
                status: response.status,
                usage,
                cost: reportedCost,
                billing: reportedCost === undefined ? "unknown" : "reported",
                outcome: response.ok
                    ? terminal && done && !invalidFrame
                        ? "response_received"
                        : "stream_incomplete"
                    : "http_refusal",
                generationId,
                provider: resolvedProvider,
                ...(!response.ok
                    ? {
                          retryable,
                          retryAfterAt: Number.isFinite(retryAfterAt)
                              ? retryAfterAt
                              : Date.now() + 15000,
                      }
                    : {}),
                elapsedMs: Date.now() - startedAt,
            });
            responseRecorded = true;
            if (reportedCost !== undefined && reportedCost > reserve) {
                fatal = "Reported charge exceeded its reserved envelope";
                event({ event: "halt", call, reason: fatal });
            }
            if (response.ok && (!(terminal && done) || invalidFrame))
                throw new Error("Incomplete upstream SSE response");
            if (control.injectHttpRefusal && !injected.has(scenario)) {
                injected.add(scenario);
                event({
                    event: "fault_applied",
                    scenario,
                    call,
                    kind: "http_refusal",
                });
                res.writeHead(503, { "content-type": "application/json" });
                res.end(
                    JSON.stringify({
                        error: {
                            message:
                                "Qualification: injected HTTP refusal after retained upstream response",
                        },
                    }),
                );
                return;
            }
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
                    event({ event: "fault_applied", scenario, call });
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
                const partialPath = `${root}/upstream-${call}.sse`;
                const facts = sseFacts(
                    existsSync(partialPath)
                        ? readFileSync(partialPath, "utf8")
                        : "",
                );
                if (!responseRecorded && facts.cost !== undefined)
                    cost += facts.cost;
                if (
                    !responseRecorded &&
                    abort.signal.aborted &&
                    httpStatus >= 200 &&
                    httpStatus < 300 &&
                    facts.terminal &&
                    facts.done &&
                    !facts.invalidFrame
                ) {
                    event({
                        event: "response",
                        call,
                        scenario: control?.scenario,
                        status: httpStatus,
                        usage: facts.usage,
                        cost: facts.cost,
                        generationId: facts.generationId,
                        provider: facts.provider,
                        billing:
                            facts.cost === undefined ? "unknown" : "reported",
                        outcome: "response_received",
                        transport: "closed_after_terminal",
                        elapsedMs: Date.now() - startedAt,
                    });
                } else {
                    event({
                        event: "uncertain",
                        call,
                        scenario: control?.scenario,
                        reason,
                        ...(!responseRecorded
                            ? {
                                  cost: facts.cost,
                                  generationId: facts.generationId,
                                  provider: facts.provider,
                                  billing:
                                      facts.cost === undefined
                                          ? "unknown"
                                          : "reported",
                              }
                            : {}),
                    });
                }
                const reserve = prior.find(
                    (entry) =>
                        entry.event === "dispatch" && entry.call === call,
                )?.reserveUsd;
                if (
                    !responseRecorded &&
                    facts.cost !== undefined &&
                    facts.cost > reserve
                ) {
                    fatal = "Reported charge exceeded its reserved envelope";
                    event({ event: "halt", call, reason: fatal });
                }
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
