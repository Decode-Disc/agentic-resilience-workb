import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { createServer } from "vite";

const loader = await createServer({
    configFile: false,
    resolve: { tsconfigPaths: true },
    server: { middlewareMode: true, watch: null },
    appType: "custom",
});
const observations = [];
const encoder = new TextEncoder();

try {
    const { createBoundedModelFetch } = await loader.ssrLoadModule(
        "/convex/integrations/modelTransport.ts",
    );
    const { examineDocumentaryContributions } = await loader.ssrLoadModule(
        "/convex/integrations/documentaryControl.ts",
    );

    for (const contentType of ["application/json", "text/event-stream"]) {
        for (const interrupted of [false, true]) {
            const captures = [];
            let emittedBytes = 0;
            let readError;
            const payload =
                contentType === "application/json"
                    ? '{"message":"visible partial assistant content"}'
                    : 'data: {"choices":[{"delta":{"content":"visible content"}}]}\n\n';
            let pulls = 0;
            const transport = createBoundedModelFetch(
                {
                    fetch: async () =>
                        new Response(
                            new ReadableStream(
                                {
                                    pull(controller) {
                                        if (pulls++ === 0) {
                                            const bytes =
                                                encoder.encode(payload);
                                            emittedBytes += bytes.length;
                                            controller.enqueue(bytes);
                                        } else if (interrupted) {
                                            controller.error(
                                                new DOMException(
                                                    "Probe interrupted",
                                                    "TimeoutError",
                                                ),
                                            );
                                        } else controller.close();
                                    },
                                },
                                { highWaterMark: 0 },
                            ),
                            { headers: { "content-type": contentType } },
                        ),
                    onResponse: (capture) => captures.push(capture),
                },
                { responseTooLarge: false },
            );
            try {
                const response = await transport(
                    "https://provider.invalid/probe",
                );
                await response.text();
            } catch (error) {
                readError = error.name;
            }
            assert(emittedBytes > 0);
            assert.equal(captures.length, interrupted ? 0 : 1);
            if (!interrupted) assert.equal(captures[0].body, payload);
            observations.push({
                boundary: "createBoundedModelFetch",
                contentType,
                interrupted,
                emittedBytes,
                observedBodies: captures.length,
                observedBodyBytes: captures.reduce(
                    (n, c) => n + encoder.encode(c.body).length,
                    0,
                ),
                readError,
            });
        }
    }

    const contribution = {
        id: "probe-contribution",
        version: 1,
        needIds: ["common-context"],
        statement: "The company supplies estimating software.",
        period: "2025",
        modality: "company statement",
        attribution: "Annual report",
        kind: "asserted_fact",
        evidence: [],
    };
    const route = {
        model: "example/documentary",
        executionPlanVersion: "source_actions_v4",
        descriptor: {
            contextWindow: 64000,
            maxTokens: 20000,
            reasoning: false,
            inputPrice: 0.01,
            outputPrice: 0.02,
            cacheReadPrice: 0,
            structuredOutputs: true,
        },
    };
    for (const interrupted of [false, true]) {
        const providerObservations = [];
        let wire;
        let emittedBytes = 0;
        const output = {
            coherence: true,
            limitations: [],
            findings: {
                [contribution.id]: {
                    conclusion: "supported",
                    permittedUse: "documentary",
                    diagnostic: "Exact quotation supports this statement.",
                },
            },
        };
        const result = await examineDocumentaryContributions(
            { contributions: [contribution], needs: [], evidence: [] },
            route,
            {
                apiKey: "offline-probe",
                authority: {
                    resourcePolicy: "authority_native_v1",
                    deadlineAt: Date.now() + 60000,
                },
                observeProvider: async (observation) => {
                    providerObservations.push(observation);
                },
                fetch: async (_url, init) => {
                    wire = JSON.parse(String(init.body));
                    const body = JSON.stringify({
                        id: "probe-generation",
                        model: route.model,
                        choices: [
                            {
                                index: 0,
                                message: {
                                    role: "assistant",
                                    content: JSON.stringify(output),
                                },
                                finish_reason: "stop",
                            },
                        ],
                        usage: {
                            prompt_tokens: 10,
                            completion_tokens: 10,
                            total_tokens: 20,
                        },
                    });
                    let pulls = 0;
                    return new Response(
                        new ReadableStream(
                            {
                                pull(controller) {
                                    if (pulls++ === 0) {
                                        const bytes = encoder.encode(
                                            interrupted
                                                ? body.slice(
                                                      0,
                                                      Math.floor(
                                                          body.length / 2,
                                                      ),
                                                  )
                                                : body,
                                        );
                                        emittedBytes += bytes.length;
                                        controller.enqueue(bytes);
                                    } else if (interrupted)
                                        controller.error(
                                            new DOMException(
                                                "Probe interrupted",
                                                "TimeoutError",
                                            ),
                                        );
                                    else controller.close();
                                },
                            },
                            { highWaterMark: 0 },
                        ),
                        {
                            headers: {
                                "content-type": "application/json",
                                "x-generation-id": "probe-generation",
                            },
                        },
                    );
                },
            },
        );
        assert.equal(result.status, interrupted ? "failed" : "succeeded");
        if (interrupted) {
            assert.equal(result.errorCode, "request_timeout");
            assert.equal(result.observableReplyJson, undefined);
        } else
            assert.deepEqual(result.output, {
                ...output,
                findings: [
                    {
                        contributionId: contribution.id,
                        ...output.findings[contribution.id],
                    },
                ],
            });
        observations.push({
            boundary: "examineDocumentaryContributions",
            interrupted,
            emittedBytes,
            wireStream: wire.stream ?? "absent",
            strictSchema: wire.response_format.json_schema.strict,
            status: result.status,
            errorCode: result.errorCode,
            observableReplyPresent: result.observableReplyJson !== undefined,
            generationObserved: providerObservations.some(
                (o) => o.generationId === "probe-generation",
            ),
        });
    }
    const result = {
        recordedAt: new Date().toISOString(),
        externalRequests: 0,
        observations,
    };
    await writeFile(
        new URL("response-retention-probe.json", import.meta.url),
        JSON.stringify(result, null, 2) + "\n",
    );
    console.log(JSON.stringify(result, null, 2));
} finally {
    await loader.close();
}
