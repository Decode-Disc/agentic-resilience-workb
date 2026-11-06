import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { ConvexHttpClient } from "convex/browser";
import {
    type FunctionArgs,
    type FunctionReference,
    type FunctionReturnType,
    getFunctionName,
    makeFunctionReference,
} from "convex/server";
import { z } from "zod";
import { internal } from "../../../convex/_generated/api.js";
import type { Id } from "../../../convex/_generated/dataModel";
import { resolveLocalRuntime } from "../../local-runtime.ts";
import { openQualificationJournal } from "./journal.ts";
import {
    candidateHash,
    preserveQualificationCandidate,
    sha256,
    sourcesBatterySchema,
    verifyQualificationCandidate,
} from "./protocol.ts";

const casesPath = "scripts/evaluations/workbench-browser/sources-cases.json";
const defaultCases = sourcesBatterySchema.parse(
    JSON.parse(readFileSync(casesPath, "utf8")),
);
const save = (root: string, name: string, value: unknown) =>
    writeFileSync(
        join(root, `${name}.json`),
        `${JSON.stringify(value, null, 2)}\n`,
        { mode: 0o600 },
    );
function ref<R extends FunctionReference<"query" | "mutation", "internal">>(
    value: R,
) {
    return makeFunctionReference<
        R["_type"],
        FunctionArgs<R>,
        FunctionReturnType<R>
    >(getFunctionName(value));
}
function command(args: string[]) {
    const r = spawnSync(
        process.execPath,
        ["node_modules/convex/bin/main.js", ...args, "--deployment", "local"],
        { encoding: "utf8", timeout: 30000 },
    );
    assert(
        r.status === 0,
        "Local qualification command failed; diagnostic output withheld",
    );
    return r.stdout.trim();
}

