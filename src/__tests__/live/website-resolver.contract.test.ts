import { createExaWebsiteAdapter } from "@convex/integrations/exa";
import { classifyIrAsWebsite } from "@convex/integrations/sec";
import { resolveWebsiteUrl } from "@convex/integrations/websiteResolver";
import Exa from "exa-js";
import { expect, test } from "vitest";

test("website resolver performs one bounded metadata-only Exa lookup", async () => {
    if (process.env.RUN_LIVE_PROVIDER_TESTS !== "1") {
        expect(process.env.RUN_LIVE_PROVIDER_TESTS).not.toBe("1");
        return;
    }
    const apiKey = process.env.EXA_API_KEY?.trim();
    if (!apiKey) {
        throw new Error("EXA_API_KEY is required for live provider tests");
    }
    const client = new Exa(apiKey);
    let requests = 0;
    let reportedCost: unknown;
    let providerSearchTime: number | undefined;
    const adapter = createExaWebsiteAdapter({
        search: async (query, options) => {
            requests += 1;
            const response = await client.search(query, options);
            reportedCost = response.costDollars;
            providerSearchTime = response.searchTime;
            return response;
        },
    });

    const startedAt = Date.now();
    const result = await resolveWebsiteUrl(
        {
            legalName: "ServiceNow, Inc.",
            ticker: "NOW",
            investorRelationsUrl: "https://investor.servicenow.com",
        },
        {
            exaSearch: async (query) =>
                (await adapter.search(query)).candidates,
            classifyIr: classifyIrAsWebsite,
        },
    );
    const latencyMs = Date.now() - startedAt;

    expect(requests).toBe(1);
    expect(result, "no website resolved for ServiceNow, Inc.").not.toBeNull();
    const hostname = new URL(result?.url ?? "").hostname
        .toLowerCase()
        .replace(/^www\./, "");
    expect(
        hostname === "servicenow.com" || hostname.endsWith(".servicenow.com"),
    ).toBe(true);
    expect(result?.source).toBe("exa");
    console.info(
        "LIVE_PROVIDER_EVIDENCE",
        JSON.stringify({
            provider: "exa_website",
            requests,
            latencyMs,
            providerSearchTime,
            resolvedHostname: hostname,
            cost: reportedCost ?? "not_reported",
        }),
    );
});
