import { openrouterProvider } from "@earendil-works/pi-ai/providers/openrouter";

export const nativePiFixtureProvider = openrouterProvider();
export const nativePiFixtureModel = nativePiFixtureProvider
    .getModels()
    .find((model) => model.id === "z-ai/glm-5.3-flash");
if (!nativePiFixtureModel)
    throw new Error("Pinned Pi catalog lacks the fixture API");
export const nativePiFixtureRoute = {
    model: nativePiFixtureModel.id,
    provider: "test-provider",
    authorizedForAgent: true as const,
};

export function nativeTextReply(text: string) {
    return new Response(
        [
            `data: ${JSON.stringify({ id: "native-workbench", choices: [{ index: 0, delta: { role: "assistant", content: text }, finish_reason: null }] })}`,
            `data: ${JSON.stringify({ id: "native-workbench", choices: [{ index: 0, delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 10, completion_tokens: 5 } })}`,
            "data: [DONE]",
            "",
        ].join("\n\n"),
        { headers: { "content-type": "text/event-stream" } },
    );
}

export function nativeToolReply(
    name: string,
    input: object | string | undefined,
) {
    return new Response(
        [
            `data: ${JSON.stringify({ id: "native-tool", choices: [{ index: 0, delta: { role: "assistant", content: "I am updating the proposal.", tool_calls: [{ index: 0, id: "native-adjust", type: "function", function: { name, arguments: typeof input === "string" ? input : JSON.stringify(input) } }] }, finish_reason: null }] })}`,
            `data: ${JSON.stringify({ id: "native-tool", choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }], usage: { prompt_tokens: 10, completion_tokens: 5 } })}`,
            "data: [DONE]",
            "",
        ].join("\n\n"),
        { headers: { "content-type": "text/event-stream" } },
    );
}
