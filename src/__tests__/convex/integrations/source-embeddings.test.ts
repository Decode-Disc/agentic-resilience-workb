import { embedSourceTexts } from "@convex/integrations/sourceEmbeddings";
import { afterEach, expect, test, vi } from "vitest";

afterEach(() => vi.unstubAllGlobals());
const configured = {
    accountId: "a".repeat(32),
    apiToken: "test-only-token",
    texts: ["Revenue in USD millions."],
};
const vector = Array.from({ length: 1024 }, (_, i) => (i === 0 ? 1 : 0));
test("a configured embedding call validates the whole vector batch and disables redirects and truncation", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
        new Response(
            JSON.stringify({
                success: true,
                result: { shape: [1, 1024], data: [vector] },
            }),
        ),
    );
    vi.stubGlobal("fetch", fetchMock);
    const result = await embedSourceTexts(configured);
    expect(result).toEqual({
        status: "embedded",
        vectors: [vector],
        submittedBytes: 24,
    });
    expect(fetchMock).toHaveBeenCalledOnce();
    const request = fetchMock.mock.calls[0]?.[1];
    expect(request.redirect).toBe("error");
    expect(JSON.parse(request.body)).toEqual({
        text: configured.texts,
        truncate_inputs: false,
    });
});
test("missing configuration or oversized text cannot issue an external request", async () => {
    const f = vi.fn();
    vi.stubGlobal("fetch", f);
    expect(await embedSourceTexts({ texts: ["hello"] })).toEqual({
        status: "unavailable",
        reason: "missing_configuration",
    });
    expect(
        await embedSourceTexts({ ...configured, texts: ["a".repeat(6001)] }),
    ).toEqual({ status: "unavailable", reason: "request_invalid" });
    expect(f).not.toHaveBeenCalled();
});
test.each(
    [
        [],
        [vector, vector],
        [Array(1024).fill(0)],
        [Array(10).fill(1)],
        [Array(1024).fill(null)],
    ].map((data) => ({ data })),
)("malformed vectors cannot be cached as hybrid success", async ({ data }) => {
    vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue(
            new Response(
                JSON.stringify({
                    success: true,
                    result: { shape: [1, 1024], data },
                }),
            ),
        ),
    );
    expect(await embedSourceTexts(configured)).toEqual({
        status: "unavailable",
        reason: "response_invalid",
    });
});
test("an oversized response is rejected without retry", async () => {
    const f = vi
        .fn()
        .mockResolvedValue(new Response("a".repeat(1024 * 1024 + 1)));
    vi.stubGlobal("fetch", f);
    expect(await embedSourceTexts(configured)).toEqual({
        status: "unavailable",
        reason: "response_invalid",
    });
    expect(f).toHaveBeenCalledOnce();
});

test("an interrupted response releases its reader without returning vectors or retrying", async () => {
    let reads = 0;
    const body = new ReadableStream<Uint8Array>({
        pull(controller) {
            if (reads++ === 0) {
                controller.enqueue(
                    new TextEncoder().encode('{"success":true,"result":'),
                );
            } else {
                controller.error(
                    new TypeError("Connection closed during body"),
                );
            }
        },
    });
    const fetchMock = vi.fn().mockResolvedValue(new Response(body));
    vi.stubGlobal("fetch", fetchMock);
    expect(await embedSourceTexts(configured)).toEqual({
        status: "unavailable",
        reason: "transport_unavailable",
    });
    expect(body.locked).toBe(false);
    expect(fetchMock).toHaveBeenCalledOnce();
});
