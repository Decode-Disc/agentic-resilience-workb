import {
    modelCallSettings,
    WORKBENCH_MODEL_ROUTE,
} from "@convex/integrations/modelRouting";
import { afterEach, expect, test, vi } from "vitest";

test("new Workbench requests leave provider selection to OpenRouter", () => {
    const settings = modelCallSettings(WORKBENCH_MODEL_ROUTE).request;
    expect(settings.provider).not.toHaveProperty("only");
    expect(settings.provider).not.toHaveProperty("allow_fallbacks");
    expect(settings.provider).toMatchObject({
        require_parameters: true,
        max_price: { prompt: 0.15, completion: 0.6 },
    });
});

afterEach(() => {
    vi.doUnmock("@convex/integrations/piInputProfileCatalog.json");
    vi.resetModules();
});

test("changing the recorded serializer version invalidates a prepared model fingerprint", async () => {
    const original = await import("@convex/integrations/modelRouting");
    const before = original.modelConfigurationKey({ contextWindow: 131072 });
    const metadata = (
        await import("@convex/integrations/piInputProfileCatalog.json")
    ).default;
    vi.doMock("@convex/integrations/piInputProfileCatalog.json", () => ({
        default: {
            ...metadata,
            versions: { ...metadata.versions, "pi-ai": "changed-sdk-version" },
        },
    }));
    vi.resetModules();
    const changed = await import("@convex/integrations/modelRouting");
    expect(changed.modelConfigurationKey({ contextWindow: 131072 })).not.toBe(
        before,
    );
});
