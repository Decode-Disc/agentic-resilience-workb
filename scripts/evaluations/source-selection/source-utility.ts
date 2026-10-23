import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { internal } from "@convex/_generated/api";
import { ConvexHttpClient } from "convex/browser";
import {
    type FunctionArgs,
    type FunctionReturnType,
    makeFunctionReference,
} from "convex/server";
import { createServer } from "vite";

const seedRecorded = makeFunctionReference<
    "action",
    FunctionArgs<typeof internal.e2eFixtures.seedRecordedSourceReview>,
    FunctionReturnType<typeof internal.e2eFixtures.seedRecordedSourceReview>
>("e2eFixtures:seedRecordedSourceReview");
const inspectRecorded = makeFunctionReference<
    "query",
    FunctionArgs<typeof internal.e2eFixtures.inspectRecordedSourceReview>,
    FunctionReturnType<typeof internal.e2eFixtures.inspectRecordedSourceReview>
>("e2eFixtures:inspectRecordedSourceReview");

const root =
    "scripts/evaluations/source-selection/fixtures/cross-company-20261020";
const run = `${root}/runs/batch2-grouped-20261021`;
const read = (p: string) => JSON.parse(readFileSync(p, "utf8"));
const hash = (s: string) => createHash("sha256").update(s).digest("hex");
const options = new Map<string, string>();
for (let i = 2; i < process.argv.length; i += 2) {
    const key = process.argv[i],
        value = process.argv[i + 1];
    assert(
        key &&
            ["--phase", "--out-dir", "--scenario", "--scenarios"].includes(
                key,
            ) &&
            value &&
            !options.has(key),
        "Invalid utility option",
    );
    options.set(key, value);
}
const phase = options.get("--phase") ?? "audit";
assert(["audit", "seed"].includes(phase), "Unknown utility phase");
const out = resolve(options.get("--out-dir") ?? "/tmp/source-utility-20261021");
mkdirSync(out, { recursive: true });
const scenarios = read(
    options.get("--scenarios") ?? `${root}/utility-scenarios-v2.json`,
);
const study = read(`${root}/study.json`);
const manifest = read(`${run}/manifest.json`);
const results = read(`${run}/final-results.json`);
const server = await createServer({
    server: { middlewareMode: true },
    appType: "custom",
});
try {
    const { prepareQualificationInput, materializeQualificationOutput } =
        (await server.ssrLoadModule(
            "/convex/domain/sourceQualification.ts",
        )) as typeof import("@convex/domain/sourceQualification");
    const preparedDocuments = new Map();
    for (const doc of study.documents) {
        const call = manifest.calls.find(
            (c: { key: string }) =>
                c.key ===
                `qualification:document:${doc.id}:${scenarios.historicalModel}`,
        );
        const observed = results.observations.find(
            (o: { key: string }) => o.key === call?.key,
        );
        assert(call && observed, "Missing historical qualification");
        const text = readFileSync(`${root}/${doc.textFile}`, "utf8");
        assert.equal(hash(text), doc.contentHash, "Capture bytes changed");
        assert.equal(
            hash(JSON.stringify(call.body)),
            call.requestHash,
            "Historical wire request changed",
        );
        const request = call.prepared.request;
        const input = prepareQualificationInput({
            company: request.company,
            canonicalUrl: doc.url,
            title: doc.title,
            text,
            asOfTime: Date.parse(request.asOfDate),
            researchAngle: request.researchAngle,
        });
        assert.equal(
            input.inputHash,
            call.prepared.inputHash,
            "Historical preparation no longer reproducible",
        );
        const qualification = materializeQualificationOutput(
            input,
            observed.output.value,
        );
        preparedDocuments.set(doc.id, {
            doc,
            input,
            qualification,
            observed,
            source: {
                canonicalUrl: doc.url,
                title: doc.title,
                category: ["annual", "quarterly"].includes(doc.category)
                    ? `sec_${doc.category}`
                    : ["product", "integration", "terms"].includes(doc.category)
                      ? "official_product"
                      : "counter_evidence",
                origin: ["annual", "quarterly"].includes(doc.category)
                    ? ("sec" as const)
                    : ("exa" as const),
                ...(doc.category === "annual"
                    ? { secForm: "10-K" }
                    : doc.category === "quarterly"
                      ? { secForm: "10-Q" }
                      : {}),
                text,
                contentHash: doc.contentHash,
                originalInputHash: input.inputHash,
                asOfTime: Date.parse(request.asOfDate),
                originalResearchAngle: request.researchAngle,
                responseJson: JSON.stringify(observed.output.value),
            },
        });
    }
    const selected = scenarios.scenarios.filter(
        (s: { id: string }) =>
            !options.get("--scenario") ||
            options.get("--scenario")?.split(",").includes(s.id),
    );
    assert(selected.length > 0, "No scenarios selected");
    for (const id of options.get("--scenario")?.split(",") ?? [])
        assert(
            selected.some((s: { id: string }) => s.id === id),
            `Unknown scenario: ${id}`,
        );
    const audit = selected.map(
        (scenario: {
            id: string;
            companyId: string;
            suppliedDocumentId: string | null;
        }) => ({
            ...scenario,
            documents: [...preparedDocuments.values()]
                .filter((d) => d.doc.companyId === scenario.companyId)
                .map((d) => ({
                    id: d.doc.id,
                    title: d.doc.title,
                    url: d.doc.url,
                    category: d.doc.category,
                    contentHash: d.doc.contentHash,
                    qualificationStatus: d.qualification.status,
                    failure: d.qualification.reason ?? null,
                    inputHash: d.input.inputHash,
                    selectedPassageCount:
                        d.input.request.document.passages.length,
                    omittedPassageCount: d.input.omittedPassageCount,
                    findings: d.qualification.qualification?.findings ?? [],
                    limitations:
                        d.qualification.qualification?.limitations ?? [],
                    historicalCostUsd: d.observed.costUsd,
                })),
        }),
    );
    writeFileSync(
        `${out}/${phase}-audit.json`,
        `${JSON.stringify(
            {
                basis: scenarios.basis,
                originalManifestSha256: hash(
                    readFileSync(`${run}/manifest.json`, "utf8"),
                ),
                scenarios: audit,
                newProviderCalls: 0,
            },
            null,
            2,
        )}\n`,
        { flag: "wx" },
    );
    if (phase === "seed") {
        const config = read(".convex/local/default/config.json");
        assert(
            typeof config.adminKey === "string",
            "Existing local backend required",
        );
        const client = new ConvexHttpClient("http://127.0.0.1:3210");
        (
            client as ConvexHttpClient & { setAdminAuth(key: string): void }
        ).setAdminAuth(config.adminKey);
        const seeded = [];
        for (const scenario of selected.flatMap(
            (scenario: { mobile: boolean }) =>
                (scenario.mobile ? ["desktop", "mobile"] : ["desktop"]).map(
                    (viewport) => ({ ...scenario, viewport }),
                ),
        )) {
            const company = study.companies.find(
                (c: { id: string }) => c.id === scenario.companyId,
            );
            const sources = [...preparedDocuments.values()]
                .filter((d) => d.doc.companyId === scenario.companyId)
                .map((d) => ({
                    ...d.source,
                    ...(d.doc.id === scenario.suppliedDocumentId
                        ? {
                              origin: "analyst_url" as const,
                              category: "analyst_supplied",
                          }
                        : {}),
                }));
            const payload = {
                slotKey: "analyst-1",
                company: {
                    cik: company.cik,
                    legalName: company.legalName,
                    ticker: company.ticker,
                },
                websiteUrl: company.websiteUrl,
                researchAngle: scenario.researchAngle,
                sources,
            };
            const fixtureKey = `utility-${hash(out).slice(0, 10)}-${scenario.id}-${scenario.viewport}-${hash(JSON.stringify(payload)).slice(0, 12)}`;
            const state = await client.action(seedRecorded, {
                ...payload,
                fixtureKey,
            });
            const snapshot = await client.query(inspectRecorded, {
                runId: state.runId,
                fixtureKey,
            });
            assert.equal(snapshot.providerCalls, 0, "Unexpected provider call");
            seeded.push({
                ...scenario,
                fixtureKey,
                ...state,
                companyName: `${company.legalName} · Recorded review`,
                snapshot,
            });
            writeFileSync(
                `${out}/seeding-progress.json`,
                `${JSON.stringify(seeded, null, 2)}\n`,
            );
            console.log(
                `${scenario.id}: ${snapshot.sources.length} sources, ${snapshot.tasks.length} recorded qualifications, zero provider calls`,
            );
        }
        writeFileSync(
            `${out}/seeded.json`,
            `${JSON.stringify(seeded, null, 2)}\n`,
            { flag: "wx" },
        );
    }
    console.log(
        `Validated ${preparedDocuments.size} original qualification inputs; ${audit.length} scenario records.`,
    );
} finally {
    await server.close();
}
