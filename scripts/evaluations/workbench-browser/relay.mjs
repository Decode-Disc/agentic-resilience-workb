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
import {
    MODEL_MAX_INPUT_PRICE_PER_MILLION,
    MODEL_MAX_OUTPUT_PRICE_PER_MILLION,
    RESOURCE_POLICY_VERSION,
    resolveGenerationAuthority,
    QUALIFICATION_TOOLING_POLICY as TOOLING_POLICY,
} from "../../../convex/resourcePolicy.ts";

/** One ledger fold at a case boundary; unknown external work never becomes idle by polling. */
export function readRelayContinuation(root) {
    const path = `${root}/ledger.jsonl`;
    if (!existsSync(path)) return { safe: true, reason: null };
    const entries = readFileSync(path, "utf8")
        .split("\n")
        .filter(Boolean)
        .map(JSON.parse);
    const calls = new Map();
    let unsafe = false;
    for (const entry of entries) {
        if (entry.event === "halt" || entry.event === "uncertain")
            unsafe = true;
        if (entry.event !== "dispatch" && entry.event !== "response") continue;
        const call = calls.get(entry.call) ?? {
            dispatched: false,
            responses: 0,
            cost: undefined,
        };
        if (entry.event === "dispatch") call.dispatched = true;
        else {
            call.responses++;
            if (
                entry.outcome !== "response_received" ||
                entry.billing !== "reported" ||
                !Number.isFinite(entry.cost) ||
                entry.cost < 0 ||
                (call.cost !== undefined && call.cost !== entry.cost)
            )
                unsafe = true;
            call.cost ??= entry.cost;
        }
        calls.set(entry.call, call);
    }
    for (const call of calls.values())
        if (call.dispatched && !call.responses) unsafe = true;
    return {
        safe: !unsafe,
        reason: unsafe ? "relay_outcome_unresolved" : null,
    };
}

/** Retains observable provider facts even when the consumer closes after the terminal SSE frame. */
function sseFacts(body) {
    let usage, cost, generationId, provider;
    let terminal = false,
        done = false,
        invalidFrame = false,
        billingConflict = false;
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
        if (Number.isFinite(frame.usage?.cost) && frame.usage.cost >= 0) {
            if (cost !== undefined && cost !== frame.usage.cost)
                billingConflict = true;
            cost ??= frame.usage.cost;
        }
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
        billingConflict,
    };
}

