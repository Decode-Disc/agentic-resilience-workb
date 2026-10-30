import { openrouterProvider } from "@earendil-works/pi-ai/providers/openrouter";

export const nativePiFixtureProvider = openrouterProvider();
export const nativePiFixtureModel = nativePiFixtureProvider
    .getModels()
    .find((model) => model.api === "openai-completions");
if (!nativePiFixtureModel)
    throw new Error("Pinned Pi catalog lacks the fixture API");
export const nativePiFixtureRoute = {
    model: nativePiFixtureModel.id,
    provider: "test-provider",
    authorizedForAgent: true as const,
};
