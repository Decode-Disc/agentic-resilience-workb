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

/** Test-only native runtime with synthetic credentials and no user configuration or model-network access. */
export async function qualificationReviewRuntime(
    provider: "openai" | "openai-codex" = "openai",
) {
    const { ModelRuntime } = await import("@earendil-works/pi-coding-agent");
    const root = mkdtempSync(join(tmpdir(), "pi-review-auth-fixture-"));
    if (provider === "openai-codex")
        writeFileSync(
            join(root, "auth.json"),
            JSON.stringify({
                "openai-codex": qualificationReviewCodexCredential(),
            }),
        );
    const runtime = await ModelRuntime.create({
        authPath: join(root, "auth.json"),
        modelsPath: null,
        allowModelNetwork: false,
        refreshOnCreate: false,
    });
    if (provider === "openai")
        await runtime.setRuntimeApiKey(
            "openai",
            "synthetic-offline-qualification-key",
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

/** Synthetic OpenAI Responses stream: inspect evidence, then return the supplied review. */
export function qualificationReviewResponse(reviewJson: string, turn: number) {
    const tool = turn === 1;
    const item = tool
        ? {
              id: "fc-fixture",
              type: "function_call",
              call_id: "call-fixture",
              name: "read",
              arguments: JSON.stringify({ path: "published.json" }),
              status: "completed",
          }
        : {
              id: "msg-fixture",
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
                usage: {
                    input_tokens: 100,
                    output_tokens: 100,
                    input_tokens_details: { cached_tokens: 0 },
                },
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
