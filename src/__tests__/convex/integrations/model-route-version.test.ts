import { afterEach, expect, test, vi } from "vitest";

afterEach(() => {
    vi.doUnmock("@earendil-works/pi-ai/utils/version");
    vi.resetModules();
});

test("changing the installed serializer version invalidates a prepared model fingerprint", async () => {
    const original = await import("@convex/integrations/modelRouting");
    const before = original.modelConfigurationKey({ contextWindow: 131072 });
    vi.doMock("@earendil-works/pi-ai/utils/version", () => ({
        PI_AI_VERSION: "changed-sdk-version",
    }));
    vi.resetModules();
    const changed = await import("@convex/integrations/modelRouting");
    expect(changed.modelConfigurationKey({ contextWindow: 131072 })).not.toBe(
        before,
    );
});
