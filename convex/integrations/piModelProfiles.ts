"use node";

import { registeredAgentDefinitions } from "@convex/execution/agentCatalog";
import {
    type AgentDefinition,
    agentToolSchemas,
} from "@convex/execution/agentDefinition";
import type {
    modelDescriptor,
    nativeProfile,
} from "@convex/modelConfigurationSchema";
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
    PI_STATE_SECTION,
    piInputProfileKey,
    piMissionStateText,
    piToolMetadata,
    preparePiModelPayload,
} from "./modelInput";
import {
    type ModelRoute,
    modelCallSettings,
    modelConfigurationKey,
    reasoningChoices,
    recommendedReasoningEffort,
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
    descriptor: Infer<typeof modelDescriptor>,
) {
    const faux = fauxProvider({
        models: [
            {
                id: "controlled",
                contextWindow: descriptor.contextWindow,
                maxTokens: descriptor.maxTokens,
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
    registry.install(
        defineExtension({
            name: PI_MISSION_EXTENSION,
            tools,
            sections: [
                {
                    key: PI_STATE_SECTION,
                    tag: false,
                    render: () =>
                        piMissionStateText(
                            definition.instructions,
                            "",
                            definition.nativeConversation,
                            definition.contextRendering,
                        ),
                },
            ],
        }),
    );
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

/** Reuses exact immutable profiles and measures missing keys with the installed serializer; no dispatch or tool execution. */
export async function prepareNativeProfiles(
    route: ModelRoute,
    descriptor: Infer<typeof modelDescriptor>,
    signal?: AbortSignal,
    readProfiles?: (keys: string[]) => Promise<Infer<typeof nativeProfile>[]>,
) {
    const configured = {
        ...route,
        descriptor,
        profileKey: modelConfigurationKey(descriptor),
    };
    const model = configuredNativeModel(route.model, descriptor);
    const provider = openrouterProvider();
    const profiles = new Map<string, number>();
    const plans: {
        definition: AgentDefinition;
        operations: ReturnType<typeof agentToolSchemas>;
        requests: { key: string; nativeRoute: ModelRoute }[];
    }[] = [];
    for (const definition of registeredAgentDefinitions()) {
        const variants = definition.nativeToolSets?.(definition.operations);
        const sets = variants
            ? variants.map((variant) =>
                  agentToolSchemas(definition, undefined, variant),
              )
            : [agentToolSchemas(definition)];
        for (const operations of sets) {
            signal?.throwIfAborted();
            const requests = await Promise.all(
                [
                    ...new Set([
                        route.reasoningEffort,
                        recommendedReasoningEffort(descriptor),
                        ...reasoningChoices(descriptor),
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
                        contextRendering: definition.contextRendering,
                        nativeRoute,
                    });
                    return { key, nativeRoute };
                }),
            );
            plans.push({ definition, operations, requests });
        }
    }
    const keys = [
        ...new Set(
            plans.flatMap((plan) => plan.requests.map(({ key }) => key)),
        ),
    ];
    signal?.throwIfAborted();
    if (readProfiles) {
        for (const profile of await readProfiles(keys)) {
            if (
                !keys.includes(profile.key) ||
                !Number.isSafeInteger(profile.bytes) ||
                profile.bytes < 1
            )
                throw new Error("Invalid retained native profile");
            profiles.set(profile.key, profile.bytes);
        }
    }
    for (const { definition, operations, requests } of plans) {
        signal?.throwIfAborted();
        const missing = requests.filter(
            (request) => !profiles.has(request.key),
        );
        if (!missing.length) continue;
        const history = await profileTranscript(
            definition,
            operations,
            descriptor,
        );
        for (const { key, nativeRoute } of missing) {
            const generation = modelCallSettings(nativeRoute).generation;
            let bytes: number | undefined;
            let dispatchAttempted = false;
            const result = provider.streamSimple(
                model,
                normalizeContext({
                    messages: history,
                }),
                {
                    apiKey: "offline-profile-key",
                    temperature: generation.temperature,
                    maxRetries: generation.maxRetries,
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
                            preparePiModelPayload(payload, nativeRoute).json,
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
    return keys.map((key) => {
        const bytes = profiles.get(key);
        if (bytes === undefined)
            throw new Error("Native profile preparation incomplete");
        return { key, bytes };
    });
}
