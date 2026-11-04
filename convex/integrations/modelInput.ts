import { sha256Hex, stableStringify } from "@convex/domain/sourcePassages";
import { executionError } from "@convex/execution/errors";
import type { AgentOperationDefinition } from "@convex/execution/executionProtocol";
import { operationResultKey } from "@convex/execution/operationResults";
import { type TranscriptContext, Type } from "@earendil-works/pi-ai";
import { asSchema, type JSONSchema7, jsonSchema, type ToolSet, tool } from "ai";
import { convexToZod } from "convex-helpers/server/zod4";
import { z } from "zod";
import {
    MODEL_MAX_OUTPUT_TOKENS,
    type ModelRoute,
    modelCallSettings,
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
    const generation = modelCallSettings(SIMULATION_MODEL_ROUTE).generation;
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
    const prepared = {
        ...payload,
        temperature: generation.temperature,
        ...request,
        ...("max_completion_tokens" in payload
            ? { max_completion_tokens: generation.maxOutputTokens }
            : {}),
        ...("max_tokens" in payload
            ? { max_tokens: generation.maxOutputTokens }
            : {}),
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
    convexIdPaths: readonly { path: string; table: string }[] = [],
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

/** Both generation engines derive model schemas from the canonical operation validator. */
export function agentOperationInputSchema(
    operation: Pick<AgentOperationDefinition, "inputValidator">,
) {
    return modelInputSchema(
        convexToZod(operation.inputValidator),
        convexIdPaths(operation.inputValidator),
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
        Pick<AgentOperationDefinition, "description" | "inputValidator"> &
            Partial<Pick<AgentOperationDefinition, "resultValidator">> & {
                resultContractKey?: string;
            }
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
                ? modelCallSettings(args.nativeRoute).request
                : null,
            maxTokens: args.nativeRoute
                ? modelCallSettings(args.nativeRoute).generation.maxOutputTokens
                : MODEL_MAX_OUTPUT_TOKENS,
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
