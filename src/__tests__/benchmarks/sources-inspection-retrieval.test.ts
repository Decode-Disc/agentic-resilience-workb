// @vitest-environment node
import { expect, test, vi } from "vitest";

const { openNativeSourcesInspection } = await import(
    "../../../scripts/evaluations/source-selection/sources-inspection-retrieval"
);
const { SourcesPreparation, sourcesDigest } = await import(
    "../../../scripts/evaluations/source-selection/sources-approach-study"
);
function preparation() {
    const text =
        "Customers retain ownership of Customer Data. The company processes data to provide the service.";
    return new SourcesPreparation({
        id: "case",
        phase: "development",
        company: { cik: "123", ticker: "ACME", legalName: "Acme" },
        researchAngle: "Data rights",
        asOfTime: 0,
        sources: [
            {
                candidate: {
                    sourceId: "terms",
                    title: "Terms",
                    canonicalUrl: "https://acme.example/terms",
                    origin: "exa",
                    category: "commercial",
                    createdAt: 0,
                },
                text,
                contentHash: sourcesDigest(text),
            },
        ],
    });
}
test("native inspection refuses remote deployments before accessing credentials or network", async () => {
    const request = vi.fn<typeof fetch>();
    await expect(
        openNativeSourcesInspection({
            origin: "https://example.convex.cloud",
            deploymentName: "local-test",
            adminKey: "test-secret",
            slotKey: "analyst-4",
            fixtureKey: "inspection-test",
            preparation: preparation(),
            fetch: request,
        }),
    ).rejects.toThrow("Local loopback retrieval required");
    expect(request).not.toHaveBeenCalled();
});

test("native inspection checks the running instance before sending its admin credential", async () => {
    const requests: string[] = [];
    const request: typeof fetch = async (url) => {
        requests.push(String(url));
        if (String(url).endsWith("/instance_name"))
            return new Response("another-project");
        return Response.json({
            status: "success",
            value: {
                runId: "run",
                preparationId: "preparation",
                captureId: "capture",
                candidateCount: 1,
            },
        });
    };
    await expect(
        openNativeSourcesInspection({
            origin: "http://127.0.0.1:3210",
            deploymentName: "local-test",
            adminKey: "test-secret",
            slotKey: "analyst-4",
            fixtureKey: "inspection-123456789abc",
            preparation: preparation(),
            fetch: request,
        }),
    ).rejects.toThrow("Running backend does not match");
    expect(requests).toEqual(["http://127.0.0.1:3210/instance_name"]);
});
