import { sha256Hex, stableStringify } from "@convex/domain/sourcePassages";
import {
    type CompletionTransport,
    MAX_MODEL_OPERATION_OUTPUT_BYTES,
} from "@convex/execution/agentDefinition";
import { executionError } from "@convex/execution/errors";
import type { AgentOperationDefinition } from "@convex/execution/executionProtocol";
import { operationResultKey } from "@convex/execution/operationResults";
import { type TranscriptContext, Type } from "@earendil-works/pi-ai";
import { estimateContextTokens } from "@earendil-works/pi-ai/utils/estimate";
import { asSchema, type JSONSchema7, jsonSchema, type ToolSet, tool } from "ai";
import { convexToZod } from "convex-helpers/server/zod4";
import { z } from "zod";
import {
    type ModelRoute,
    modelCallSettings,
    SIMULATION_MODEL_ROUTE,
} from "./modelRouting";
import inputProfiles from "./piInputProfiles.json";

export const PI_MISSION_EXTENSION = "workbench";
export const PI_MISSION_INPUT =
    "Continue the authorized mission using its current required state. Return its domain completion JSON when its work is complete.";
export const PI_NATIVE_COMPLETION_MISSION_INPUT =
    "Continue the authorized mission using its current required state. Call submit_completion alone when its work is complete.";

export function piMissionInput(completionTransport?: CompletionTransport) {
    return completionTransport === "native_tool"
        ? PI_NATIVE_COMPLETION_MISSION_INPUT
        : PI_MISSION_INPUT;
}

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
        outputLimits: {
            maxBytes: MAX_MODEL_OPERATION_OUTPUT_BYTES,
        },
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
        Pick<AgentOperationDefinition, "description" | "inputValidator"> &
            Partial<Pick<AgentOperationDefinition, "resultValidator">> & {
                resultContractKey?: string;
            }
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

/** Pi's documented default section wrapper is part of the versioned native preparation contract. */
export function piInstructionSection(instructions: string) {
    return `<instructions>\n${instructions}\n</instructions>`;
}

export const PI_STATE_SECTION = "workbench_current_state";

/** Uses Pi's estimator for the non-lossy section, actual declarations and an optional initial analyst lot. */
export function piRequiredContextTokens(
    instructions: string,
    state: string,
    tools: NonNullable<
        Extract<
            TranscriptContext["messages"][number],
            { role: "system" }
        >["toolsAdded"]
    >,
    initialInput?: string,
) {
    return estimateContextTokens([
        {
            role: "system",
            content: piInstructionSection(instructions),
            toolsAdded: tools,
            timestamp: 0,
        },
        { role: "system", content: state, timestamp: 0 },
        ...(initialInput
            ? [{ role: "user" as const, content: initialInput, timestamp: 0 }]
            : []),
    ]).tokens;
}

/** Shared native section rendering for runtime and offline wire calibration. */
export function piMissionStateText(
    instructions: string,
    prompt: string,
    nativeConversation = false,
    contextRendering?: "separated_v1",
) {
    return `${nativeConversation || contextRendering === "separated_v1" ? "" : `${instructions}\n\n`}Required current mission state:\n${prompt}`;
}

/** Keeps required state outside Pi's lossy summary; profile generation uses this exact rendering. */
export function piMissionMessages(
    instructions: string,
    prompt: string,
    history: TranscriptContext["messages"],
    timestamp = Date.now(),
    nativeConversation = false,
    contextRendering?: "separated_v1",
): TranscriptContext["messages"] {
    return [
        {
            role: "system",
            content: piMissionStateText(
                instructions,
                prompt,
                nativeConversation,
                contextRendering,
            ),
            timestamp,
        },
        ...history,
    ];
}

/** Simulation has its own complete input envelope; model-irrelevant clock metadata stays in the exact Pi log. */
export function preparePiSimulationRequest(
    messages: TranscriptContext["messages"],
) {
    const generation = modelCallSettings(SIMULATION_MODEL_ROUTE).generation;
    const normalized = messages.map((message) => ({
        ...message,
        timestamp: 0,
    }));
    return {
        messages: normalized,
        effectiveMaxOutputTokens: generation.maxOutputTokens,
        json: JSON.stringify({
            version: 1,
            backend: "pi-durable",
            route: SIMULATION_MODEL_ROUTE,
            messages: normalized,
            settings: {
                maxTokens: generation.maxOutputTokens,
                maxRetries: generation.maxRetries,
                temperature: generation.temperature,
            },
        }),
    };
}

/** Routing and the serialized journal envelope are shared with native preflight calibration. */
export function preparePiModelPayload(payload: object, route: ModelRoute) {
    const { request, generation } = modelCallSettings(route);
    const outputLimit = route.descriptor?.maxTokens;
    const native = payload as {
        max_tokens?: number;
        max_completion_tokens?: number;
    };
    const prepared = {
        ...payload,
        ...(outputLimit === undefined
            ? {}
            : {
                  ...(native.max_tokens === undefined
                      ? {}
                      : {
                            max_tokens: Math.min(
                                native.max_tokens,
                                outputLimit,
                            ),
                        }),
                  ...(native.max_completion_tokens === undefined
                      ? {}
                      : {
                            max_completion_tokens: Math.min(
                                native.max_completion_tokens,
                                outputLimit,
                            ),
                        }),
              }),
        temperature: generation.temperature,
        ...request,
    };
    return {
        payload: prepared,
        effectiveMaxOutputTokens:
            prepared.max_completion_tokens ?? prepared.max_tokens,
        json: JSON.stringify({
            version: 1,
            backend: "pi-durable",
            input: prepared,
        }),
    };
}

