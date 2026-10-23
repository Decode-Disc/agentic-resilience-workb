import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

type Prepared = ReturnType<
    typeof import("@convex/domain/sourceQualification").prepareQualificationInput
>;
type Route =
    typeof import("@convex/integrations/sourceQualificationConfig").sourceQualificationRoutes[number];

const root = dirname(fileURLToPath(import.meta.url));
const project = resolve(root, "../../..");
const runName = process.argv[2];
assert(runName && /^[a-z0-9-]+$/.test(runName), "Supply a retained run name");
const run = join(root, "runs", runName);
const manifestBytes = readFileSync(join(run, "manifest.json"), "utf8");
const manifest = JSON.parse(manifestBytes) as {
    hashes: Record<string, string>;
    inputs: { caseId: string; prepared: Prepared }[];
    routes: Route[];
};
const journalBytes = readFileSync(join(run, "calls.jsonl"), "utf8");
const results = journalBytes
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line)) as {
    event: string;
    caseId: string;
    model: string;
    status?: string;
    errorCode?: string;
}[];
const sha = (value: string) => createHash("sha256").update(value).digest("hex");
const transportPath = "convex/integrations/sourceQualification.ts";
assert.equal(
    sha(readFileSync(join(project, "pnpm-lock.yaml"), "utf8")),
    manifest.hashes["pnpm-lock.yaml"],
    "Installed dependency lock differs from the historical run",
);
const snapshots = new Map<string, string>();
for (const [path, hash] of Object.entries(manifest.hashes)) {
    if (!path.startsWith("convex/") || !path.endsWith(".ts")) continue;
    const source = readFileSync(join(run, "sources", `${path}.txt`), "utf8");
    assert.equal(
        sha(source),
        hash,
        `Historical source snapshot changed: ${path}`,
    );
    snapshots.set(join(project, path), source);
}

// The real SDK receives only the injected offline fetch. Any other fetch fails.
let unexpectedNetworkCalls = 0;
globalThis.fetch = async () => {
    unexpectedNetworkCalls += 1;
    throw new Error("Network is disabled during the request audit");
};
const server = await createServer({
    root: project,
    configFile: false,
    envDir: false,
    server: { middlewareMode: true, hmr: false, ws: false, watch: null },
    resolve: { tsconfigPaths: true },
    appType: "custom",
    optimizeDeps: { noDiscovery: true },
    cacheDir: "/tmp/workbench-qualification-module-cache",
    plugins: [
        {
            name: "retained-qualification-source-audit",
            enforce: "pre",
            load(id) {
                return snapshots.get(id);
            },
        },
    ],
});

try {
    const transport = (await server.ssrLoadModule(
        "/convex/integrations/sourceQualification.ts",
    )) as typeof import("@convex/integrations/sourceQualification");
    const observations = [];
    for (const route of manifest.routes) {
        for (const { caseId, prepared } of manifest.inputs) {
            let wire: Record<string, unknown> | undefined;
            let wireBytes = "";
            let interceptedCalls = 0;
            const outcome = await transport.qualifySourceDocument(
                prepared,
                route,
                {
                    apiKey: "offline-audit-placeholder",
                    fetch: async (_url, init) => {
                        interceptedCalls += 1;
                        wireBytes = String(init?.body);
                        wire = JSON.parse(wireBytes);
                        return new Response(
                            JSON.stringify({
                                error: {
                                    code: 502,
                                    message: "Offline audit sentinel",
                                },
                            }),
                            {
                                status: 502,
                                headers: { "Content-Type": "application/json" },
                            },
                        );
                    },
                },
            );
            assert.equal(interceptedCalls, 1);
            assert(wire);
            assert.equal(outcome.status, "failed");
            assert.equal(
                outcome.status === "failed" && outcome.errorCode,
                "transport_unavailable",
            );
            const messages = wire.messages as {
                role: string;
                content: string | { type: string; text?: string }[];
            }[];
            const messageParts = messages.flatMap((message) =>
                typeof message.content === "string"
                    ? [{ type: "text", text: message.content }]
                    : message.content,
            );
            const nonTextParts = messageParts.filter(
                (part) => part.type !== "text",
            );
            const text = messageParts.map((part) => part.text ?? "").join("\n");
            assert.equal(nonTextParts.length, 0);
            assert.equal(/data:image\//i.test(text), false);
            const historical = results.find(
                (result) =>
                    result.event === "result" &&
                    result.caseId === caseId &&
                    result.model === route.model,
            );
            observations.push({
                caseId,
                route,
                inputHash: prepared.inputHash,
                historicalStatus: historical?.status ?? "reused_response",
                historicalErrorCode: historical?.errorCode,
                wireSha256: sha(wireBytes),
                wireBytes: Buffer.byteLength(wireBytes),
                promptAndSchemaBytes: Buffer.byteLength(
                    JSON.stringify({
                        messages: wire.messages,
                        response_format: wire.response_format,
                    }),
                ),
                messagePartTypes: messageParts.map((part) => part.type),
                nonTextPartCount: nonTextParts.length,
                imageDataUriCount: (text.match(/data:image\//gi) ?? []).length,
                markdownImageReferenceCount: (text.match(/!\[/g) ?? []).length,
                responseFormatBytes: Buffer.byteLength(
                    JSON.stringify(wire.response_format),
                ),
                interceptedCalls,
            });
        }
    }
    assert.equal(unexpectedNetworkCalls, 0);
    const report = {
        auditedAt: new Date().toISOString(),
        sourceRun: runName,
        manifestSha256: sha(manifestBytes),
        journalSha256: sha(journalBytes),
        transportSha256: manifest.hashes[transportPath],
        snapshottedModules: [...snapshots.keys()].map((path) =>
            path.slice(project.length + 1),
        ),
        inferenceRequests: 0,
        unexpectedNetworkCalls,
        observations,
    };
    const output = process.argv[3];
    if (output)
        writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`, {
            flag: "wx",
        });
    console.log(
        JSON.stringify({
            auditedRequests: observations.length,
            inferenceRequests: 0,
            nonTextRequests: observations.filter(
                (item) => item.nonTextPartCount > 0,
            ).length,
            imageDataRequests: observations.filter(
                (item) => item.imageDataUriCount > 0,
            ).length,
            output,
        }),
    );
} finally {
    await server.close();
}
