import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** Synthetic native Codex login shared by isolated runtime and discovery tests. */
export function qualificationReviewCodexCredential() {
    return {
        type: "oauth",
        access: `fixture.${Buffer.from(JSON.stringify({ "https://api.openai.com/auth": { chatgpt_account_id: "fixture-account" } })).toString("base64url")}.signature`,
        refresh: "synthetic-oauth-refresh",
        expires: Date.now() + 600000,
    };
}

/** Frozen SDK1.5.0 API pricing fixture, not a live tariff recommendation. */
export function qualificationReviewApiAnalysis(
    model: "gpt-4o-mini" | "gpt-6.1-sol" = "gpt-4o-mini",
) {
    const high = model === "gpt-6.1-sol";
    return {
        scope: "evidence_review" as const,
        accounting: "api_cost" as const,
        routes: [{ provider: "openai" as const, model }],
        perLot: { requests: 2, costMicros: high ? 8000000 : 200000 },
        total: { requests: 2, costMicros: high ? 8000000 : 200000 },
        maxRequestCostMicros: high ? 4000000 : 100000,
        ...(high ? {} : { maxOutputTokens: 1000 }),
        timeoutMs: 10000,
        pricing: {
            provider: "openai" as const,
            model,
            api: "openai-responses" as const,
            contextWindow: high ? 272000 : 128000,
            maxTokens: high ? 128000 : 16384,
            cost: high
                ? {
                      input: 2,
                      output: 10,
                      cacheRead: 0.1,
                      cacheWrite: 2.5,
                      tiers: [
                          {
                              inputTokensAbove: 272000,
                              input: 4,
                              output: 15,
                              cacheRead: 0.2,
                              cacheWrite: 5,
                          },
                      ],
                  }
                : { input: 0.15, output: 0.6, cacheRead: 0.075, cacheWrite: 0 },
            serviceTier: "default" as const,
            sourceUrl: "https://openai.com/api/pricing/",
            verifiedAt: Date.now(),
        },
    };
}

/** Test-only native runtime with synthetic credentials and no user configuration or model-network access. */
export async function qualificationReviewRuntime(
    provider: "openai" | "openai-codex" | "both" = "openai",
    storedApiKey?: string,
) {
    const { ModelRuntime } = await import("@earendil-works/pi-coding-agent");
    const root = mkdtempSync(join(tmpdir(), "pi-review-auth-fixture-"));
    if (provider !== "openai")
        writeFileSync(
            join(root, "auth.json"),
            JSON.stringify({
                "openai-codex": qualificationReviewCodexCredential(),
                ...(storedApiKey === undefined
                    ? {}
                    : { openai: { type: "api_key", key: storedApiKey } }),
            }),
        );
    const runtime = await ModelRuntime.create({
        authPath: join(root, "auth.json"),
        modelsPath: null,
        allowModelNetwork: false,
        refreshOnCreate: false,
    });
    if (provider !== "openai-codex")
        await runtime.setRuntimeApiKey(
            "openai",
            "sk-synthetic-offline-qualification-key",
        );
    return runtime;
}

/** Decode the SDK wire request, including native Codex compression, at the mocked HTTP boundary. */
export async function qualificationReviewPayload(init?: RequestInit) {
    const bytes = Buffer.from(await new Response(init?.body).arrayBuffer());
    const { zstdDecompressSync } = await import("node:zlib");
    const text =
        new Headers(init?.headers).get("content-encoding") === "zstd"
            ? zstdDecompressSync(bytes).toString("utf8")
            : bytes.toString("utf8");
    return JSON.parse(text) as Record<string, unknown>;
}

/** Canonical synthetic investigator envelope; raw malformed-response fixtures stay explicit. */
export function qualificationReviewReport(assessment: unknown) {
    return `# Findings\n\nSynthetic diagnostic handoff for offline boundary verification.\n\n## Assessment\n\n\`\`\`json\n${JSON.stringify(assessment)}\n\`\`\``;
}

/** Synthetic Responses stream. Default first turn reads evidence; null consultation emits text instead. */
export function qualificationReviewResponse(
    reviewJson: string,
    turn: number,
    consultation?: { name: string; arguments: Record<string, unknown> } | null,
    usage: unknown = {
        input_tokens: 100,
        output_tokens: 100,
        input_tokens_details: { cached_tokens: 0 },
    },
) {
    const tool =
        consultation !== null && (turn === 1 || consultation !== undefined);
    const operation = consultation ?? {
        name: "read",
        arguments: { path: "published.json" },
    };
    const item = tool
        ? {
              id: `fc-fixture-${turn}`,
              type: "function_call",
              call_id: `call-fixture-${turn}`,
              name: operation.name,
              arguments: JSON.stringify(operation.arguments),
              status: "completed",
          }
        : {
              id: `msg-fixture-${turn}`,
              type: "message",
              role: "assistant",
              content: [
                  { type: "output_text", text: reviewJson, annotations: [] },
              ],
              status: "completed",
          };
    const events = [
        { type: "response.created", response: { id: `response-${turn}` } },
        {
            type: "response.output_item.added",
            output_index: 0,
            item: tool ? { ...item, arguments: "" } : { ...item, content: [] },
        },
        ...(tool
            ? [
                  {
                      type: "response.function_call_arguments.delta",
                      output_index: 0,
                      delta: item.arguments,
                  },
              ]
            : [
                  {
                      type: "response.output_text.delta",
                      output_index: 0,
                      delta: reviewJson,
                  },
              ]),
        { type: "response.output_item.done", output_index: 0, item },
        {
            type: "response.completed",
            response: {
                id: `response-${turn}`,
                status: "completed",
                output: [item],
                usage,
            },
        },
    ];
    return new Response(
        events
            .map(
                (event) =>
                    `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`,
            )
            .join(""),
        { headers: { "content-type": "text/event-stream" } },
    );
}