function modelInputSchema<Schema extends z.ZodObject>(
    validator: Schema,
    convexIdPaths: readonly { path: string; table: string }[] = [],
) {
    const strictValidator = validator.strict();
    type Input = z.output<typeof strictValidator>;
    let cachedSchema: JSONSchema7 | undefined;
    const createJsonSchema = () => {
        if (cachedSchema) return cachedSchema;
        const convertedIdPaths = new Set<string>();
        const schema = z.toJSONSchema(strictValidator, {
            target: "draft-7",
            unrepresentable: "any",
            override: ({ zodSchema, jsonSchema, path }) => {
                if (!(zodSchema instanceof z.ZodCustom)) return;
                const idPath = path.join(".");
                const fieldPath = idPath.replace(/^properties\./, "");
                const identity = convexIdPaths.find(
                    (id) => id.path === fieldPath,
                );
                if (!identity)
                    throw new Error(
                        `Unsupported custom model input schema at ${idPath}`,
                    );
                convertedIdPaths.add(fieldPath);
                jsonSchema.type = "string";
                jsonSchema.description = `Id<${identity.table}>: copy an observed identifier of this type; identifiers from other tables are invalid.`;
            },
        });
        if (
            convertedIdPaths.size !== convexIdPaths.length ||
            convexIdPaths.some((id) => !convertedIdPaths.has(id.path))
        )
            throw new Error("Canonical Convex ID schema was not converted");
        // Zod declares a cross-draft union; the explicit target above produces draft-7.
        cachedSchema = schema as JSONSchema7;
        return cachedSchema;
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

/** Walk the canonical validator so nested IDs retain the same narrow conversion as root fields. */
type CanonicalValidator = import("convex/values").Validator<
    unknown,
    "required" | "optional",
    string
>;
function convexIdPaths(
    validator: CanonicalValidator,
    path = "",
): { path: string; table: string }[] {
    if (validator.kind === "id" && "tableName" in validator)
        return [
            {
                path: path.replace(/^properties\./, ""),
                table: String(validator.tableName),
            },
        ];
    if (validator.kind === "object" && "fields" in validator)
        return Object.entries(
            validator.fields as Record<string, CanonicalValidator>,
        ).flatMap(([key, value]) =>
            convexIdPaths(
                value,
                path ? `${path}.properties.${key}` : `properties.${key}`,
            ),
        );
    if (validator.kind === "array" && "element" in validator)
        return convexIdPaths(
            validator.element as CanonicalValidator,
            `${path}.items`,
        );
    if (validator.kind === "union" && "members" in validator)
        return (validator.members as CanonicalValidator[]).flatMap(
            (member, index) => convexIdPaths(member, `${path}.anyOf.${index}`),
        );
    return [];
}

const inputSchemas = new WeakMap<
    AgentOperationDefinition["inputValidator"],
    ReturnType<typeof modelInputSchema>
>();

/** Immutable canonical validators share their converted schema across calibration and both generation engines. */
export function agentOperationInputSchema(
    operation: Pick<AgentOperationDefinition, "inputValidator">,
) {
    let schema = inputSchemas.get(operation.inputValidator);
    if (schema) return schema;
    schema = modelInputSchema(
        convexToZod(operation.inputValidator),
        convexIdPaths(operation.inputValidator),
    );
    inputSchemas.set(operation.inputValidator, schema);
    return schema;
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
        Pick<AgentOperationDefinition, "description" | "inputValidator"> &
            Partial<Pick<AgentOperationDefinition, "resultValidator">> & {
                resultContractKey?: string;
            }
    >;
    nativeRoute?: ModelRoute;
    definitionVersion?: number;
    nativeConversation?: boolean;
    contextRendering?: "separated_v1";
    completionTransport?: CompletionTransport;
};

/** Fingerprints every application-owned part of the required native request. SDK versions are checked by calibration. */
export async function piInputProfileKey(args: AgentInput): Promise<string> {
    return sha256Hex(
        stableStringify({
            version: args.definitionVersion,
            ...(args.contextRendering
                ? {
                      contextRendering: args.contextRendering,
                      rootInstructions: args.instructions,
                  }
                : {}),
            ...(args.nativeConversation
                ? { nativeInstructions: args.instructions }
                : {}),
            ...(args.completionTransport
                ? { completionTransport: args.completionTransport }
                : {}),
            requiredMessage: piMissionMessages(
                args.instructions,
                "",
                [],
                0,
                args.nativeConversation,
                args.contextRendering,
            ),
            tools: await serializedTools(args.operations),
            resultContracts: Object.fromEntries(
                Object.entries(args.operations)
                    .sort(([a], [b]) => a.localeCompare(b))
                    .map(([name, operation]) => [
                        name,
                        operation.resultContractKey ??
                            (operation.resultValidator
                                ? operationResultKey(operation.resultValidator)
                                : null),
                    ]),
            ),
            resultRendering: 2,
            continuation: piMissionInput(args.completionTransport),
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
                ? modelCallSettings(args.nativeRoute).request
                : null,
            nativeOutputPolicy: "model_context_v1",
            maxTokens: args.nativeRoute?.descriptor?.maxTokens ?? null,
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
                              args.contextRendering,
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
            : (profiles[key] ??
              (
                  inputProfiles.retainedProfiles as
                      | Record<string, number>
                      | undefined
              )?.[key]);
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
                  new TextEncoder().encode(
                      JSON.stringify(piMissionInput(args.completionTransport)),
                  ).length
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
