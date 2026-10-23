import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";

// The default catalog omits decision models. Query each modality explicitly.
const endpoints = [
    "https://openrouter.ai/api/v1/models",
    "https://openrouter.ai/api/v1/models?output_modalities=decisions",
];
const collected: Record<string, unknown>[] = [];
for (const url of endpoints) {
    const response = await fetch(url, {
        signal: AbortSignal.timeout(30_000),
        redirect: "error",
    });
    assert(response.ok, `Catalog HTTP ${response.status}`);
    const body = await response.json();
    assert(Array.isArray(body.data), "Invalid catalog");
    collected.push(...body.data);
}
const output = {
    observed_at: new Date().toISOString(),
    endpoints,
    models: collected,
};
const filename = process.argv[2];
if (filename) {
    writeFileSync(filename, `${JSON.stringify(output, null, 2)}\n`, {
        flag: "wx",
    });
}
const wanted = new Set([
    "typesafe/jev-1.13",
    "typesafe/jev-1.14",
    "microsoft/microsoft-decision-1",
    "deepseek/deepseek-v4-flash-0731",
    "z-ai/glm-5.3-flash",
    "xiaomi/mimo-v2.6-flash",
    "openai/gpt-6-luna-decisions",
    "perplexity/pplx-decider-flash-v1.2",
]);
console.log(
    JSON.stringify(
        collected
            .filter((m) => wanted.has(String(m.id)))
            .map((m) => ({
                id: m.id,
                pricing: m.pricing,
                context_length: m.context_length,
                supported_parameters: m.supported_parameters,
            })),
        null,
        2,
    ),
);
