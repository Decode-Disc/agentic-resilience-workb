import { fetchExaSearch } from "@convex/integrations/exaSearchClient";
import { expect, test } from "vitest";

test("discovers public source metadata through the production search transport", async () => {
    const key = process.env.EXA_API_KEY?.trim();
    if (!key) throw new Error("Live discovery requires a configured Exa key");
    const startedAt = Date.now();
    const result = await fetchExaSearch(
        key,
        "ServiceNow official platform documentation",
        {
            type: "auto",
            numResults: 1,
            contents: false,
            includeDomains: ["servicenow.com"],
        },
    );
    expect(result.results.length).toBeGreaterThan(0);
    expect(result.results.length).toBeLessThanOrEqual(1);
    for (const source of result.results) {
        expect(new URL(source.url).protocol).toBe("https:");
        expect(source.title).toBeTruthy();
        expect(source).not.toHaveProperty("text");
    }
    console.info(
        JSON.stringify({
            contract: "live_source_discovery",
            observedAt: new Date().toISOString(),
            latencyMs: Date.now() - startedAt,
            candidates: result.results.length,
            outcome: "succeeded",
        }),
    );
}, 35_000);
