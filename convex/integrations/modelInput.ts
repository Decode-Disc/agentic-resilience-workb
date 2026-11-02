import { sha256Hex, stableStringify } from "@convex/domain/sourcePassages";
import { executionError } from "@convex/execution/errors";
import type { AgentOperationDefinition } from "@convex/execution/executionProtocol";
import { type TranscriptContext, Type } from "@earendil-works/pi-ai";
import { asSchema, type JSONSchema7, jsonSchema, type ToolSet, tool } from "ai";
import { convexToZod } from "convex-helpers/server/zod4";
import { z } from "zod";
import {
    MODEL_MAX_OUTPUT_TOKENS,
    type ModelRoute,
    routedModelSettings,
    SIMULATION_MODEL_ROUTE,
} from "./modelRouting";
import inputProfiles from "./piInputProfiles.json";

export const PI_MISSION_EXTENSION = "workbench";
export const PI_MISSION_INPUT =
    "Continue the authorized mission using its current required state. Return its domain completion JSON when its work is complete.";

/** Native execution and offline calibration use the same tool metadata. */
export async function piToolMetadata(
    name: string,
    operation: Pick<AgentOperationDefinition, "description" | "inputValidator">,
) {
    return {
        name,
        description: operation.description,
        replay: "safe" as const,
        executionMode: "sequential" as const,
        parameters: Type.Unsafe<Record<string, unknown>>(
            await asSchema(agentOperationInputSchema(operation)).jsonSchema,
        ),
    };
}

/** Pins the effective model tool declarations independently of object-key order and SDK metadata. */
export function modelToolSetKey(
    tools: readonly {
        name: string;
        description: string;
        parameters: unknown;
    }[],
) {
    const wireTools: unknown = JSON.parse(
        JSON.stringify(
            tools
                .map(({ name, description, parameters }) => {
                    if (
                        !parameters ||
                        typeof parameters !== "object" ||
                        Array.isArray(parameters)
                    )
                        throw executionError("model_tool_schema_invalid");
                    return {
                        name,
                        description,
                        parameters: { ...parameters, "~standard": undefined },
                    };
                })
                .sort((a, b) =>
                    a.name < b.name ? -1 : a.name > b.name ? 1 : 0,
                ),
        ),
    );
    return sha256Hex(stableStringify(wireTools));
}

/** Canonical counterpart of the declarations actually retained in Pi's request transcript. */
export async function agentToolSetKey(
    operations: Record<
        string,
        Pick<AgentOperationDefinition, "description" | "inputValidator">
    >,
) {
    return modelToolSetKey(
        await Promise.all(
            Object.entries(operations).map(async ([name, operation]) => ({
                name,
                description: operation.description,
                parameters: await asSchema(agentOperationInputSchema(operation))
                    .jsonSchema,
            })),
        ),
    );
}

/** One native user entry can carry an admitted FIFO lot; exact message references stay in its manifest. */
export function nativeAnalystInput(
    messages: readonly { text: string }[],
): string {
    return messages.map((message) => message.text).join("\n\n");
}

export function requiredAnalystInput(prompt: string): string {
    const snapshot: {
        conversationInstructions?: { messages: { text: string }[] } | null;
    } = JSON.parse(prompt);
    return nativeAnalystInput(
        snapshot.conversationInstructions?.messages ?? [],
    );
}

/** Keeps required state outside Pi's lossy summary; profile generation uses this exact rendering. */
export function piMissionMessages(
    instructions: string,
    prompt: string,
    history: TranscriptContext["messages"],
    timestamp = Date.now(),
    nativeConversation = false,
): TranscriptContext["messages"] {
    return [
        {
            role: "system",
            content: `${nativeConversation ? "" : `${instructions}\n\n`}Required current mission state:\n${prompt}`,
            timestamp,
        },
        ...history,
    ];
}

/** Simulation has its own complete input envelope; model-irrelevant clock metadata stays in the exact Pi log. */
export function preparePiSimulationRequest(
    messages: TranscriptContext["messages"],
) {
    const normalized = messages.map((message) => ({
        ...message,
        timestamp: 0,
    }));
    return {
        messages: normalized,
        json: JSON.stringify({
            version: 1,
            backend: "pi-durable",
            route: SIMULATION_MODEL_ROUTE,
            messages: normalized,
            settings: {
                maxTokens: MODEL_MAX_OUTPUT_TOKENS,
                maxRetries: 0,
                temperature: 0,
            },
        }),
    };
}

/** Routing and the serialized journal envelope are shared with native preflight calibration. */
export function preparePiModelPayload(payload: object, route: ModelRoute) {
    const prepared = {
        ...payload,
        temperature: 0,
        ...routedModelSettings(route),
    };
    return {
        payload: prepared,
        json: JSON.stringify({
            version: 1,
            backend: "pi-durable",
            input: prepared,
        }),
    };
}

