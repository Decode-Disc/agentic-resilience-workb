import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseEnv } from "node:util";
import {
    createAgentSession,
    createExtensionRuntime,
    createGrepToolDefinition,
    createLsToolDefinition,
    createReadToolDefinition,
    defineTool,
    ModelRuntime,
    type ResourceLoader,
    SessionManager,
    SettingsManager,
} from "@earendil-works/pi-coding-agent";
import type { ConvexHttpClient } from "convex/browser";
import {
    type FunctionArgs,
    getFunctionName,
    makeFunctionReference,
} from "convex/server";
import { z } from "zod";
import { internal } from "../../../convex/_generated/api.js";
import type { Id } from "../../../convex/_generated/dataModel";
import {
    analysisReceiptSchema,
    type CampaignManifest,
    campaignManifestSchema,
} from "../../../convex/qualificationCampaignPolicy.ts";
import {
    CampaignReviewFormatError,
    type campaignReviewTemplate,
    campaignReviewVerdicts,
    listCampaignReviewEvidence,
    readCampaignReviewEvidence,
    readCampaignReviewEvidenceWindow,
    retainCampaignReviewReport,
    searchCampaignReviewEvidence,
    validateCampaignReview,
} from "./campaign.ts";
import { openQualificationJournal } from "./journal.ts";
import { sha256 } from "./protocol.ts";

type Template = ReturnType<typeof campaignReviewTemplate>;
type Model = NonNullable<ReturnType<ModelRuntime["getModel"]>>;
export type CampaignReviewTransport = {
    kind: "mock-openai";
    fetch: typeof globalThis.fetch;
};

function readReviewJson<S extends z.ZodType>(
    path: string,
    schema: S,
): z.output<S> {
    try {
        return schema.parse(JSON.parse(readFileSync(path, "utf8")));
    } catch (error) {
        throw new Error("Retained analysis data is invalid", { cause: error });
    }
}

function configuredReviewerReasoning(): string {
    if (process.env.WORKBENCH_REVIEW_REASONING !== undefined)
        return process.env.WORKBENCH_REVIEW_REASONING;
    const git = spawnSync("git", ["worktree", "list", "--porcelain", "-z"], {
        encoding: "utf8",
        timeout: 5000,
        maxBuffer: 256 * 1024,
        stdio: ["ignore", "pipe", "pipe"],
    });
    if (git.error || git.status !== 0)
        throw new Error(
            "Cannot locate the main worktree for reviewer configuration",
        );
    const main = git.stdout.split("\0\0", 1)[0]?.split("\0") ?? [];
    const directory = main[0]?.startsWith("worktree ")
        ? main[0].slice(9)
        : undefined;
    if (!directory || main.includes("bare"))
        throw new Error(
            "Reviewer configuration requires a main working checkout or explicit environment setting",
        );
    let content: string;
    try {
        content = readFileSync(join(directory, ".env.local"), "utf8");
    } catch (error) {
        if (
            error &&
            typeof error === "object" &&
            "code" in error &&
            error.code === "ENOENT"
        )
            return "high";
        throw new Error("Cannot read shared reviewer reasoning configuration", {
            cause: error,
        });
    }
    return parseEnv(content).WORKBENCH_REVIEW_REASONING ?? "high";
}

const responseRecord = z
    .object({
        requestHash: z.string().regex(/^[a-f0-9]{64}$/),
        status: z.number().int().min(200).max(599),
        contentType: z.string().max(200),
        body: z.string().max(1024 * 1024),
    })
    .strict();

