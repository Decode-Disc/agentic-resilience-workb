import { readFileSync, writeFileSync } from "node:fs";
import { api, internal } from "@convex/_generated/api";
import { getAgentDefinition } from "@convex/execution/agentCatalog";
import {
    type AgentDefinition,
    agentToolSchemas,
} from "@convex/execution/agentDefinition";
import { agentDefinitionIdValidator } from "@convex/execution/agentSchemas";
import {
    PI_MISSION_EXTENSION,
    PI_MISSION_INPUT,
    piInputProfileKey,
    piMissionMessages,
    preparePiModelPayload,
    preparePiSimulationRequest,
    requiredAnalystInput,
} from "@convex/integrations/modelInput";
import {
    MODEL_MAX_OUTPUT_TOKENS,
    type ModelRoute,
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
                maxTokens: MODEL_MAX_OUTPUT_TOKENS,
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
) {
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
            preparePiSimulationRequest(
                piMissionMessages(
                    definition.instructions,
                    prompt,
                    history,
                    0,
                    definition.nativeConversation,
                ),
            ).json,
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
            messages: piMissionMessages(
                definition.instructions,
                prompt,
                history,
                0,
                definition.nativeConversation,
            ),
        }),
        {
            apiKey: "offline-profile-key",
            fetch: network,
            maxRetries: 0,
            maxTokens: MODEL_MAX_OUTPUT_TOKENS,
            onPayload(payload) {
                if (!payload || typeof payload !== "object")
                    throw new Error("Invalid profile payload");
                bytes = new TextEncoder().encode(
                    preparePiModelPayload(payload, route).json,
                ).length;
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
    const profiles: Record<string, number> = {};
    const samples = [];
    for (const [id, version] of agentDefinitionIdValidator.members.flatMap<
        [AgentDefinition["id"], number]
    >((member) =>
        member.value === "workbench_v1"
            ? [
                  [member.value, 1],
                  [member.value, 2],
              ]
            : [[member.value, 1]],
    )) {
        const canonical = getAgentDefinition(id, version);
        const snapshots: unknown[] = [undefined];
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
                ...(id === "workbench_v1" ? [WORKBENCH_MODEL_ROUTE] : []),
            ];
            for (const route of routes) {
                if (!route) continue;
                const input = {
                    instructions: definition.instructions,
                    operations: agentToolSchemas(definition),
                    definitionVersion: definition.version,
                    nativeRoute: route,
                    nativeConversation: canonical.nativeConversation,
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

test("native FIFO admission leaves the message queued when its actual required envelope exceeds 128 KiB", async () => {
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
    ).toMatchObject({ queuedCount: 1, activeTurn: { messageCount: 1 } });
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
