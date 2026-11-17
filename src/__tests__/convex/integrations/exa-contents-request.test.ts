import { createExaContentsAdapter } from "@convex/integrations/exa";
import { createExaContentsClient } from "@convex/integrations/exaContentsClient";
import { afterEach, expect, test, vi } from "vitest";

afterEach(() => vi.restoreAllMocks());

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
