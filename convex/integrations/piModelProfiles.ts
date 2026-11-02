import { getAgentDefinition } from "@convex/execution/agentCatalog";
import {
    type AgentDefinition,
    agentToolSchemas,
} from "@convex/execution/agentDefinition";
import { agentDefinitionIdValidator } from "@convex/execution/agentSchemas";
import type { modelDescriptor } from "@convex/modelConfigurationSchema";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import {
    createModels,
    fauxAssistantMessage,
    fauxProvider,
    type Model,
    type TranscriptContext,
} from "@earendil-works/pi-ai";
import { openrouterProvider } from "@earendil-works/pi-ai/providers/openrouter";
import { normalizeContext } from "@earendil-works/pi-ai/utils/transcript";
import {
    createRegistry,
    defineExtension,
    defineTool,
    Harness,
    MemoryStorage,
} from "@earendil-works/pi-durable";
import type { Infer } from "convex/values";
import {
    PI_MISSION_EXTENSION,
    PI_MISSION_INPUT,
    piInputProfileKey,
    piMissionMessages,
    piToolMetadata,
    preparePiModelPayload,
} from "./modelInput";
import {
    MODEL_MAX_OUTPUT_TOKENS,
    type ModelRoute,
    modelConfigurationKey,
} from "./modelRouting";

/** Builds a supported chat model from validated OpenRouter metadata, without a bundled-ID dependency. */
export function configuredNativeModel(
    model: string,
    descriptor: Infer<typeof modelDescriptor>,
): Model<"openai-completions"> {
    return {
        id: model,
        name: model,
        api: "openai-completions",
        provider: "openrouter",
        baseUrl: "https://openrouter.ai/api/v1",
        input: ["text"],
        reasoning: descriptor.reasoning,
        contextWindow: descriptor.contextWindow,
        maxTokens: descriptor.maxTokens,
        cost: {
            input: descriptor.inputPrice,
            output: descriptor.outputPrice,
            cacheRead: descriptor.cacheReadPrice,
            cacheWrite: 0,
        },
    };
}

async function profileTranscript(
    definition: AgentDefinition,
    operations: ReturnType<typeof agentToolSchemas>,
) {
    const faux = fauxProvider({
        models: [
            {
                id: "controlled",
                contextWindow: 32000,
                maxTokens: MODEL_MAX_OUTPUT_TOKENS,
            },
        ],
    });
    let captured: TranscriptContext["messages"] | undefined;
    faux.setResponses([
        (context) => {
            captured = context.messages;
            return fauxAssistantMessage("Offline profile prepared");
        },
    ]);
    const tools = await Promise.all(
        Object.entries(operations).map(async ([name, operation]) =>
            defineTool({
                ...(await piToolMetadata(name, operation)),
                async execute() {
                    throw new Error("Profile preparation cannot execute tools");
                },
            }),
        ),
    );
    const registry = createRegistry();
    registry.install(defineExtension({ name: PI_MISSION_EXTENSION, tools }));
    const models = createModels();
    models.setProvider(faux.provider);
    const harness = await Harness.open(
        new MemoryStorage(),
        { models, registry },
        BACKGROUND_CONTEXT,
    );
    try {
        const agent = {
            model: { provider: faux.provider.id, modelId: faux.getModel().id },
            thinkingLevel: "off" as const,
            instructions: definition.instructions,
        };
        const root = await harness.root(BACKGROUND_CONTEXT, { agent });
        await root.configure(agent, BACKGROUND_CONTEXT);
        const submitted = await root.submit(
            { type: "input", content: PI_MISSION_INPUT, requestId: "profile" },
            BACKGROUND_CONTEXT,
        );
        await submitted.wait(BACKGROUND_CONTEXT);
        if (!captured) throw new Error("Native profile transcript unavailable");
        return captured;
    } finally {
        await harness.close(BACKGROUND_CONTEXT);
    }
}

/** Measures the actual installed serializer; both tool execution and network dispatch are forbidden. */
export async function prepareNativeProfiles(
    route: ModelRoute,
    descriptor: Infer<typeof modelDescriptor>,
    signal?: AbortSignal,
) {
    const configured = {
        ...route,
        reasoningEnabled: descriptor.reasoning,
        profileKey: modelConfigurationKey(descriptor),
    };
    const model = configuredNativeModel(route.model, descriptor);
    const provider = openrouterProvider();
    const profiles = new Map<string, number>();
    for (const member of agentDefinitionIdValidator.members)
        for (const version of member.value === "workbench_v1" ? [1, 2] : [1]) {
            const definition = getAgentDefinition(member.value, version);
            const sets = definition.nativeToolSets?.(definition.operations) ?? [
                agentToolSchemas(definition),
            ];
            for (const operations of sets) {
                signal?.throwIfAborted();
                const requests = await Promise.all(
                    [
                        ...new Set([
                            route.reasoningEffort,
                            ...(descriptor.reasoningEfforts ?? []),
                        ]),
                    ].map(async (effort) => {
                        const nativeRoute = {
                            ...configured,
                            reasoningEffort: effort,
                        };
                        const key = await piInputProfileKey({
                            instructions: definition.instructions,
                            operations,
                            prompt: "",
                            definitionVersion: definition.version,
                            nativeConversation: definition.nativeConversation,
                            nativeRoute,
                        });
                        return { key, nativeRoute };
                    }),
                );
                const missing = requests.filter(
                    (request) => !profiles.has(request.key),
                );
                if (!missing.length) continue;
                const history = await profileTranscript(definition, operations);
                for (const { key, nativeRoute } of missing) {
                    let bytes: number | undefined;
                    let dispatchAttempted = false;
                    const result = provider.streamSimple(
                        model,
                        normalizeContext({
                            messages: piMissionMessages(
                                definition.instructions,
                                "",
                                history,
                                0,
                                definition.nativeConversation,
                            ),
                        }),
                        {
                            apiKey: "offline-profile-key",
                            maxTokens: MODEL_MAX_OUTPUT_TOKENS,
                            maxRetries: 0,
                            signal,
                            fetch: async () => {
                                dispatchAttempted = true;
                                throw new Error(
                                    "Profile preparation forbids network access",
                                );
                            },
                            onPayload(payload) {
                                if (!payload || typeof payload !== "object")
                                    throw new Error(
                                        "Native profile payload unavailable",
                                    );
                                bytes = new TextEncoder().encode(
                                    preparePiModelPayload(payload, nativeRoute)
                                        .json,
                                ).length;
                                throw new Error(
                                    "Offline preparation completed before dispatch",
                                );
                            },
                        },
                    );
                    await result.result();
                    if (dispatchAttempted || bytes === undefined)
                        throw new Error("Native profile preparation failed");
                    profiles.set(key, bytes);
                }
            }
        }
    return [...profiles].map(([key, bytes]) => ({ key, bytes }));
}