/** Connects Pi review to campaign authority and durable per-request accounting. API-paid transport remains gated. */
export async function runAccountableCampaignReview(options: {
    root: string;
    evidenceRoot: string;
    template: Template;
    manifest: CampaignManifest;
    campaignId: Id<"qualificationCampaigns">;
    lotId: Id<"qualificationLots">;
    client: Pick<ConvexHttpClient, "mutation">;
    modelRuntime?: ModelRuntime;
    transport?: CampaignReviewTransport;
}) {
    const { root, manifest, template, client } = options;
    if (manifest.version !== 3)
        return {
            status: "pending" as const,
            reason: "analysis_not_authorized",
        };
    const route = manifest.analysis.routes[0];
    if (!route || route.provider === "opencode-go")
        return {
            status: "pending" as const,
            reason: "subscription_guarantee_unverified",
        };
    const runtime =
        options.modelRuntime ??
        (await ModelRuntime.create({
            allowModelNetwork: false,
            refreshOnCreate: false,
        }));
    const authentication = await runtime.checkAuth(route.provider);
    if (!authentication)
        return {
            status: "pending" as const,
            reason: "provider_login_required",
            message: `Sign in through Pi with /login ${route.provider} before running this review.`,
        };
    const subscription = manifest.analysis.accounting === "native_subscription";
    if (subscription && authentication.type !== "oauth")
        return {
            status: "pending" as const,
            reason: "provider_subscription_login_required",
        };
    if (!options.transport && !subscription)
        return {
            status: "pending" as const,
            reason: "live_transport_unqualified",
            authentication: authentication.type,
        };
    const transport = options.transport ?? { fetch: globalThis.fetch };
    const mandateHash = sha256(JSON.stringify(manifest));
    const protocolPath = join(root, "protocol.json");
    const protocol = existsSync(protocolPath)
        ? readReviewJson(protocolPath, z.record(z.string(), z.unknown()))
        : { kind: "automated_campaign_review", mandateHash };
    const journal = openQualificationJournal(root, protocol);
    if (
        journal.analysisAttempts().length > 0 &&
        !existsSync(join(root, "automated-review-mission.json"))
    )
        return {
            status: "pending" as const,
            reason: "legacy_review_protocol_unavailable",
        };
    const identity = (attempt: number) => ({
        campaignId: options.campaignId,
        lotId: options.lotId,
        mandateHash,
        candidateHash: template.candidateHash,
        evidenceHash: template.evidenceHash,
        provider: route.provider,
        model: route.model,
        attemptKey: `analysis-${template.evidenceHash.slice(0, 16)}-${attempt}`,
    });
    const reservationMicros =
        manifest.analysis.maxRequestCostMicros ??
        manifest.analysis.perLot.costMicros;
    const responsePath = (attempt: number) =>
        join(
            root,
            `automated-review-response-${identity(attempt).attemptKey}.json`,
        );
    const model = runtime.getModel(route.provider, route.model);
    if (
        (model?.api !== "openai-responses" &&
            model?.api !== "openai-codex-responses") ||
        (subscription &&
            (route.provider !== "openai-codex" ||
                model.api !== "openai-codex-responses")) ||
        (manifest.analysis.maxOutputTokens ?? model.maxTokens) >
            model.maxTokens ||
        manifest.analysis.maxInputTokens +
            (manifest.analysis.maxOutputTokens ?? model.maxTokens) >
            model.contextWindow
    )
        return {
            status: "pending" as const,
            reason: "model_bounds_unqualified",
        };
    const reserveRef = makeFunctionReference<
        "mutation",
        FunctionArgs<typeof internal.qualificationCampaigns.reserveAnalysis>,
        null
    >(getFunctionName(internal.qualificationCampaigns.reserveAnalysis));
    const settleRef = makeFunctionReference<
        "mutation",
        FunctionArgs<typeof internal.qualificationCampaigns.settleAnalysis>,
        null
    >(getFunctionName(internal.qualificationCampaigns.settleAnalysis));
    return runPiCampaignReview({
        root: options.evidenceRoot,
        reportRoot: root,
        template,
        runtime,
        model,
        limits: manifest.analysis,
        transport: {
            kind: "metered-openai",
            fetch: (attempt) => async (input, init) => {
                const request = new Request(input, init);
                const body = new Uint8Array(await request.arrayBuffer());
                const requestHash = sha256(body);
                const path = responsePath(attempt);
                if (existsSync(path)) {
                    const record = readReviewJson(path, responseRecord);
                    assert.equal(
                        record.requestHash,
                        requestHash,
                        "Retained analysis request changed",
                    );
                    return new Response(record.body, {
                        status: record.status,
                        headers: { "content-type": record.contentType },
                    });
                }
                const response = await transport.fetch(request.url, {
                    method: request.method,
                    headers: request.headers,
                    body,
                    signal: request.signal,
                });
                const chunks: Uint8Array[] = [];
                let bytes = 0;
                if (response.body) {
                    const reader = response.body.getReader();
                    try {
                        for (;;) {
                            const next = await reader.read();
                            if (next.done) break;
                            bytes += next.value.byteLength;
                            if (bytes > 1024 * 1024)
                                throw new Error(
                                    "Analysis response limit exceeded",
                                );
                            chunks.push(next.value);
                        }
                    } finally {
                        await reader.cancel();
                    }
                }
                const record = responseRecord.parse({
                    requestHash,
                    status: response.status,
                    contentType: response.headers.get("content-type") ?? "",
                    body: new TextDecoder("utf-8", { fatal: true }).decode(
                        Buffer.concat(chunks),
                    ),
                });
                writeFileSync(path, `${JSON.stringify(record)}\n`, {
                    flag: "wx",
                    mode: 0o600,
                    flush: true,
                });
                return new Response(record.body, {
                    status: record.status,
                    headers: { "content-type": record.contentType },
                });
            },
        },
        reserve: async (attempt) => {
            const bound = identity(attempt);
            const previous = journal
                .analysisAttempts()
                .find(
                    (entry) => entry.identity.attemptKey === bound.attemptKey,
                );
            if (previous) {
                assert.deepEqual(
                    previous.identity,
                    bound,
                    "Analysis attempt identity changed",
                );
                assert(
                    existsSync(responsePath(attempt)),
                    "Analysis outcome unknown; redispatch blocked",
                );
                if (previous.status === "completed")
                    assert.equal(
                        sha256(readFileSync(responsePath(attempt))),
                        previous.receipt?.observationHash,
                        "Retained analysis observation changed",
                    );
                return;
            }
            assert(
                attempt <= manifest.analysis.perLot.requests,
                "Analysis allowance exhausted",
            );
            journal.beginAnalysis(bound);
            await client.mutation(reserveRef, {
                lotId: options.lotId,
                attemptKey: bound.attemptKey,
                evidenceHash: template.evidenceHash,
                provider: route.provider,
                model: route.model,
                reservationMicros,
            });
        },
        settle: async (attempt, usage) => {
            assert(
                Number.isSafeInteger(usage.input) &&
                    usage.input >= 0 &&
                    Number.isSafeInteger(usage.output) &&
                    usage.output >= 0,
                "Invalid analysis usage",
            );
            const bound = identity(attempt);
            // Only the injected mock has a known zero charge; native subscriptions retain usage without dollar settlement.
            const receipt = analysisReceiptSchema.parse({
                input: usage.input,
                output: usage.output,
                ...(subscription
                    ? { accounting: "native_subscription" }
                    : { costMicros: 0 }),
                observationHash: sha256(readFileSync(responsePath(attempt))),
            });
            journal.finishAnalysis(bound, receipt);
            await client.mutation(settleRef, {
                lotId: options.lotId,
                attemptKey: bound.attemptKey,
                ...(subscription
                    ? { receipt }
                    : { costMicros: receipt.costMicros }),
            });
        },
    });
}