// Retained qualification relay, with its per-lot ledger and explicit fault controls.
export function createQualificationRelay(
    root,
    key,
    providerFetch = globalThis.fetch,
) {
    if (!key) throw new Error("Provider credential unavailable");
    let protocol = null;
    try {
        if (existsSync(`${root}/protocol.json`))
            protocol = JSON.parse(
                readFileSync(`${root}/protocol.json`, "utf8"),
            );
    } catch (error) {
        throw new Error("Invalid retained qualification protocol", {
            cause: error,
        });
    }
    if (protocol?.resourcePolicy !== RESOURCE_POLICY_VERSION)
        throw new Error("resource_policy_unsupported");
    const maximumRequests = protocol.maximumRequests;
    const maximumCostUsd = protocol.maximumCostUsd;
    if (
        !Number.isSafeInteger(maximumRequests) ||
        maximumRequests < 1 ||
        !Number.isFinite(maximumCostUsd) ||
        maximumCostUsd <= 0
    )
        throw new Error("Invalid qualification request allowance");
    let route;
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
        cost = 0,
        fatal;
    const knownFinal =
        (protocol.manifest?.costAccountingPolicy ??
            protocol.costAccountingPolicy) === "known_final_v1";
    let budgetedUsd = 0;
    const inFlightReservations = new Map();
    const reservations = new Map();
    const settledCosts = new Map();
    const observedCosts = new Map();
    const conflictedCalls = new Set();
    const account = (entry) => {
        if (
            (entry.event === "response" || entry.event === "uncertain") &&
            Number.isFinite(entry.cost) &&
            entry.cost >= 0
        ) {
            const previous = observedCosts.get(entry.call);
            if (previous === undefined) {
                observedCosts.set(entry.call, entry.cost);
                cost += entry.cost;
            }
            if (
                (previous !== undefined && previous !== entry.cost) ||
                entry.billing === "conflict"
            ) {
                fatal = "Conflicting provider cost observations";
                if (
                    !conflictedCalls.has(entry.call) &&
                    settledCosts.has(entry.call)
                ) {
                    budgetedUsd +=
                        reservations.get(entry.call) -
                        settledCosts.get(entry.call);
                    inFlightReservations.set(
                        entry.call,
                        reservations.get(entry.call),
                    );
                }
                conflictedCalls.add(entry.call);
            }
        }

        if (entry.event === "dispatch") {
            reservations.set(entry.call, entry.reserveUsd);
            inFlightReservations.set(entry.call, entry.reserveUsd);
            budgetedUsd += entry.reserveUsd;
        } else if (
            knownFinal &&
            !conflictedCalls.has(entry.call) &&
            entry.event === "response" &&
            entry.outcome === "response_received" &&
            entry.billing === "reported" &&
            Number.isFinite(entry.cost) &&
            entry.cost >= 0
        ) {
            const reservation = inFlightReservations.get(entry.call);
            if (reservation === undefined) return;
            settledCosts.set(entry.call, entry.cost);
            inFlightReservations.delete(entry.call);
            budgetedUsd += entry.cost - reservation;
        }
    };
    for (const entry of prior) account(entry);
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
        fatal ??=
            "Prior unresolved dispatch or halt; no restart retry permitted";
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
        account(entry);
    };
    const digest = (v) => createHash("sha256").update(v).digest("hex");
    const pause = (ms) => new Promise((r) => setTimeout(r, ms));
    return http.createServer(async (req, res) => {
        let dispatched = false,
            correlation,
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
                if (inputBytes > TOOLING_POLICY.relayRequestMaxBytes)
                    throw new Error("Input byte bound");
                input.push(part);
            }
            const text = Buffer.concat(input).toString("utf8");
            if (req.headers["x-workbench-relay-dispatch"]) {
                const supplied = JSON.parse(
                    req.headers["x-workbench-relay-dispatch"],
                );
                if (
                    typeof supplied?.invocationId === "string" &&
                    Number.isSafeInteger(supplied.generation) &&
                    supplied.generation >= 0 &&
                    supplied.bodyHash === digest(text)
                )
                    correlation = {
                        invocationId: supplied.invocationId,
                        generation: supplied.generation,
                        bodyHash: supplied.bodyHash,
                    };
                else throw new Error("Invalid relay request correlation");
            }
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
            // The backend mints this grant after the listener supplies its loopback origin.
            if (!route) {
                let prepared;
                try {
                    prepared = JSON.parse(
                        readFileSync(`${root}/relay-route.json`, "utf8"),
                    );
                } catch (error) {
                    throw new Error("Invalid retained relay route", {
                        cause: error,
                    });
                }
                if (prepared?.resourcePolicy !== RESOURCE_POLICY_VERSION)
                    throw new Error("resource_policy_unsupported");
                if (
                    !Number.isSafeInteger(prepared.deadlineAt) ||
                    prepared.deadlineAt < 1
                )
                    throw new Error("execution_deadline");
                const { contextWindow, maxTokens, inputPrice, outputPrice } =
                    prepared.descriptor ?? {};
                if (
                    typeof prepared.model !== "string" ||
                    !prepared.model ||
                    !Number.isSafeInteger(contextWindow) ||
                    contextWindow < 1 ||
                    !Number.isSafeInteger(maxTokens) ||
                    maxTokens < 1 ||
                    !Number.isFinite(inputPrice) ||
                    inputPrice < 0 ||
                    !Number.isFinite(outputPrice) ||
                    outputPrice < 0
                )
                    throw new Error("Invalid prepared relay capabilities");
                route = prepared;
            }
            const policy =
                protocol.manifest?.costAccountingPolicy ??
                protocol.costAccountingPolicy;
            if (
                policy !== "known_final_v1" ||
                route.costAccountingPolicy !== policy ||
                (protocol.costAccountingPolicy !== undefined &&
                    protocol.costAccountingPolicy !== policy)
            )
                throw new Error(
                    "Explicit matching cost accounting policy required",
                );
            const { contextWindow, maxTokens } = route.descriptor;
            const constraints = states[0].constraints;
            if (constraints?.resourcePolicy !== RESOURCE_POLICY_VERSION)
                throw new Error("resource_policy_unsupported");
            const authority = resolveGenerationAuthority(
                {
                    resourcePolicy: protocol.resourcePolicy,
                    deadlineAt: Math.min(
                        route.deadlineAt,
                        constraints.deadlineAt,
                        protocol.manifest?.expiresAt ?? route.deadlineAt,
                    ),
                },
                Date.now(),
            );
            if (authority.kind === "blocked") throw new Error(authority.code);
            if (
                p.model !== route.model ||
                p.temperature !== 0 ||
                !Number.isSafeInteger(
                    p.max_tokens ?? p.max_completion_tokens,
                ) ||
                (p.max_tokens ?? p.max_completion_tokens) < 1 ||
                (p.max_tokens ?? p.max_completion_tokens) >
                    Math.min(maxTokens, contextWindow) ||
                p.reasoning?.effort !== route.reasoningEffort ||
                (route.provider
                    ? JSON.stringify(p.provider?.only) !==
                      JSON.stringify([route.provider])
                    : p.provider?.only !== undefined) ||
                p.provider?.require_parameters !== true
            )
                throw new Error("Route or request contract changed");
            const { prompt: inputPrice, completion: outputPrice } =
                p.provider.max_price ?? {};
            if (
                !Number.isFinite(inputPrice) ||
                inputPrice < 0 ||
                inputPrice > MODEL_MAX_INPUT_PRICE_PER_MILLION ||
                !Number.isFinite(outputPrice) ||
                outputPrice < 0 ||
                outputPrice > MODEL_MAX_OUTPUT_PRICE_PER_MILLION
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
                (contextWindow * inputPrice) / 1e6 +
                ((p.max_tokens ?? p.max_completion_tokens) * outputPrice) / 1e6;
            if (
                calls >= maximumRequests ||
                budgetedUsd + reserve > maximumCostUsd
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
            const dispatchAuthority = resolveGenerationAuthority(
                {
                    resourcePolicy: protocol.resourcePolicy,
                    deadlineAt: authority.deadlineAt,
                },
                Date.now(),
            );
            if (dispatchAuthority.kind === "blocked")
                throw new Error(dispatchAuthority.code);
            abort.signal.throwIfAborted();
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
                        AbortSignal.timeout(dispatchAuthority.timeoutMs),
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
                if (bytes > TOOLING_POLICY.relayResponseMaxBytes)
                    throw new Error("Response byte bound");
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
                billingConflict,
            } = sseFacts(response.ok ? body : "");
            if (billingConflict) {
                fatal = "Conflicting provider cost observations";
                event({ event: "halt", call, reason: fatal });
            }

            const retryable =
                [408, 429].includes(response.status) || response.status >= 500;
            const retryAfter = response.headers.get("retry-after");
            const delay = retryAfter === null ? 0 : Number(retryAfter);
            const retryAfterAt = Math.max(
                Date.now() + TOOLING_POLICY.relayRefusalCooldownMs,
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
                billing: billingConflict
                    ? "conflict"
                    : reportedCost === undefined
                      ? "unknown"
                      : "reported",
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
                              : Date.now() +
                                TOOLING_POLICY.relayRefusalCooldownMs,
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
                const until = Date.now() + TOOLING_POLICY.relayGateTimeoutMs;
                while (
                    !existsSync(`${root}/release-${scenario}`) &&
                    Date.now() < until
                )
                    await pause(TOOLING_POLICY.relayGatePollMs);
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
                budgetedUsd,
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
                        billing: facts.billingConflict
                            ? "conflict"
                            : facts.cost === undefined
                              ? "unknown"
                              : "reported",
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
                                  billing: facts.billingConflict
                                      ? "conflict"
                                      : facts.cost === undefined
                                        ? "unknown"
                                        : "reported",
                              }
                            : {}),
                    });
                }
                if (facts.billingConflict) {
                    fatal = "Conflicting reported charges for one dispatch";
                    event({ event: "halt", call, reason: fatal });
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
                    ...(correlation ? { correlation } : {}),
                    reason,
                    scenario: control?.scenario,
                });
            json("relay-summary.json", {
                calls,
                reservedUsd: reserved,
                budgetedUsd,
                reportedCostUsd: cost,
                fatal,
            });
            if (res.headersSent) {
                res.destroy();
            } else if (!res.destroyed) {
                res.writeHead(400, {
                    "content-type": "application/json",
                    ...(!dispatched && correlation
                        ? {
                              "x-workbench-relay-not-dispatched":
                                  JSON.stringify(correlation),
                          }
                        : {}),
                });
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
