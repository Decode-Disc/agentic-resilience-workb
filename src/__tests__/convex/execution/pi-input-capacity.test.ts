import { readFileSync, writeFileSync } from "node:fs";
import { api, internal } from "@convex/_generated/api";
import { registeredAgentDefinitions } from "@convex/execution/agentCatalog";
import {
    type AgentDefinition,
    agentToolSchemas,
} from "@convex/execution/agentDefinition";
import {
    PI_MISSION_EXTENSION,
    PI_MISSION_INPUT,
    PI_STATE_SECTION,
    piInputProfileKey,
    piMissionMessages,
    piMissionStateText,
    preparePiModelPayload,
    preparePiSimulationRequest,
    requiredAnalystInput,
} from "@convex/integrations/modelInput";
import {
    type ModelRoute,
    nativeProfileCatalogueRevision,
    SIMULATION_MAX_OUTPUT_TOKENS,
    SIMULATION_MODEL_ROUTE,
    WORKBENCH_MODEL_ROUTE,
} from "@convex/integrations/modelRouting";
import inputProfilesArtifact from "@convex/integrations/piInputProfiles.json";
import { piToolMetadata } from "@convex/integrations/piMission";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import {
    createModels,
    fauxAssistantMessage,
    fauxProvider,
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
import { afterEach, assert, expect, test, vi } from "vitest";
import { seedConversation } from "@/__tests__/setup/agent-harness";
import { nativePiFixtureRoute } from "@/__tests__/setup/pi-native";

afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
});

test("required mission state keeps the newline-delimited journal boundary", () => {
    expect(
        piMissionMessages(
            "Instructions",
            '{"question":"Exact original"}',
            [],
            0,
        ),
    ).toEqual([
        {
            role: "system",
            content:
                'Instructions\n\nRequired current mission state:\n{"question":"Exact original"}',
            timestamp: 0,
        },
    ]);
});