function modelInputSchema<Schema extends z.ZodObject>(
    validator: Schema,
    convexIdPaths: readonly string[] = [],
) {
    const strictValidator = validator.strict();
    type Input = z.output<typeof strictValidator>;
    const createJsonSchema = () => {
        const convertedIdPaths = new Set<string>();
        const schema = z.toJSONSchema(strictValidator, {
            target: "draft-7",
            unrepresentable: "any",
            override: ({ zodSchema, jsonSchema, path }) => {
                if (!(zodSchema instanceof z.ZodCustom)) return;
                const idPath = path.join(".");
                const fieldPath = idPath.replace(/^properties\./, "");
                if (!convexIdPaths.includes(fieldPath))
                    throw new Error(
                        `Unsupported custom model input schema at ${idPath}`,
                    );
                convertedIdPaths.add(fieldPath);
                jsonSchema.type = "string";
            },
        });
        if (
            convertedIdPaths.size !== convexIdPaths.length ||
            convexIdPaths.some((path) => !convertedIdPaths.has(path))
        )
            throw new Error("Canonical Convex ID schema was not converted");
        // Zod declares a cross-draft union; the explicit target above produces draft-7.
        return schema as JSONSchema7;
    };

    return jsonSchema<Input>(createJsonSchema, {
        validate: (value) => {
            const parsed = strictValidator.safeParse(value);
            return parsed.success
                ? { success: true, value: parsed.data }
                : { success: false, error: parsed.error };
        },
    });
}

/** Both generation engines derive model schemas from the canonical operation validator. */
export function agentOperationInputSchema(
    operation: Pick<AgentOperationDefinition, "inputValidator">,
) {
    return modelInputSchema(
        convexToZod(operation.inputValidator),
        Object.entries(operation.inputValidator.fields)
            .filter(([, validator]) => validator.kind === "id")
            .map(([field]) => field),
    );
}

export function createAgentTools(
    operations: Record<
        string,
        Pick<AgentOperationDefinition, "description" | "inputValidator">
    >,
): ToolSet {
    return Object.fromEntries(
        Object.entries(operations).map(([name, operation]) => [
            name,
            tool({
                description: operation.description,
                inputSchema: agentOperationInputSchema(operation),
            }),
        ]),
    );
}

type AgentInput = {
    instructions: string;
    prompt: string;
    operations: Record<
        string,
        Pick<AgentOperationDefinition, "description" | "inputValidator">
    >;
    nativeRoute?: ModelRoute;
    definitionVersion?: number;
    nativeConversation?: boolean;
};

/** Fingerprints every application-owned part of the required native request. SDK versions are checked by calibration. */
export async function piInputProfileKey(args: AgentInput): Promise<string> {
    return sha256Hex(
        stableStringify({
            version: args.definitionVersion,
            ...(args.nativeConversation
                ? { nativeInstructions: args.instructions }
                : {}),
            requiredMessage: piMissionMessages(
                args.instructions,
                "",
                [],
                0,
                args.nativeConversation,
            ),
            tools: await serializedTools(args.operations),
            continuation: PI_MISSION_INPUT,
            extension: PI_MISSION_EXTENSION,
            route: args.nativeRoute
                ? {
                      model: args.nativeRoute.model,
                      provider: args.nativeRoute.provider,
                  }
                : undefined,
            ...(args.nativeRoute?.profileKey
                ? { configuration: args.nativeRoute.profileKey }
                : {}),
            settings: args.nativeRoute
                ? routedModelSettings(args.nativeRoute)
                : null,
            maxTokens: MODEL_MAX_OUTPUT_TOKENS,
            simulationEnvelope:
                args.nativeRoute?.model === SIMULATION_MODEL_ROUTE.model &&
                args.nativeRoute.provider === SIMULATION_MODEL_ROUTE.provider
                    ? preparePiSimulationRequest(
                          piMissionMessages(
                              args.instructions,
                              "",
                              [],
                              0,
                              args.nativeConversation,
                          ),
                      ).json
                    : undefined,
        }),
    );
}

async function serializedTools(operations: AgentInput["operations"]) {
    const tools = await Promise.all(
        Object.entries(createAgentTools(operations)).map(
            async ([name, operation]) => ({
                name,
                description: operation.description,
                inputSchema: await asSchema<unknown>(operation.inputSchema)
                    .jsonSchema,
            }),
        ),
    );
    return tools;
}

/** Native profiles count the exact fixed envelope plus the once-escaped required JSON; other engines keep their canonical input. */
export async function agentInputByteLength(
    args: AgentInput,
    lookupProfile?: (key: string) => Promise<number | undefined>,
): Promise<number> {
    if (args.nativeRoute) {
        const profiles: Record<string, number> = inputProfiles.profiles;
        const key = await piInputProfileKey(args);
        const overhead = args.nativeRoute.profileKey
            ? await lookupProfile?.(key)
            : profiles[key];
        if (overhead === undefined)
            throw executionError("model_input_profile_unavailable");
        return (
            overhead +
            new TextEncoder().encode(JSON.stringify(args.prompt)).length -
            2 +
            (args.nativeConversation
                ? new TextEncoder().encode(
                      JSON.stringify(requiredAnalystInput(args.prompt)),
                  ).length -
                  new TextEncoder().encode(JSON.stringify(PI_MISSION_INPUT))
                      .length
                : 0)
        );
    }
    const tools = await serializedTools(args.operations);
    return new TextEncoder().encode(
        JSON.stringify({
            instructions: args.instructions,
            prompt: args.prompt,
            tools,
        }),
    ).length;
}