/** Extends the existing qualification journal and fixture owners; research starts only through the admitted browser. */
export async function sourcesQualificationPhase(
    phase: string,
    output: string,
    options?: {
        battery?: typeof defaultCases;
        lotId?: Id<"qualificationLots">;
    },
) {
    const cases =
        options?.battery ??
        (phase !== "prepare"
            ? sourcesBatterySchema.parse(
                  JSON.parse(
                      readFileSync(
                          join(resolve(output), "protocol.json"),
                          "utf8",
                      ),
                  ).battery,
              )
            : defaultCases);
    assert(
        ["prepare", "inspect", "close"].includes(phase),
        "Unknown Sources qualification phase",
    );
    const root = resolve(output);
    assert(
        relative(process.cwd(), root).startsWith(".."),
        "Evidence must be outside the checkout",
    );
    const runtime = await resolveLocalRuntime(process.cwd(), {
        requiredOrigins: ["convex", "web"],
    });
    const client = new ConvexHttpClient(runtime.origins.convex, {
        logger: false,
    });
    const config = JSON.parse(
        readFileSync(".convex/local/default/config.json", "utf8"),
    );
    (
        client as ConvexHttpClient & { setAdminAuth(key: string): void }
    ).setAdminAuth(config.adminKey);
    if (phase === "prepare") {
        assert(
            !existsSync(join(root, "protocol.json")),
            "A prepared or interrupted Sources lot cannot be renewed",
        );
        mkdirSync(root, { recursive: true, mode: 0o700 });
        const protocol = {
            version: 1,
            boundary:
                cases.mode === "deterministic"
                    ? "protected_local_browser_simulated_providers"
                    : "protected_local_browser_real_providers",
            battery: cases,
            batteryHash: sha256(JSON.stringify(cases)),
            contextKey: `sources-${randomUUID()}`,
            approval:
                "Explicit user approval is required before running prepare; this file does not grant it.",
        };
        const journal = openQualificationJournal(root, protocol);
        journal.begin("qualification");
        const fingerprints = preserveQualificationCandidate(root);
        verifyQualificationCandidate(root, fingerprints);
        const publication = await client.query(
            ref(internal.execution.piControl.publicationStatus),
        );
        assert(
            !publication.held && !publication.hasActiveWorkers,
            "Quiet, released local execution required",
        );
        const initialEnv = new Map(
            command(["env", "list"])
                .split("\n")
                .map((line) => {
                    const at = line.indexOf("=");
                    return [line.slice(0, at), line.slice(at + 1)] as const;
                }),
        );
        assert(
            initialEnv.get("SOURCES_MISSION_ENABLED") !== "true",
            "Sources must remain globally disabled",
        );
        const flags = ["E2E_FIXTURES_ENABLED", "WORKBENCH_AGENT_ENABLED"].map(
            (name) => ({ name, previous: initialEnv.get(name) ?? null }),
        );
        save(root, "temporary-flags", flags);
        try {
            for (const flag of flags)
                if (flag.previous !== "true")
                    command(["env", "set", flag.name, "true"]);
            const contextId = await client.mutation(
                ref(internal.runWorkspace.openBrowserTestContext),
                {
                    slotKey: "analyst-4",
                    contextKey: protocol.contextKey,
                    durationMs: 40 * 60000,
                },
            );
            if (options?.lotId)
                await client.mutation(
                    ref(internal.qualificationCampaigns.bind),
                    { lotId: options.lotId, contextId },
                );
            const prepared = [];
            for (const item of cases.cases) {
                const fixtureKey = `${protocol.contextKey}-${item.id}`;
                const result = await client.mutation(
                    ref(internal.e2eFixtures.seedSourceReviewScenario),
                    {
                        slotKey: "analyst-4",
                        fixtureKey,
                        emptyDocumentaryMaterial: true,
                        recordedScenario: {
                            companyName: item.companyName,
                            companyCik: item.companyCik,
                            ticker: item.ticker,
                            websiteUrl: item.websiteUrl,
                            researchAngle: item.scope,
                            sources: [],
                        },
                    },
                );
                prepared.push({ id: item.id, runId: result.runId, fixtureKey });
            }
            save(root, "prepared", {
                cases: prepared,
                candidateHash: candidateHash(fingerprints),
            });
            const first = prepared[0];
            assert(first);
            if (cases.mode === "deterministic")
                assert(
                    options?.lotId,
                    "Deterministic Sources requires a bound campaign",
                );
            else
                await client.mutation(
                    ref(
                        internal.execution.fixtures
                            .authorizeWorkbenchQualification,
                    ),
                    {
                        runId: first.runId,
                        fixtureKey: first.fixtureKey,
                        maximumRequests: cases.maximumModelAttempts,
                        maximumCostUsd: cases.maximumCostUsd,
                        responseControllerModel: cases.responseControllerModel,
                        ...(cases.version === 3
                            ? {
                                  reasoningSelection: cases.reasoningByRole,
                                  expectedModels: {
                                      workbench:
                                          cases.workbenchModel ?? cases.model,
                                      sources: cases.model,
                                  },
                              }
                            : {}),
                        sourcesLot: prepared.map(({ runId, fixtureKey }) => ({
                            runId,
                            fixtureKey,
                        })),
                    },
                );
            console.log(
                JSON.stringify({
                    root,
                    cases: prepared,
                    status: "authorized_not_started",
                    next: "Use activate and the admitted browser; inspect preserves exact evidence. No automatic second lot.",
                }),
            );
        } catch (error) {
            await sourcesQualificationPhase("close", root);
            throw error;
        }
        return;
    }
    const protocol = JSON.parse(
        readFileSync(join(root, "protocol.json"), "utf8"),
    );
    const preparedPath = join(root, "prepared.json");
    const prepared = z
        .object({
            cases: z.array(
                z.object({
                    id: z.string(),
                    runId: z
                        .string()
                        .transform((value) => value as Id<"researchRuns">),
                    fixtureKey: z.string(),
                }),
            ),
        })
        .parse(
            existsSync(preparedPath)
                ? JSON.parse(readFileSync(preparedPath, "utf8"))
                : { cases: [] },
        );
    if (phase === "inspect") {
        const stamp = new Date().toISOString().replaceAll(":", "-");
        for (const item of prepared.cases) {
            const args = { runId: item.runId, fixtureKey: item.fixtureKey };
            const execution = await client.query(
                ref(internal.execution.fixtures.inspectWorkbench),
                args,
            );
            const documentary = await client.query(
                ref(internal.execution.fixtures.inspectSourcesQualification),
                args,
            );
            const { invocations, payloads } = await collectSourcesTranscripts(
                (paginationOpts) =>
                    client.query(
                        ref(
                            internal.execution.fixtures
                                .inspectSourcesInvocations,
                        ),
                        { ...args, paginationOpts },
                    ),
                cases.maximumModelAttempts,
                cases.mode,
            );
            mkdirSync(join(root, "captures"), { recursive: true, mode: 0o700 });
            for (const download of documentary.captureDownloads) {
                const capture = documentary.captures.find(
                    (c) => c._id === download.captureId,
                );
                assert(capture);
                const target = join(root, "captures", `${capture._id}.txt`);
                if (!existsSync(target)) {
                    const response = await fetch(download.url, {
                        signal: AbortSignal.timeout(30000),
                    });
                    assert(response.ok);
                    const bytes = new Uint8Array(await response.arrayBuffer());
                    assert(
                        sha256(bytes) === capture.contentHash,
                        "Stored capture hash mismatch",
                    );
                    writeFileSync(target, bytes, { mode: 0o600, flag: "wx" });
                }
            }
            const { captureDownloads, ...retained } = documentary;
            save(root, `${item.id}-${stamp}`, {
                execution,
                documentary: { ...retained, invocations, payloads },
            });
            console.log(
                JSON.stringify({
                    id: item.id,
                    phase: execution.phase,
                    executionStatus: execution.executionStatus,
                    receipts: execution.receipts.length,
                    modelAttempts: execution.receipts.filter(
                        (c) => c.service === "model",
                    ).length,
                    reportedCost: execution.receipts.reduce(
                        (s, c) => s + (c.reportedCost ?? 0),
                        0,
                    ),
                    unknown: execution.receipts.filter(
                        (c) => c.dispatchOutcome === "unknown",
                    ).length,
                    captures: documentary.captures.length,
                    result:
                        documentary.preparation?.sourcesMission?.result
                            ?.outcome ?? null,
                }),
            );
        }
        return;
    }
    const diagnostics = [];
    try {
        let cursor: string | undefined;
        for (let i = 0; i < 20; i++) {
            const result = await client.mutation(
                ref(internal.runWorkspace.closeBrowserTestContext),
                {
                    slotKey: "analyst-4",
                    contextKey: protocol.contextKey,
                    ...(cursor ? { cursor } : {}),
                },
            );
            if (result.done) break;
            cursor = result.cursor;
            assert(i < 19, "Context close did not drain");
        }
    } catch {
        diagnostics.push("context_close_failed");
    }
    const flags = JSON.parse(
        readFileSync(join(root, "temporary-flags.json"), "utf8"),
    );
    for (const flag of flags) {
        try {
            if (flag.previous !== "true")
                command(
                    flag.previous === null
                        ? ["env", "remove", flag.name]
                        : ["env", "set", flag.name, flag.previous],
                );
        } catch {
            diagnostics.push(`restore_${flag.name}_failed`);
        }
    }
    save(root, "cleanup", { at: new Date().toISOString(), diagnostics });
    assert(!diagnostics.length, "Qualification cleanup incomplete");
    console.log(JSON.stringify({ root, status: "closed" }));
}

