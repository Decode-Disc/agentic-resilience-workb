import { INITIAL_MODEL_CATALOG } from "@convex/integrations/modelRouting";
import { localBrowserFixturesEnabled } from "@convex/runWorkspace";

/** Deterministic metadata for isolated browser runs; never inference or live qualification evidence. */
export function browserModelMetadata(url: string): unknown | undefined {
    if (process.env.E2E_MODEL_METADATA_FIXTURE !== "true") return undefined;
    if (!localBrowserFixturesEnabled())
        throw new Error(
            "Browser model metadata requires enabled loopback fixtures",
        );
    if (url !== "https://openrouter.ai/api/v1/models")
        throw new Error("No browser metadata fixture for this request");
    return {
        data: INITIAL_MODEL_CATALOG.map((model, index) => ({
            id: model.model,
            context_length: 131072,
            top_provider: { max_completion_tokens: 8192 },
            pricing: {
                prompt: "0.00000003",
                completion: "0.0000001",
                input_cache_read: "0.00000001",
            },
            supported_parameters: [
                "tools",
                "max_tokens",
                "reasoning",
                "structured_outputs",
            ],
            reasoning: {
                supported_efforts:
                    index === 0
                        ? ["none", "low", "medium", "high"]
                        : ["none", "high"],
                mandatory: false,
                default_effort: "none",
            },
        })),
    };
}