async function minimalTranscript(definition: AgentDefinition) {
    const faux = fauxProvider({
        models: [
            {
                id: "controlled",
                contextWindow: 32000,
                maxTokens: SIMULATION_MAX_OUTPUT_TOKENS,
            },
        ],
    });
    let captured: TranscriptContext["messages"] | undefined;
    faux.setResponses([
        (context) => {
            captured = context.messages;
            return fauxAssistantMessage("Profile capture complete");
        },
    ]);
    const tools = await Promise.all(
        Object.entries(agentToolSchemas(definition)).map(
            async ([name, operation]) =>
                defineTool({
                    ...(await piToolMetadata(name, operation)),
                    async execute() {
                        throw new Error(
                            "Profile calibration cannot execute tools",
                        );
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
        if (!captured)
            throw new Error("Pi did not produce the profile transcript");
        return captured;
    } finally {
        await harness.close(BACKGROUND_CONTEXT);
    }
}

async function nativeBytes(
    definition: AgentDefinition,
    history: TranscriptContext["messages"],
    prompt: string,
    route: ModelRoute,
    observe?: (request: string) => void,
) {
    history = history.map((message) =>
        message.role === "system" &&
        message.sections &&
        PI_STATE_SECTION in message.sections
            ? {
                  ...message,
                  sections: {
                      ...message.sections,
                      [PI_STATE_SECTION]: piMissionStateText(
                          definition.instructions,
                          prompt,
                          definition.nativeConversation,
                          definition.contextRendering,
                      ),
                  },
              }
            : message,
    );
    if (definition.nativeConversation && prompt)
        history = history.map((message) =>
            message.role === "user"
                ? { ...message, content: requiredAnalystInput(prompt) }
                : message,
        );
    if (
        route.model === SIMULATION_MODEL_ROUTE.model &&
        route.provider === SIMULATION_MODEL_ROUTE.provider
    )
        return new TextEncoder().encode(
            preparePiSimulationRequest(history).json,
        ).length;
    const provider = openrouterProvider();
    const model = provider
        .getModels()
        .find((model) => model.id === route.model);
    if (!model)
        throw new Error(
            "Profile route is absent from the pinned native catalog",
        );
    let bytes: number | undefined;
    const network = vi.fn(() => {
        throw new Error("Profile calibration prohibits network I/O");
    });
    const stream = provider.streamSimple(
        model,
        normalizeContext({
            messages: history,
        }),
        {
            apiKey: "offline-profile-key",
            fetch: network,
            maxRetries: 0,
            onPayload(payload) {
                if (!payload || typeof payload !== "object")
                    throw new Error("Invalid profile payload");
                const request = preparePiModelPayload(payload, route).json;
                observe?.(request);
                bytes = new TextEncoder().encode(request).length;
                throw new Error("Payload measured before dispatch");
            },
        },
    );
    await stream.result();
    expect(network).not.toHaveBeenCalled();
    if (bytes === undefined)
        throw new Error("Native serialization did not reach onPayload");
    return bytes;
}

test("native required-input profiles match the installed SDK and escaped JSON without provider I/O", async () => {
    const path = "convex/integrations/piInputProfiles.json";
    const versions = Object.fromEntries(
        ["pi-ai", "pi-durable", "chord"].map((name) => [
            name,
            (
                JSON.parse(
                    readFileSync(
                        `node_modules/@earendil-works/${name}/package.json`,
                        "utf8",
                    ),
                ) as { version: string }
            ).version,
        ]),
    );
    const previousProfiles = process.env.PI_INPUT_PROFILE_BASELINE
        ? JSON.parse(
              readFileSync(process.env.PI_INPUT_PROFILE_BASELINE, "utf8"),
          )
        : inputProfilesArtifact;
    const profiles: Record<string, number> = {};
    const samples = [];
    for (const canonical of registeredAgentDefinitions()) {
        const snapshots: unknown[] =
            canonical.id === "sources_v1"
                ? [
                      undefined,
                      { activeWork: {} },
                      {
                          activeWork: {
                              qualificationInputVersion: "observed_v1",
                          },
                      },
                  ]
                : [
                      undefined,
                      {
                          responseControl: {
                              reminder:
                                  "Review the preceding explanation without repeating actions.",
                          },
                      },
                  ];
        if (canonical.nativeConversation)
            for (const framing of [
                null,
                { revision: 1, fixed: false },
                { revision: 1, fixed: true },
            ])
                for (const controlAvailable of [false, true])
                    for (const material of [false, true])
                        for (const single of [false, true])
                            for (const text of [
                                "",
                                "Pause research.",
                                "Resume research.",
                                "Keep the saved program unchanged.",
                            ])
                                for (const secondText of single
                                    ? [""]
                                    : [
                                          "",
                                          "Pause research.",
                                          "Resume research.",
                                          "Keep the saved program unchanged.",
                                      ])
                                    snapshots.push({
                                        framing,
                                        research: { controlAvailable },
                                        availableMaterials: material
                                            ? [{}]
                                            : [],
                                        conversationInstructions: {
                                            messages: single
                                                ? [{ messageId: "one", text }]
                                                : [
                                                      {
                                                          messageId: "one",
                                                          text,
                                                      },
                                                      {
                                                          messageId: "two",
                                                          text: secondText,
                                                      },
                                                  ],
                                        },
                                    });
        if (canonical.id === "workbench_v1")
            for (const controlAvailable of [false, true])
                for (const material of [false, true])
                    for (const fixed of [false, true])
                        for (const prepared of [false, true])
                            for (const single of [false, true])
                                snapshots.push({
                                    framing: fixed
                                        ? { revision: 1, fixed: true }
                                        : null,
                                    modernSources: true,
                                    research: { controlAvailable },
                                    availableMaterials: material ? [{}] : [],
                                    documentaryPreparation: prepared
                                        ? { settledNeedIds: ["fixture"] }
                                        : null,
                                    conversationInstructions: {
                                        messages: single
                                            ? [{ messageId: "one", text: "" }]
                                            : [],
                                    },
                                });
        const seen = new Set<string>();
        for (const snapshot of snapshots) {
            const projected = agentToolSchemas(canonical, snapshot);
            const signature = JSON.stringify(projected);
            if (seen.has(signature)) continue;
            seen.add(signature);
            const definition = {
                ...canonical,
                modelOperation: undefined,
                operations: Object.fromEntries(
                    Object.entries(projected).map(([name, schema]) => {
                        const operation = canonical.operations[name];
                        assert(operation);
                        return [name, { ...operation, ...schema }];
                    }),
                ),
            };
            const history = await minimalTranscript(definition);
            const routes = [
                SIMULATION_MODEL_ROUTE,
                nativePiFixtureRoute,
                ...(canonical.id === "workbench_v1"
                    ? [WORKBENCH_MODEL_ROUTE]
                    : []),
            ];
            for (const route of routes) {
                if (!route) continue;
                const input = {
                    instructions: definition.instructions,
                    operations: agentToolSchemas(definition),
                    definitionVersion: definition.version,
                    nativeRoute: route,
                    nativeConversation: canonical.nativeConversation,
                    contextRendering: canonical.contextRendering,
                };
                const overhead = await nativeBytes(
                    definition,
                    history,
                    "",
                    route,
                );
                profiles[await piInputProfileKey({ ...input, prompt: "" })] =
                    overhead;
                for (const text of [
                    "plain ASCII",
                    'quoted "text" and \\ paths',
                    "Économie 日本語 🧭",
                    "x".repeat(64000),
                ]) {
                    const prompt = JSON.stringify(
                        definition.nativeConversation
                            ? {
                                  conversationInstructions: {
                                      messages: [{ text }],
                                  },
                              }
                            : { text },
                    );
                    samples.push({
                        input: { ...input, prompt },
                        actual: await nativeBytes(
                            definition,
                            history,
                            prompt,
                            route,
                        ),
                    });
                }
            }
        }
    }
    const expected = {
        profileCatalog: nativeProfileCatalogueRevision(
            previousProfiles,
            profiles,
        ),
        generatedBy:
            "UPDATE_PI_INPUT_PROFILES=1 pnpm exec vitest run src/__tests__/convex/execution/pi-input-capacity.test.ts --maxWorkers=1",
        versions,
        profiles,
    };
    if (process.env.UPDATE_PI_INPUT_PROFILES === "1") {
        writeFileSync(path, `${JSON.stringify(expected, null, 4)}\n`);
        Object.assign(inputProfilesArtifact, expected);
    }
    expect(JSON.parse(readFileSync(path, "utf8"))).toEqual(expected);
    const { agentInputByteLength } = await import(
        "@convex/integrations/modelInput"
    );
    for (const sample of samples)
        expect(
            await agentInputByteLength(sample.input),
            JSON.stringify({
                route: sample.input.nativeRoute,
                version: sample.input.definitionVersion,
                nativeConversation: sample.input.nativeConversation,
            }),
        ).toBe(sample.actual);
    const sample = samples[0];
    if (!sample) throw new Error("No native profile samples were generated");
    await expect(
        agentInputByteLength({
            ...sample.input,
            instructions: "Changed required instructions",
        }),
    ).rejects.toThrow("model_input_profile_unavailable");
}, 30000);

test("native FIFO admission uses model context rather than the former 128 KiB envelope cap", async () => {
    const network = vi.fn(() => {
        throw new Error("Unexpected external I/O");
    });
    vi.stubGlobal("fetch", network);
    vi.useFakeTimers();
    const f = await seedConversation(true);
    for (const [key, length] of [
        ["first", 64000],
        ["second", 63800],
    ] as const)
        await f.client.mutation(api.execution.conversations.submit, {
            runId: f.runId,
            requestKey: key,
            delivery: "queue",
            text: "x".repeat(length),
        });
    const started = await f.t.mutation(
        internal.execution.conversations.startTurn,
        {
            runId: f.runId,
            definitionId: "conversation_validation_v1",
            scope: { kind: "conversation_validation_v1" },
            simulation: false,
        },
    );
    if (!started) throw new Error("Expected turn");
    expect(
        await f.client.query(api.execution.conversations.get, {
            runId: f.runId,
        }),
    ).toMatchObject({ queuedCount: 0, activeTurn: { messageCount: 2 } });
    expect(
        await f.t.query(internal.execution.context.build, {
            missionId: started.missionId,
            expectedGeneration: 1,
        }),
    ).toMatchObject({ kind: "ready" });
    expect(await f.t.run((ctx) => ctx.db.get(started.missionId))).toMatchObject(
        { provenance: "live" },
    );
    expect(
        await f.t.run((ctx) => ctx.db.query("providerCalls").collect()),
    ).toEqual([]);
    expect(network).not.toHaveBeenCalled();
}, 30000);

test("the installed native serializer receives stable method once for both execution scopes", async () => {
    for (const definition of registeredAgentDefinitions()) {
        const history = await minimalTranscript(definition);
        let request = "";
        await nativeBytes(
            definition,
            history,
            JSON.stringify({
                domain: { observation: "untrusted source data" },
                conversationInstructions: { messages: [{ text: "Question" }] },
            }),
            WORKBENCH_MODEL_ROUTE,
            (value) => {
                request = value;
            },
        );
        const messages = (
            JSON.parse(request) as {
                input: { messages: { content: string }[] };
            }
        ).input.messages;
        const content = messages.map((message) => message.content).join("\n");
        expect(content.split(definition.instructions).length - 1).toBe(1);
        expect(content).toContain("Required current mission state");
        if (definition.nativeConversation)
            expect(content).not.toContain("Return its domain completion JSON");
    }
});

test("preparing every advertised effort remains within the unchanged native-profile admission limit", async () => {
    const { prepareNativeProfiles } = await import(
        "@convex/integrations/piModelProfiles"
    );
    const { reasoningEffortValues } = await import(
        "@convex/modelConfigurationValues"
    );
    const profiles = await prepareNativeProfiles(
        { ...nativePiFixtureRoute, reasoningEffort: "medium" },
        {
            contextWindow: 131072,
            maxTokens: 8192,
            reasoning: true,
            reasoningEfforts: [...reasoningEffortValues],
            structuredOutputs: true,
            inputPrice: 0.01,
            outputPrice: 0.02,
            cacheReadPrice: 0,
        },
    );
    expect(profiles.length).toBeLessThanOrEqual(512);
}, 60000);

test.each([
    "max_tokens",
    "max_completion_tokens",
] as const)("native preparation exposes the effective %s cap independently of its wire representation", (field) => {
    const prepared = preparePiModelPayload(
        { [field]: 12000 },
        {
            ...WORKBENCH_MODEL_ROUTE,
            descriptor: {
                contextWindow: 131072,
                maxTokens: 8192,
                inputPrice: 0.03,
                outputPrice: 0.1,
                cacheReadPrice: 0.01,
                reasoning: false,
                structuredOutputs: true,
            },
        },
    );
    expect(prepared).toMatchObject({
        payload: { [field]: 8192 },
        effectiveMaxOutputTokens: 8192,
    });
    expect(preparePiSimulationRequest([])).toMatchObject({
        effectiveMaxOutputTokens: 6144,
    });
});