type TranscriptPage = FunctionReturnType<
    typeof internal.execution.fixtures.inspectSourcesInvocations
>;
type TranscriptPagination = FunctionArgs<
    typeof internal.execution.fixtures.inspectSourcesInvocations
>["paginationOpts"];

/** Collect exact transcript pages while preserving the lot's finite invocation bound. */
export async function collectSourcesTranscripts(
    readPage: (paginationOpts: TranscriptPagination) => Promise<TranscriptPage>,
    maximumProviderAttempts: number,
    mode?: "deterministic" | "live",
) {
    if (mode === "deterministic")
        assert.equal(
            maximumProviderAttempts,
            0,
            "Simulated inspection requires zero provider attempts",
        );
    const maximumInvocations =
        mode === "deterministic" ? 100 : maximumProviderAttempts;
    const invocations: TranscriptPage["page"] = [];
    const payloads: TranscriptPage["payloads"] = [];
    let cursor: string | null = null;
    assert(
        Number.isSafeInteger(maximumInvocations) && maximumInvocations > 0,
        "Invalid transcript inspection bound",
    );
    const observed = new Set<string>();
    for (let page = 0; page <= maximumInvocations; page++) {
        const transcript = await readPage({ numItems: 1, cursor });
        assert(
            transcript.page.length <= 1 &&
                invocations.length + transcript.page.length <=
                    maximumInvocations,
            "Sources transcript inspection exceeds the authorized invocation count",
        );
        for (const invocation of transcript.page) {
            assert(
                !observed.has(invocation._id),
                "Duplicate invocation during transcript inspection",
            );
            observed.add(invocation._id);
        }
        invocations.push(...transcript.page);
        payloads.push(...transcript.payloads);
        if (transcript.isDone) return { invocations, payloads };
        assert(
            transcript.continueCursor && transcript.continueCursor !== cursor,
            "Transcript inspection cursor did not advance",
        );
        cursor = transcript.continueCursor;
    }
    throw new Error("Sources transcript inspection incomplete");
}
