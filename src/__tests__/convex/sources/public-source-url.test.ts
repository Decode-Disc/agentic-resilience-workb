import { validatePublicSourceUrl } from "@convex/domain/publicSourceUrl";
import { inspectPublicSourceMetadata } from "@convex/sourceActions";
import { describe, expect, test } from "vitest";

describe("validatePublicSourceUrl", () => {
    test.each([
        "http://example.com/report",
        "https://user:pass@example.com/report",
        "https://127.0.0.1/report",
        "https://[::1]/report",
        "https://169.254.169.254/latest/meta-data",
        "https://10.0.0.4/report",
        "https://192.168.1.3/report",
    ])("rejects unsafe URL %s", async (url) => {
        await expect(
            validatePublicSourceUrl(url, async () => ["93.184.216.34"]),
        ).rejects.toThrow();
    });

    test("canonicalizes a public HTTPS URL", async () => {
        await expect(
            validatePublicSourceUrl(
                "https://Example.com:443/report#section",
                async () => ["93.184.216.34"],
            ),
        ).resolves.toEqual({
            canonicalUrl: "https://example.com/report",
            hostname: "example.com",
        });
    });

    test("rejects private DNS results", async () => {
        await expect(
            validatePublicSourceUrl("https://example.com/report", async () => [
                "10.0.0.1",
            ]),
        ).rejects.toThrow("public network");
    });

    test.each([
        { addresses: [] },
        { addresses: ["0.0.0.0"] },
        { addresses: ["100.64.0.1"] },
        { addresses: ["224.0.0.1"] },
        { addresses: ["2001:db8::1"] },
        { addresses: ["fc00::1"] },
        { addresses: ["fe80::1"] },
    ])("rejects non-public DNS results $addresses", async ({ addresses }) => {
        await expect(
            validatePublicSourceUrl(
                "https://example.com/report",
                async () => addresses,
            ),
        ).rejects.toThrow("public network");
    });
});

test("captures bounded metadata without persisting content", async () => {
    const request = async () =>
        new Response("<html><head><title>Public report</title></head></html>", {
            status: 200,
            headers: { "Content-Type": "text/html; charset=utf-8" },
        });

    await expect(
        inspectPublicSourceMetadata("https://Example.com/report#section", {
            resolveAddresses: async () => ["93.184.216.34"],
            request,
        }),
    ).resolves.toEqual({
        canonicalUrl: "https://example.com/report",
        title: "Public report",
    });
});

test("pins the validated address for the initial request and redirects", async () => {
    const resolutions = new Map([
        ["example.com", ["93.184.216.34"]],
        ["reports.example.org", ["93.184.216.35"]],
    ]);
    const requests: Array<{ url: string; address: string }> = [];

    await expect(
        inspectPublicSourceMetadata("https://example.com/start", {
            resolveAddresses: async (hostname) =>
                resolutions.get(hostname) ?? ["10.0.0.1"],
            request: async (url, address) => {
                requests.push({ url, address });
                if (url.endsWith("/start")) {
                    return new Response(null, {
                        status: 302,
                        headers: {
                            Location: "https://reports.example.org/report",
                        },
                    });
                }
                return new Response(
                    "<html><title>Pinned public report</title></html>",
                    { headers: { "Content-Type": "text/html" } },
                );
            },
        }),
    ).resolves.toEqual({
        canonicalUrl: "https://reports.example.org/report",
        title: "Pinned public report",
    });
    expect(requests).toEqual([
        {
            url: "https://example.com/start",
            address: "93.184.216.34",
        },
        {
            url: "https://reports.example.org/report",
            address: "93.184.216.35",
        },
    ]);
});