/** Runs Pi with only frozen evidence and a metered model stream. */
export async function runPiCampaignReview(options: {
    root: string;
    reportRoot?: string;
    template: Template;
    runtime: ModelRuntime;
    model: Model;
    transport:
        | "mock"
        | {
              kind: "mock-openai" | "metered-openai";
              fetch: (attempt: number) => typeof globalThis.fetch;
          };
    limits: {
        maxInputTokens: number;
        maxOutputTokens?: number;
        timeoutMs: number;
    };
    reserve: (attempt: number) => Promise<unknown>;
    settle: (
        attempt: number,
        usage: {
            input: number;
            output: number;
            cacheRead: number;
            cacheWrite: number;
            cost: { total: number; totalFromProvider?: boolean };
        },
    ) => Promise<unknown>;
}) {
    const { root, template, runtime, model, limits } = options;
    if (
        options.transport === "mock"
            ? model.provider !== "faux"
            : !["openai", "openai-codex"].includes(model.provider) ||
              !["openai-responses", "openai-codex-responses"].includes(
                  model.api,
              )
    )
        throw new Error("Unqualified reviewer transport is blocked");
    let mission = readFileSync(
        join(
            process.cwd(),
            ".agents/skills/workbench-evaluation/references/reviewer-mission.md",
        ),
        "utf8",
    );
    const contextFile = (path: string) => {
        if (!existsSync(join(root, path))) return null;
        const text = readCampaignReviewEvidence(
            root,
            template.evidenceHash,
            path,
            64 * 1024 * 1024,
        );
        try {
            return z.record(z.string(), z.unknown()).parse(JSON.parse(text));
        } catch (error) {
            throw new Error("Captured evaluation context is invalid", {
                cause: error,
            });
        }
    };
    const captured = z
        .object({ manifest: campaignManifestSchema })
        .parse(contextFile("campaign-lot.json"));
    const context = {
        objective: captured.manifest.objective,
        capability: captured.manifest.capability,
        mode: captured.manifest.mode,
        executionSurface:
            captured.manifest.version === 1
                ? "browser"
                : (captured.manifest.executionSurface ?? "browser"),
        scenarios:
            captured.manifest.version === 1
                ? captured.manifest.expectations
                : captured.manifest.scenarios.map(
                      ({ id, company, framing }) => ({ id, company, framing }),
                  ),
        mechanical: contextFile("campaign-result.json"),
        reconciliation: contextFile("reconciliation.json"),
        archivedSourcePrefix: "code/",
    };
    const missionSchema = z
        .object({
            protocol: z.literal("investigator_v1"),
            mission: z.string(),
            missionHash: z.string().regex(/^[a-f0-9]{64}$/),
            context: z.record(z.string(), z.unknown()),
            candidateHash: z.string(),
            batteryHash: z.string(),
            evidenceHash: z.string(),
            reasoning: z
                .object({
                    requested: z.string().min(1),
                    effective: z.string().min(1),
                })
                .strict()
                .optional(),
        })
        .strict();
    const pinPath = options.reportRoot
        ? join(options.reportRoot, "automated-review-mission.json")
        : undefined;
    const retained =
        pinPath && existsSync(pinPath)
            ? readReviewJson(pinPath, missionSchema)
            : undefined;
    if (retained) {
        assert.equal(
            sha256(retained.mission),
            retained.missionHash,
            "Retained reviewer mission changed",
        );
        for (const key of [
            "candidateHash",
            "batteryHash",
            "evidenceHash",
        ] as const)
            assert.equal(
                retained[key],
                template[key],
                "Retained reviewer mission identity changed",
            );
        assert.deepEqual(
            retained.context,
            context,
            "Retained reviewer context changed",
        );
        mission = retained.mission;
    }
    const requestedReasoning = retained
        ? (retained.reasoning?.requested ?? "off")
        : configuredReviewerReasoning();
    const legacyReasoning =
        retained !== undefined && retained.reasoning === undefined;
    const loader: ResourceLoader = {
        getExtensions: () => ({
            extensions: [],
            errors: [],
            runtime: createExtensionRuntime(),
        }),
        getSkills: () => ({ skills: [], diagnostics: [] }),
        getPrompts: () => ({ prompts: [], diagnostics: [] }),
        getThemes: () => ({ themes: [], diagnostics: [] }),
        getAgentsFiles: () => ({ agentsFiles: [] }),
        getSystemPrompt: () =>
            `${mission}\nAllowed assessment verdicts: ${campaignReviewVerdicts.join(", ")}.`,
        getSystemPromptSource: () => undefined,
        getAppendSystemPrompt: () => [],
        getAppendSystemPromptSources: () => [],
        extendResources: () => {},
        reload: async () => {},
    };
    const readDefinition = createReadToolDefinition(root);
    const read = defineTool({
        ...readDefinition,
        parameters: {
            ...readDefinition.parameters,
            properties: {
                path: {
                    ...readDefinition.parameters.properties.path,
                    description:
                        "Canonical relative path from the frozen inventory",
                },
                offset: {
                    ...readDefinition.parameters.properties.offset,
                    description: "1-based UTF-8 byte position, default 1",
                },
                limit: {
                    ...readDefinition.parameters.properties.limit,
                    description:
                        "Maximum bytes to return, from 4 to 51200, default 8192",
                },
            },
        },
        description:
            "Read untrusted indexed evidence. offset is a 1-based byte position; limit is a byte count up to 51200. Continue at nextOffset + 1.",
        async execute(_id, { path, offset, limit }) {
            const window = readCampaignReviewEvidenceWindow(
                root,
                template.evidenceHash,
                path,
                (offset ?? 1) - 1,
                limit ?? 8192,
            );
            return {
                content: [{ type: "text", text: JSON.stringify(window) }],
                details: undefined,
            };
        },
    });
    const listDefinition = createLsToolDefinition(root);
    const list = defineTool({
        ...listDefinition,
        parameters: {
            ...listDefinition.parameters,
            properties: {
                path: {
                    ...listDefinition.parameters.properties.path,
                    description:
                        "Decimal inventory cursor from nextCursor, default 0",
                },
                limit: {
                    ...listDefinition.parameters.properties.limit,
                    description:
                        "Maximum indexed paths, from 1 to 100, default 50",
                },
            },
        },
        description:
            "List indexed evidence paths. Set path to the nextCursor from the preceding page; limit is at most 100.",
        async execute(_id, { path, limit }) {
            if (path !== undefined && !/^(0|[1-9][0-9]*)$/.test(path))
                throw new Error("Invalid evidence inventory cursor");
            const page = listCampaignReviewEvidence(
                root,
                template.evidenceHash,
                path === undefined ? 0 : Number(path),
                limit,
            );
            return {
                content: [{ type: "text", text: JSON.stringify(page) }],
                details: undefined,
            };
        },
    });
    const grepDefinition = createGrepToolDefinition(root);
    const grep = defineTool({
        ...grepDefinition,
        description:
            "Search literal text in hash-verified indexed evidence and archived source. No regex or glob expansion. Results include read-ready byte offsets; continue with nextCursor until null before claiming absence.",
        parameters: {
            ...grepDefinition.parameters,
            additionalProperties: false,
            properties: {
                pattern: {
                    ...grepDefinition.parameters.properties.pattern,
                    description: "Nonempty literal text to find",
                },
                path: {
                    ...grepDefinition.parameters.properties.path,
                    description:
                        "Canonical indexed relative file or directory prefix",
                },
                ignoreCase: grepDefinition.parameters.properties.ignoreCase,
                literal: {
                    ...grepDefinition.parameters.properties.literal,
                    description:
                        "Must be true or omitted; regex is unavailable",
                },
                limit: {
                    ...grepDefinition.parameters.properties.limit,
                    description:
                        "Maximum matches, 1 to 100; each page scans at most 100 files",
                },
                cursor: {
                    type: "string",
                    description:
                        "Opaque nextCursor from the preceding result for this same query",
                },
            },
        },
        async execute(
            _id,
            { pattern, path, ignoreCase, literal, limit, cursor },
            signal,
        ) {
            assert(
                literal !== false,
                "Only literal evidence search is supported",
            );
            const page = searchCampaignReviewEvidence(
                root,
                template.evidenceHash,
                {
                    pattern,
                    path,
                    ignoreCase,
                    limit,
                    cursor: z.string().optional().parse(cursor),
                    signal,
                },
            );
            return {
                content: [{ type: "text", text: JSON.stringify(page) }],
                details: undefined,
            };
        },
    });
    const { session } = await createAgentSession({
        cwd: root,
        modelRuntime: runtime,
        model,
        thinkingLevel: legacyReasoning ? "off" : "high",
        tools: ["read", "ls", "grep"],
        customTools: [read, list, grep],
        resourceLoader: loader,
        sessionManager: SessionManager.inMemory(root),
        settingsManager: SettingsManager.inMemory({
            compaction: { enabled: false },
            retry: { enabled: false, provider: { maxRetries: 0 } },
            cacheWarming: "off",
        }),
    });
    try {
        if (!legacyReasoning) {
            const thinkingLevel = session
                .getAvailableThinkingLevels()
                .find((level) => level === requestedReasoning);
            if (thinkingLevel === undefined) {
                session.dispose();
                return {
                    status: "pending" as const,
                    reason: "reviewer_reasoning_unavailable",
                };
            }
            session.setThinkingLevel(thinkingLevel);
        }
        if (
            retained?.reasoning &&
            retained.reasoning.effective !== session.thinkingLevel
        ) {
            session.dispose();
            return {
                status: "pending" as const,
                reason: "reviewer_reasoning_changed",
            };
        }
        if (pinPath && !retained)
            writeFileSync(
                pinPath,
                `${JSON.stringify({ protocol: "investigator_v1", mission, missionHash: sha256(mission), context, candidateHash: template.candidateHash, batteryHash: template.batteryHash, evidenceHash: template.evidenceHash, reasoning: { requested: requestedReasoning, effective: session.thinkingLevel } }, null, 2)}\n`,
                { flag: "wx", mode: 0o600, flush: true },
            );
        await session.bindExtensions({});
    } catch (error) {
        session.dispose();
        throw error;
    }
    let calls = 0;
    let failure: string | undefined;
    let settled = false;
    let reportError: Error | undefined;
    const original = session.agent.streamFunction;
    session.agent.streamFunction = async (selected, context, streamOptions) => {
        const bytes = Buffer.byteLength(JSON.stringify(context));
        if (bytes > limits.maxInputTokens) {
            failure = "analysis_input_bound_exceeded";
            throw new Error("Analysis input exceeds conservative bound");
        }
        const attempt = ++calls;
        try {
            await options.reserve(attempt);
        } catch (error) {
            failure = "analysis_reservation_unavailable";
            throw error;
        }
        const response = await original(selected, context, {
            ...streamOptions,
            maxTokens: limits.maxOutputTokens,
            maxRetries: 0,
            timeoutMs: limits.timeoutMs,
            ...(options.transport === "mock"
                ? {}
                : {
                      fetch: options.transport.fetch(attempt),
                      cacheRetention: "none",
                      transport: "sse",
                      ...(model.api === "openai-responses"
                          ? {
                                onPayload: (payload: unknown) => ({
                                    ...z
                                        .record(z.string(), z.unknown())
                                        .parse(payload),
                                    max_output_tokens: limits.maxOutputTokens,
                                }),
                            }
                          : {}),
                  }),
        });
        const iterator = response[Symbol.asyncIterator].bind(response);
        response[Symbol.asyncIterator] = async function* () {
            for await (const event of { [Symbol.asyncIterator]: iterator }) {
                if (event.type === "done" || event.type === "error") {
                    const message = await response.result();
                    if (
                        message.stopReason === "error" ||
                        message.stopReason === "aborted"
                    ) {
                        failure = "unknown_dispatch_outcome";
                    } else {
                        try {
                            if (
                                (message.stopReason === "stop" ||
                                    message.stopReason === "length") &&
                                options.reportRoot
                            ) {
                                const text = message.content
                                    .filter((part) => part.type === "text")
                                    .map((part) => part.text)
                                    .join("");
                                if (
                                    text &&
                                    Buffer.byteLength(text) <= 256 * 1024
                                )
                                    retainCampaignReviewReport(
                                        options.reportRoot,
                                        template,
                                        text,
                                        attempt,
                                        {
                                            complete:
                                                message.stopReason === "stop",
                                        },
                                    );
                            }
                        } catch (error) {
                            reportError =
                                error instanceof Error
                                    ? error
                                    : new Error(
                                          "Diagnostic report persistence failed",
                                          { cause: error },
                                      );
                        }
                        await options.settle(attempt, message.usage);
                    }
                }
                yield event;
            }
        };
        return response;
    };
    session.subscribe((event) => {
        if (event.type === "agent_settled") settled = !event.aborted;
    });
    const timeout = setTimeout(() => {
        failure = "timeout";
        void session.abort();
    }, limits.timeoutMs);
    let prompt = `Investigate this captured evaluation. Context: ${JSON.stringify(context)}\nAssessment template: ${JSON.stringify(template)}`;
    let invalid = false;
    try {
        for (;;) {
            await session.prompt(prompt);
            if (reportError) throw reportError;
            const final = session.messages.at(-1);
            if (
                !settled ||
                failure ||
                final?.role !== "assistant" ||
                final.stopReason !== "stop"
            )
                return {
                    status: "pending" as const,
                    reason:
                        failure ??
                        (invalid ? "invalid_review" : "review_unavailable"),
                };
            const text = session.getLastAssistantText();
            if (!text || Buffer.byteLength(text) > 256 * 1024)
                return { status: "pending" as const, reason: "invalid_review" };
            try {
                const marker = "\n## Assessment";
                const found = text.lastIndexOf(marker);
                const heading =
                    found >= 0
                        ? found + 1
                        : text.startsWith("## Assessment")
                          ? 0
                          : -1;
                if (heading <= 0 || !text.slice(0, heading).trim())
                    throw new CampaignReviewFormatError(
                        "A Markdown developer handoff followed by ## Assessment and its fenced JSON appendix is required",
                    );
                let input: unknown;
                try {
                    const appendix = text
                        .slice(heading + "## Assessment".length)
                        .trim();
                    const opening = appendix.indexOf("\n");
                    const closing = appendix.lastIndexOf("\n```");
                    if (
                        opening < 0 ||
                        appendix.slice(0, opening).trim() !== "```json" ||
                        closing <= opening ||
                        appendix.slice(closing + 4).trim()
                    )
                        throw new Error("Assessment appendix required");
                    input = JSON.parse(appendix.slice(opening + 1, closing));
                } catch {
                    throw new CampaignReviewFormatError(
                        "Invalid assessment JSON; put one JSON object in a final fenced json block under ## Assessment",
                    );
                }
                const review = validateCampaignReview(root, input, {
                    reviewer: "automated",
                });
                return { status: "completed" as const, review };
            } catch (error) {
                if (!(error instanceof CampaignReviewFormatError)) throw error;
                invalid = true;
                prompt = `Assessment not accepted: ${error.message}. Keep the useful diagnostic report and its evidence. Return the report followed by ## Assessment and a fenced json block matching the original template. Allowed verdicts: ${campaignReviewVerdicts.join(", ")}. Do not change identities or repeat workflow effects.`;
            }
        }
    } finally {
        clearTimeout(timeout);
        session.dispose();
    }
}
