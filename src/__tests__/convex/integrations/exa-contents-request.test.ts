import { createExaContentsAdapter } from "@convex/integrations/exa";
import { createExaContentsClient } from "@convex/integrations/exaContentsClient";
import { afterEach, expect, test, vi } from "vitest";

afterEach(() => vi.restoreAllMocks());

test.each([
    { requestId: 42 },
    { statuses: [{ status: 200 }] },
])("refuses malformed provider evidence metadata %j", async (metadata) => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
        Response.json({
            results: [
                {
                    id: "document",
                    url: "https://example.com",
                    text: "Evidence",
                },
            ],
            ...metadata,
        }),
    );
    await expect(
        createExaContentsClient("fixture-key").getContents(
            ["https://example.com"],
            { text: true },
            { signal: new AbortController().signal },
        ),
    ).rejects.toMatchObject({ errorCode: "invalid_response" });
});

test("the real Contents client sends supported options within the provider text limit", async () => {
    const url = "https://example.com/contract";
    const fetch = vi.spyOn(globalThis, "fetch").mockResolvedValue(
        Response.json({
            results: [{ id: url, url, text: "Public source content" }],
        }),
    );
    const adapter = createExaContentsAdapter(
        createExaContentsClient("fixture-key"),
    );
    expect(await adapter.retrieveText(url)).toMatchObject({
        text: "Public source content",
    });
    expect(JSON.parse(String(fetch.mock.calls[0]?.[1]?.body))).toEqual({
        urls: [url],
        text: { maxCharacters: 1_000_000 },
    });
});
