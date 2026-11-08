"use node";

import { internal } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import type { ActionCtx } from "@convex/_generated/server";
import { sha256Hex } from "@convex/domain/sourcePassages";
import { getAgentDefinition } from "@convex/execution/agentCatalog";
import {
    agentToolSchemas,
    modelOperationOutcome,
} from "@convex/execution/agentDefinition";
import { executionError, executionFailureCode } from "@convex/execution/errors";
import type { AgentGenerationBackend } from "@convex/execution/executionProtocol";
import { invokeControlledGeneration } from "@convex/execution/invokeAgentModel";
import { revisionRoute } from "@convex/modelConfiguration";
import { PI_LEASE_RENEW_INTERVAL_MS } from "@convex/resourceLimits";
import {
    BACKGROUND_CONTEXT,
    withAbortSignal,
} from "@earendil-works/chord/context";
import {
    type AssistantMessage,
    createAssistantMessageEventStream,
    createModels,
    fauxAssistantMessage,
    fauxProvider,
    fauxText,
    fauxToolCall,
    type Model,
    type Provider,
    type SimpleStreamOptions,
    type TranscriptContext,
} from "@earendil-works/pi-ai";
import { openrouterProvider } from "@earendil-works/pi-ai/providers/openrouter";
import { isContextOverflow } from "@earendil-works/pi-ai/utils/overflow";
import {
    getCurrentTools,
    toToolDeclaration,
} from "@earendil-works/pi-ai/utils/transcript";
import {
    AssistantEntry,
    type Conversation,
    createRegistry,
    defineExtension,
    defineTask,
    defineTool,
    GenerationTask,
    Harness,
    hook,
    type Wake,
} from "@earendil-works/pi-durable";
import {
    modelToolSetKey,
    PI_MISSION_EXTENSION,
    PI_MISSION_INPUT,
    PI_STATE_SECTION,
    piMissionMessages,
    piMissionStateText,
    piRequiredContextTokens,
    piToolMetadata,
    preparePiModelPayload,
    preparePiSimulationRequest,
} from "./modelInput";
import {
    modelCallSettings,
    NATIVE_MODEL_SERIALIZER,
    SIMULATION_CONTEXT_WINDOW,
    SIMULATION_MODEL_ROUTE,
} from "./modelRouting";
import {
    createBoundedModelFetch,
    generationObservation,
    readReportedCost,
} from "./modelTransport";
import { configuredNativeModel } from "./piModelProfiles";
import { createNativeInputDelivery } from "./piNativeInput";
import { openMissionPiStorage } from "./piStorage";
import { createPiToolArgumentsCapture } from "./piToolArguments";

export { piToolMetadata } from "./modelInput";

/** Read proof from Pi's immutable request checkpoint, including after the worker's memory is lost. */
function nativePreparation(
    transcript: TranscriptContext,
    instructions: string,
    nativeConversation: boolean | undefined,
    contextRendering: "separated_v1" | undefined,
) {
    const sections = new Map<string, string>();
    for (const message of transcript.messages) {
        if (message.role !== "system") continue;
        for (const [key, value] of Object.entries(message.sections ?? {})) {
            if (value === null) sections.delete(key);
            else sections.set(key, value);
        }
    }
    const retainedInstructions = sections.get("instructions") ?? "";
    const section = sections.get(PI_STATE_SECTION);
    const prefix = piMissionStateText(
        instructions,
        "",
        nativeConversation,
        contextRendering,
    );
    const inputJson = section?.startsWith(prefix)
        ? section.slice(prefix.length)
        : undefined;
    return {
        inputJson,
        inputHash:
            inputJson === undefined
                ? "native_state_unavailable"
                : sha256Hex(inputJson),
        toolSetKey: modelToolSetKey(getCurrentTools(transcript.messages)),
        instructionsHash: sha256Hex(retainedInstructions),
        serializer: NATIVE_MODEL_SERIALIZER,
    };
}

/** Pi owns generation/tool scheduling. Application callbacks retain admission, effects and adoption. */
export async function runPiMission(
    ctx: ActionCtx,
    args: { missionId: Id<"agentMissions">; expectedGeneration: number },
    writer: string,
) {
    const mission = await ctx.runQuery(
        internal.execution.piControl.state,
        args,
    );
    const simulated = mission.provenance === "simulation";
    const configuredModel = await ctx.runQuery(
        internal.modelConfiguration.forMission,
        { missionId: mission._id },
    );
    const route = configuredModel ? revisionRoute(configuredModel) : undefined;
    const generation = modelCallSettings(
        route ?? SIMULATION_MODEL_ROUTE,
    ).generation;
    const terminal = ["completed", "cancelled"].includes(mission.status);
    if (
        !terminal &&
        !simulated &&
        (!route || !process.env.OPENROUTER_API_KEY?.trim())
    )
        throw executionError(
            route ? "missing_configuration" : "missing_authorized_route",
        );
    const definition = getAgentDefinition(
        mission.definitionId,
        mission.definitionVersion,
    );
    const abort = new AbortController();
    const context = withAbortSignal(abort.signal, BACKGROUND_CONTEXT);
    const storage = await openMissionPiStorage(
        ctx,
        args.missionId,
        args.expectedGeneration,
        writer,
        context,
    );
    const faux = fauxProvider({
        models: [
            {
                id: "controlled",
                contextWindow: SIMULATION_CONTEXT_WINDOW,
                maxTokens: generation.maxOutputTokens,
            },
        ],
    });
    const upstream = openrouterProvider();
    const nativeModel = configuredModel
        ? configuredNativeModel(
              configuredModel.model,
              configuredModel.descriptor,
          )
        : undefined;
    const base = simulated
        ? faux.provider
        : nativeModel
          ? {
                ...upstream,
                getModels: () => [nativeModel],
                getAllModels: () => [nativeModel],
            }
          : upstream;
    const model = simulated
        ? faux.getModel()
        : (base.getModels().find((m) => m.id === route?.model) ??
          (terminal ? base.getModels()[0] : undefined));
    if (!model) throw executionError("missing_authorized_route");
    const nativeContextWindow = model.contextWindow;
    const startedAt = Date.now();
    const responseState: {
        responseTooLarge: boolean;
        httpStatus?: number;
        retryAfterAt?: number;
    } = { responseTooLarge: false };
    const nativeFetch = createBoundedModelFetch(
        {
            fetch: async (input, init) => {
                const origin = await ctx.runQuery(
                    internal.execution.fixtures.workbenchRelay,
                    args,
                );
                if (!origin) return fetch(input, init);
                const request = new Request(input, init);
                if (
                    request.url !==
                    "https://openrouter.ai/api/v1/chat/completions"
                )
                    throw executionError("evaluation_dossier_not_authorized");
                request.headers.delete("authorization");
                return fetch(
                    new Request(`${origin}/chat/completions`, request),
                );
            },
        },
        responseState,
    );
    const registry = createRegistry();
    let harness: Harness;
    let root: Conversation;
    let nativeSettled = false;
    let preparationChanges = 0;
    const lastPreparedDelivery = { messages: 0, observations: 0, controls: 0 };
    function changedPreparation() {
        if (++preparationChanges >= 3)
            throw executionError("native_preparation_stalled");
        return fauxAssistantMessage(
            fauxText(
                "The request preparation changed before dispatch. Continue with freshly prepared state, active instructions and tools.",
            ),
        );
    }
    const nativeDelivery = createNativeInputDelivery(ctx, args, storage);
    async function syncInputs() {
        if (definition.nativeConversation)
            await nativeDelivery.synchronize(root, context);
        else await nativeDelivery.synchronizeObservations(root, context);
    }
    let failure: unknown;
    let wake: Wake = { active: true };
    let resumeAt: number | undefined;
    let yieldSleep!: () => void;
    const sleeping = new Promise<void>((resolve) => {
        yieldSleep = resolve;
    });
    const stop = (error: unknown) => {
        failure ??= error;
        abort.abort(error);
    };

    async function dispatchRetainedOperation(
        requestId: Id<"agentOperationRequests">,
    ) {
        await storage.renewLease();
        return ctx.runAction(internal.execution.operations.dispatch, {
            requestId,
            expectedGeneration: args.expectedGeneration,
        });
    }

    const waitOperation = defineTask<
        { requestId: Id<"agentOperationRequests"> },
        { phase: "read" },
        string
    >({
        name: "workbench.operation-result",
        version: 1,
        initial: () => ({ phase: "read" }),
        phases: {
            read: async (task, runtime, taskContext) => {
                const outcome = await dispatchRetainedOperation(
                    task.input.requestId,
                );
                if (outcome.kind === "waiting") {
                    resumeAt = Date.now() + 30_000;
                    yieldSleep();
                    // Graceful close retains the read checkpoint as pending, so a result can resume it before recovery.
                    await new Promise<void>((resolve) => {
                        if (runtime.signal.aborted) resolve();
                        else
                            runtime.signal.addEventListener(
                                "abort",
                                () => resolve(),
                                { once: true },
                            );
                    });
                    return;
                }
                await runtime.commit(
                    () => ({
                        status: "terminal",
                        outcome: {
                            status: "completed",
                            result: modelOperationOutcome(definition, outcome),
                        },
                    }),
                    taskContext,
                );
            },
        },
        abort: (_task, runtime, taskContext) =>
            runtime.commit(
                () => ({ status: "terminal", outcome: { status: "aborted" } }),
                taskContext,
            ),
    });

    async function buildTools(snapshot?: unknown) {
        const projected = agentToolSchemas(definition, snapshot);
        const all = agentToolSchemas(definition);
        return Promise.all(
            Object.entries(definition.operations).map(
                async ([name, operation]) =>
                    defineTool({
                        ...(await piToolMetadata(
                            name,
                            projected[name] ?? all[name] ?? operation,
                        )),
                        async execute(_input, api, toolContext) {
                            try {
                                const request = await ctx.runQuery(
                                    internal.execution.piControl.operation,
                                    { ...args, callId: api.callId },
                                );
                                if (!request)
                                    throw executionError(
                                        "operation_correlation_invalid",
                                    );
                                const outcome = await dispatchRetainedOperation(
                                    request._id,
                                );
                                let text = modelOperationOutcome(
                                    definition,
                                    outcome,
                                );
                                if (outcome.kind === "waiting") {
                                    let taskId = await api.memo<number>(
                                        "wait-task",
                                        toolContext,
                                    );
                                    if (taskId === undefined) {
                                        const id = await api.createTask(
                                            waitOperation,
                                            { requestId: request._id },
                                            {
                                                ownership: {
                                                    kind: "task",
                                                    taskId: api.taskId,
                                                },
                                            },
                                            toolContext,
                                        );
                                        taskId = await api.memo(
                                            "wait-task",
                                            id,
                                            toolContext,
                                        );
                                    }
                                    const result = await api.waitForTask(
                                        taskId as import("@earendil-works/pi-durable").TaskId<string>,
                                        toolContext,
                                    );
                                    if (
                                        result.state.outcome.status !==
                                        "completed"
                                    )
                                        throw executionError(
                                            "continuation_unavailable",
                                        );
                                    text = result.state.outcome.result;
                                }
                                return {
                                    output: [{ type: "text" as const, text }],
                                };
                            } catch (error) {
                                stop(error);
                                throw error;
                            }
                        },
                    }),
            ),
        );
    }
    let tools = await buildTools();
    function installTools() {
        registry.install(
            defineExtension({
                name: PI_MISSION_EXTENSION,
                tools,
                sections: [
                    {
                        key: PI_STATE_SECTION,
                        tag: false,
                        async render(input) {
                            try {
                                const current = await ctx.runQuery(
                                    internal.execution.context.build,
                                    args,
                                );
                                if (current.kind !== "ready")
                                    throw executionError(current.code);
                                const messages = piMissionMessages(
                                    definition.instructions,
                                    current.inputJson,
                                    [],
                                    0,
                                    definition.nativeConversation,
                                    definition.contextRendering,
                                );
                                const section = messages[0];
                                if (
                                    section?.role !== "system" ||
                                    typeof section.content !== "string"
                                )
                                    throw executionError(
                                        "native_state_unavailable",
                                    );
                                if (
                                    piRequiredContextTokens(
                                        input.agent.instructions ?? "",
                                        section.content,
                                        input.agent.tools.map(
                                            toToolDeclaration,
                                        ),
                                    ) >= nativeContextWindow
                                )
                                    throw executionError("context_capacity");
                                return section.content;
                            } catch (error) {
                                stop(error);
                                throw error;
                            }
                        },
                    },
                ],
                tasks: [waitOperation],
                hooks: [
                    hook(GenerationTask, {
                        async afterTools() {
                            await settleRetainedOperations();
                            await syncInputs();
                            await refreshTools();
                        },
                        async onYield() {
                            if (terminal) return undefined;
                            await syncInputs();
                            const state = await ctx.runQuery(
                                internal.execution.piControl.publicationState,
                                args,
                            );
                            if (
                                state.staleInstructions ||
                                preparationChanges > 0 ||
                                (await nativeDelivery.hasPendingObservations())
                            ) {
                                await syncInputs();
                                await refreshTools();
                                return {
                                    continue:
                                        "Required mission context changed. Continue with the current state and active instructions before completing.",
                                };
                            }
                            return undefined;
                        },
                    }),
                ],
            }),
        );
    }
    installTools();
    async function refreshTools() {
        const current = await ctx.runQuery(
            internal.execution.context.build,
            args,
        );
        if (current.kind === "blocked") throw executionError(current.code);
        const snapshot: unknown = JSON.parse(current.inputJson);
        tools = await buildTools(snapshot);
        installTools();
        const offered = new Set(
            Object.keys(agentToolSchemas(definition, snapshot)),
        );
        await root.configure(
            { modelTools: tools.filter((tool) => offered.has(tool.name)) },
            context,
        );
    }

    async function drainRetainedOperations() {
        for (let count = 0; count < 20; count++) {
            const pending = await ctx.runQuery(
                internal.execution.piControl.nextOperation,
                args,
            );
            if (!pending) return;
            const outcome = await dispatchRetainedOperation(pending._id);
            if (outcome.kind === "waiting") {
                resumeAt = Date.now() + 30_000;
                throw executionError("pi_slice_complete");
            }
        }
        if (
            await ctx.runQuery(internal.execution.piControl.nextOperation, args)
        )
            throw executionError("pi_slice_complete");
    }

    async function settleRetainedOperations() {
        await drainRetainedOperations();
        const current = await ctx.runQuery(
            internal.execution.piControl.state,
            args,
        );
        if (!current.lastInvocationId) return;
        const previous = await ctx.runQuery(
            internal.execution.piControl.invocation,
            {
                invocationId: current.lastInvocationId,
                expectedGeneration: args.expectedGeneration,
            },
        );
        if (
            previous.status === "returned" &&
            previous.outputJson &&
            JSON.parse(previous.outputJson).kind === "operations"
        ) {
            const settled = await ctx.runMutation(
                internal.execution.invocations.settle,
                {
                    invocationId: previous._id,
                    expectedGeneration: args.expectedGeneration,
                },
            );
            if (settled.kind !== "ready")
                throw executionError(settled.code ?? "pending_operations");
        }
    }

    async function request(
        model: Model<string>,
        transcript: TranscriptContext,
        options?: SimpleStreamOptions,
    ): Promise<AssistantMessage> {
        if (Date.now() - startedAt > 80_000)
            throw executionError("pi_slice_complete");
        const inspection = await harness.inspect(context);
        const task = inspection.tasks.find(
            (t) =>
                t.state.kind === "running" &&
                (t.record.kind === "pi.generation" ||
                    t.record.kind === "pi.compaction"),
        );
        if (!task) throw executionError("pi_request_task_unavailable");
        const auxiliary = task.record.kind === "pi.compaction";
        const state = task.record.state;
        const checkpoint = "checkpoint" in state ? state.checkpoint : null;
        const attempt =
            checkpoint &&
            typeof checkpoint === "object" &&
            "attempt" in checkpoint
                ? checkpoint.attempt
                : 1;
        const taskKey = `pi:${task.record.id}:${attempt}:${checkpoint && typeof checkpoint === "object" && "cutoff" in checkpoint ? checkpoint.cutoff : "summary"}`;
        const original =
            definition.nativeConversation && storage.sessionId
                ? await ctx.runQuery(
                      internal.execution.piControl.nativeInvocation,
                      { ...args, sessionId: storage.sessionId, taskKey },
                  )
                : null;
        if (
            terminal &&
            original?.status === "returned" &&
            !original.blockCode &&
            original.receivedOutputJson &&
            original.rawOutputJson
        ) {
            const raw = JSON.parse(original.rawOutputJson);
            if (raw.backendOutputJson) return JSON.parse(raw.backendOutputJson);
        }
        if (["completed", "cancelled"].includes(mission.status))
            throw executionError("pi_terminal_dispatch_forbidden");
        if (auxiliary) await drainRetainedOperations();
        else {
            await settleRetainedOperations();
            await syncInputs();
        }
        const prepared = auxiliary
            ? undefined
            : nativePreparation(
                  transcript,
                  definition.instructions,
                  definition.nativeConversation,
                  definition.contextRendering,
              );
        const preparedObservationSequence = prepared
            ? await nativeDelivery.observationProof(root, context, checkpoint)
            : undefined;
        const nativeInput =
            definition.nativeConversation && !auxiliary
                ? await nativeDelivery.proof(
                      root,
                      context,
                      transcript,
                      checkpoint,
                  )
                : undefined;
        if (prepared) {
            const messages = nativeInput?.messageIds.length ?? 0;
            const observations = Math.max(0, preparedObservationSequence ?? 0);
            const controls = Math.max(0, nativeInput?.controlSequence ?? 0);
            // Verified delivery advances preparation without granting domain progress or allowance.
            if (
                messages > lastPreparedDelivery.messages ||
                observations > lastPreparedDelivery.observations ||
                controls > lastPreparedDelivery.controls
            )
                preparationChanges = 0;
            lastPreparedDelivery.messages = Math.max(
                lastPreparedDelivery.messages,
                messages,
            );
            lastPreparedDelivery.observations = Math.max(
                lastPreparedDelivery.observations,
                observations,
            );
            lastPreparedDelivery.controls = Math.max(
                lastPreparedDelivery.controls,
                controls,
            );
        }
        const begun = await ctx.runMutation(
            internal.execution.invocations.begin,
            {
                ...args,
                taskKey,
                ...(prepared
                    ? {
                          preparedInputHash: prepared.inputHash,
                          preparedToolSetKey: prepared.toolSetKey,
                          preparedInstructionsHash: prepared.instructionsHash,
                          preparedSerializer: prepared.serializer,
                          preparedObservationSequence,
                      }
                    : {}),
                ...(definition.nativeConversation
                    ? {
                          piSessionId: storage.sessionId,
                          ...(!auxiliary
                              ? {
                                    nativeInput,
                                }
                              : {}),
                      }
                    : {}),
                provenance: simulated ? "simulation" : "live",
                ...(auxiliary ? { purpose: "compaction" as const } : {}),
            },
        );
        if (begun.kind !== "ready") {
            if (begun.code === "native_input_changed")
                return changedPreparation();
            throw executionError(begun.code);
        }
        preparationChanges = 0;
        const invocationArgs = {
            invocationId: begun.invocationId,
            expectedGeneration: args.expectedGeneration,
        };
        const retained = await ctx.runQuery(
            internal.execution.piControl.invocation,
            invocationArgs,
        );
        if (
            !auxiliary &&
            !retained.receivedOutputJson &&
            !retained.providerCallId &&
            (!retained.nativePreparation ||
                prepared?.inputJson !== begun.inputJson ||
                prepared.toolSetKey !== retained.nativePreparation.toolSetKey ||
                prepared.instructionsHash !==
                    retained.nativePreparation.instructionsHash)
        ) {
            await ctx.runMutation(internal.execution.invocations.retainOutput, {
                ...invocationArgs,
                responseJson: JSON.stringify({
                    kind: "blocked",
                    code: "native_input_changed",
                }),
            });
            await ctx.runMutation(
                internal.execution.piControl.retireForRepreparation,
                invocationArgs,
            );
            return changedPreparation();
        }
        let message: AssistantMessage | undefined;
        if (retained.receivedOutputJson) {
            const response = JSON.parse(retained.receivedOutputJson);
            if (
                response.kind === "blocked" &&
                response.code === "native_input_changed" &&
                retained.blockCode === "native_input_changed"
            )
                return changedPreparation();
            if (
                response.kind === "blocked" &&
                response.code !== "context_capacity"
            )
                throw executionError(response.code);
            const raw = retained.rawOutputJson
                ? JSON.parse(retained.rawOutputJson)
                : null;
            message = raw?.backendOutputJson
                ? JSON.parse(raw.backendOutputJson)
                : undefined;
            if (!message) throw executionError("retained_response_invalid");
        } else {
            // Task identity is stable on reopen; a changed context never admits a second unknown attempt.
            if (retained.providerCallId)
                throw executionError("attempt_outcome_unknown");
            const native: AgentGenerationBackend = {
                id: "pi-durable",
                version: 1,
                async generate(_input, lifecycle) {
                    const reject = async (code: string) => {
                        message = fauxAssistantMessage([], {
                            stopReason: "error",
                            errorMessage:
                                code === "context_capacity"
                                    ? "maximum context length exceeded"
                                    : "model_request_failed",
                        });
                        const result = {
                            status: "failed" as const,
                            errorCode: code,
                            retryable: false,
                            dispatchOutcome: "not_dispatched" as const,
                            model: model.id,
                            provider: base.id,
                            latencyMs: 0,
                            backendOutputJson: JSON.stringify(message),
                            httpStatus: responseState.httpStatus,
                            retryAfterAt: responseState.retryAfterAt,
                        };
                        await lifecycle.observe(result);
                        return result;
                    };
                    const expandedMessages = auxiliary
                        ? definition.compactionInstructions
                            ? [
                                  {
                                      role: "system" as const,
                                      content:
                                          definition.compactionInstructions,
                                      timestamp: Date.now(),
                                  },
                                  ...transcript.messages,
                              ]
                            : transcript.messages
                        : transcript.messages;
                    const simulationRequest = simulated
                        ? preparePiSimulationRequest(expandedMessages)
                        : undefined;
                    const messages =
                        simulationRequest?.messages ?? expandedMessages;
                    if (simulationRequest) {
                        await storage.renewLease();
                        await lifecycle.beforeDispatch(simulationRequest.json, {
                            effectiveMaxOutputTokens:
                                simulationRequest.effectiveMaxOutputTokens,
                        });
                        const response = auxiliary
                            ? undefined
                            : await ctx.runQuery(
                                  internal.execution.simulation.invoke,
                                  invocationArgs,
                              );
                        if (
                            definition.nativeConversation &&
                            response?.kind === "blocked"
                        )
                            return reject(response.code);
                        faux.appendResponses([
                            response?.kind === "operations"
                                ? fauxAssistantMessage(
                                      response.requests.map((r) =>
                                          fauxToolCall(
                                              r.name,
                                              JSON.parse(r.inputJson),
                                              { id: r.callId },
                                          ),
                                      ),
                                      { stopReason: "toolUse" },
                                  )
                                : fauxAssistantMessage(
                                      fauxText(
                                          auxiliary
                                              ? "Working summary only. Retrieve exact prior entries; required state is supplied separately."
                                              : definition.textCompletion &&
                                                  response?.kind ===
                                                      "complete" &&
                                                  "text" in response
                                                ? response.text
                                                : JSON.stringify(response),
                                      ),
                                  ),
                        ]);
                    }
                    let preparationCode: string | undefined;
                    let upstreamProvider: string | undefined;
                    let reportedCost: number | undefined;
                    let generationId: string | undefined;
                    const argumentCapture = createPiToolArgumentsCapture(
                        model.api,
                    );
                    responseState.httpStatus = undefined;
                    responseState.responseTooLarge = false;
                    const stream = base.streamSimple(
                        model,
                        { ...transcript, messages },
                        {
                            ...options,
                            fetch: nativeFetch,
                            apiKey: simulated
                                ? "local-fixture"
                                : process.env.OPENROUTER_API_KEY,
                            maxRetries: generation.maxRetries,
                            maxTokens:
                                options?.maxTokens === undefined
                                    ? undefined
                                    : Math.min(
                                          options.maxTokens,
                                          model.maxTokens,
                                      ),
                            temperature: generation.temperature,
                            timeoutMs: generation.timeout,
                            signal: AbortSignal.any([
                                abort.signal,
                                ...(lifecycle.signal ? [lifecycle.signal] : []),
                                AbortSignal.timeout(generation.timeout),
                            ]),
                            onProviderStreamEvent: async (data, eventModel) => {
                                argumentCapture.observe(data);
                                await options?.onProviderStreamEvent?.(
                                    data,
                                    eventModel,
                                );
                                if (!data || typeof data !== "object") return;
                                if (
                                    "id" in data &&
                                    typeof data.id === "string" &&
                                    data.id !== generationId
                                ) {
                                    await lifecycle.observeProvider?.({
                                        generationId: data.id,
                                        httpStatus: responseState.httpStatus,
                                    });
                                    generationId = data.id;
                                }
                                if (
                                    "provider" in data &&
                                    typeof data.provider === "string" &&
                                    data.provider.length > 0
                                )
                                    upstreamProvider = data.provider;
                                if ("usage" in data)
                                    reportedCost =
                                        readReportedCost(data.usage) ??
                                        reportedCost;
                            },
                            onPayload: async (payload) => {
                                if (!payload || typeof payload !== "object")
                                    throw executionError(
                                        "invalid_model_request",
                                    );
                                if (!route)
                                    throw executionError(
                                        "missing_authorized_route",
                                    );
                                const prepared = preparePiModelPayload(
                                    payload,
                                    route,
                                );
                                try {
                                    const json = prepared.json;
                                    await storage.renewLease();
                                    await lifecycle.beforeDispatch(json, {
                                        effectiveMaxOutputTokens:
                                            prepared.effectiveMaxOutputTokens,
                                    });
                                } catch (error) {
                                    preparationCode =
                                        executionFailureCode(error) ??
                                        "model_request_refused";
                                    throw error;
                                }
                                return prepared.payload;
                            },
                        },
                    );
                    const received = await stream.result();
                    if (preparationCode) return reject(preparationCode);
                    const toolArguments = new Map(
                        received.content.flatMap((c) =>
                            !simulated && c.type === "toolCall"
                                ? [
                                      [
                                          c.id,
                                          argumentCapture.forCall(c.id),
                                      ] as const,
                                  ]
                                : [],
                        ),
                    );
                    message = {
                        role: "assistant",
                        api: received.api,
                        model: received.model,
                        ...(received.responseModel
                            ? { responseModel: received.responseModel }
                            : {}),
                        provider: received.provider,
                        timestamp: received.timestamp,
                        usage: received.usage,
                        stopReason: received.stopReason,
                        ...(received.rawStopReason
                            ? { rawStopReason: received.rawStopReason }
                            : {}),
                        content: received.content.flatMap<
                            AssistantMessage["content"][number]
                        >((c) => {
                            if (c.type === "text")
                                return [{ type: "text", text: c.text }];
                            if (c.type !== "toolCall") return [];
                            const argumentsError =
                                toolArguments.get(c.id)?.argumentsError ??
                                c.argumentsError;
                            return [
                                {
                                    type: "toolCall",
                                    id: c.id,
                                    name: c.name,
                                    arguments: c.arguments,
                                    ...(argumentsError
                                        ? { argumentsError }
                                        : {}),
                                    ...(c.namespace
                                        ? { namespace: c.namespace }
                                        : {}),
                                },
                            ];
                        }),
                        ...(received.stopReason === "error"
                            ? {
                                  errorMessage: isContextOverflow(received)
                                      ? "maximum context length exceeded"
                                      : "model_request_failed",
                              }
                            : {}),
                    };
                    if (
                        (message.stopReason === "error" ||
                            message.stopReason === "aborted") &&
                        !received.rawStopReason &&
                        !(
                            responseState.httpStatus !== undefined &&
                            responseState.httpStatus >= 400
                        )
                    ) {
                        const error = executionError("attempt_outcome_unknown");
                        stop(error);
                        throw error;
                    }
                    const validateOriginalArguments =
                        definition.nativeConversation &&
                        toolArguments.size > 0 &&
                        [...toolArguments.values()].every(
                            (call) => call.rawArguments !== null,
                        );
                    let observation = generationObservation(
                        {
                            model: message.model,
                            resolvedModel: received.responseModel,
                            provider: upstreamProvider,
                            reportedCost,
                            inputTokens:
                                message.usage.input +
                                message.usage.cacheRead +
                                message.usage.cacheWrite,
                            cachedInputTokens: message.usage.cacheRead,
                            outputTokens: message.usage.output,
                            reasoningTokens: message.usage.reasoning,
                            latencyMs: received.durationMs ?? 0,
                            dispatchOutcome: "response_received",
                            httpStatus: responseState.httpStatus,
                            retryAfterAt: responseState.retryAfterAt,
                            observableReplyJson: [
                                ...toolArguments.values(),
                            ].every((call) => call.rawArguments !== null)
                                ? JSON.stringify({
                                      ...message,
                                      content: message.content.map((c) =>
                                          c.type === "toolCall"
                                              ? {
                                                    ...c,
                                                    ...toolArguments.get(c.id),
                                                }
                                              : c,
                                      ),
                                  })
                                : undefined,
                            backendOutputJson: JSON.stringify(message),
                        },
                        {
                            argumentsError: validateOriginalArguments
                                ? undefined
                                : message.content
                                      .flatMap((c) =>
                                          c.type === "toolCall" &&
                                          c.argumentsError
                                              ? [c.argumentsError]
                                              : [],
                                      )
                                      .join("\n") || undefined,
                            finishReason:
                                message.stopReason === "toolUse"
                                    ? "tool-calls"
                                    : message.stopReason === "error" ||
                                        message.stopReason === "aborted"
                                      ? (received.rawStopReason ??
                                        message.stopReason)
                                      : message.stopReason,
                            assistantOutput: message.content
                                .flatMap((c) =>
                                    c.type === "text" ? [c.text] : [],
                                )
                                .join(""),
                            requests: message.content.flatMap((c) => {
                                if (c.type !== "toolCall") return [];
                                let inputJson = JSON.stringify(c.arguments);
                                if (validateOriginalArguments) {
                                    const original = toolArguments.get(
                                        c.id,
                                    )?.rawArguments;
                                    if (typeof original !== "string")
                                        throw executionError(
                                            "native_tool_arguments_unavailable",
                                        );
                                    inputJson = original;
                                }
                                return [
                                    { callId: c.id, name: c.name, inputJson },
                                ];
                            }),
                        },
                    );
                    if (
                        observation.status === "failed" &&
                        observation.dispatchOutcome === "response_received" &&
                        !preparationCode &&
                        isContextOverflow(received)
                    )
                        observation = {
                            ...observation,
                            errorCode: "context_capacity",
                            retryable: false,
                        };
                    await lifecycle.observe(observation);
                    return observation;
                },
            };
            const reply = await invokeControlledGeneration(
                ctx,
                invocationArgs,
                native,
            );
            if (
                !message &&
                reply.response.kind === "blocked" &&
                reply.response.code === "stale_instructions"
            )
                message = fauxAssistantMessage([]);
            if (!message)
                throw executionError(
                    reply.response.kind === "blocked"
                        ? reply.response.code
                        : "retained_response_invalid",
                );
        }
        await drainRetainedOperations();
        const current = await ctx.runQuery(
            internal.execution.piControl.invocation,
            invocationArgs,
        );
        if (!current.receivedOutputJson || !message)
            throw executionError("retained_response_invalid");
        const currentResponse = JSON.parse(current.receivedOutputJson);
        const refusalCode = currentResponse.code;
        if (
            ["context_capacity", "native_input_changed"].includes(
                refusalCode,
            ) &&
            message.stopReason === "error"
        ) {
            await ctx.runMutation(
                internal.execution.piControl.retireForRepreparation,
                invocationArgs,
            );
            if (refusalCode === "native_input_changed") {
                return changedPreparation();
            }
            return message;
        }
        if (auxiliary) {
            await ctx.runMutation(
                internal.execution.piControl.finishAuxiliary,
                invocationArgs,
            );
        } else {
            const adopted = await ctx.runMutation(
                internal.execution.invocations.finish,
                {
                    ...invocationArgs,
                    response: currentResponse,
                    ...(current.rawOutputJson
                        ? { rawOutputJson: current.rawOutputJson }
                        : {}),
                },
            );
            if (adopted.kind === "blocked") {
                if (adopted.code === "pending_operations")
                    throw executionError("pi_slice_complete");
                if (
                    adopted.code === "completion_correction_required" &&
                    "correction" in adopted &&
                    adopted.correction
                ) {
                    preparationChanges++;
                    return {
                        ...message,
                        content: [
                            ...message.content,
                            fauxText(
                                `The preceding completion was refused. Correct the proposal using current required state: ${JSON.stringify(adopted.correction)}`,
                            ),
                        ],
                    };
                }
                if (adopted.code === "mission_context_changed") {
                    preparationChanges++;
                    return fauxAssistantMessage(
                        fauxText(
                            "The preceding completion was not adopted because required mission context changed.",
                        ),
                    );
                }
                if (adopted.code === "stale_instructions")
                    return fauxAssistantMessage(
                        fauxText(
                            "The preceding proposal was not adopted because the analyst updated the active instructions.",
                        ),
                    );
                throw executionError(
                    adopted.code ?? "continuation_unavailable",
                );
            }
        }
        return message;
    }

    function guarded(
        model: Model<string>,
        transcript: TranscriptContext,
        options?: SimpleStreamOptions,
    ) {
        const stream = createAssistantMessageEventStream();
        void request(model, transcript, options).then(
            (message) => stream.end(message),
            (error) => {
                stop(error);
                stream.end(
                    fauxAssistantMessage([], {
                        stopReason: "error",
                        errorMessage: "execution_interrupted",
                    }),
                );
            },
        );
        return stream;
    }
    const provider: Provider = {
        ...base,
        streamSimple: guarded,
        stream: (m, t, o) => {
            const toolChoice =
                o && "toolChoice" in o ? o.toolChoice : undefined;
            if (
                toolChoice !== undefined &&
                toolChoice !== "auto" &&
                toolChoice !== "none"
            )
                throw executionError("unsupported_native_tool_choice");
            return guarded(m, t, {
                ...o,
                toolChoice,
                maxRetries: generation.maxRetries,
            });
        },
    };
    const models = createModels();
    models.setProvider(provider);
    harness = await Harness.open(
        storage,
        {
            models,
            registry,
            settings: {
                toolExecution: "sequential",
                retry: { enabled: false, maxRetries: 0 },
                stream: {
                    maxRetries: generation.maxRetries,
                    timeoutMs: generation.timeout,
                },
                compaction: {
                    enabled: true,
                    backgroundTokens: 0,
                },
            },
            onWake(value) {
                wake = value;
                if (value.at !== undefined && value.at > Date.now()) {
                    resumeAt = value.at;
                    yieldSleep();
                }
            },
            onReport(error) {
                stop(error);
            },
        },
        context,
    );
    const heartbeat = setInterval(() => {
        void storage.renewLease().catch(stop);
    }, PI_LEASE_RENEW_INTERVAL_MS);
    try {
        if (!terminal) {
            try {
                await settleRetainedOperations();
            } catch (error) {
                stop(error);
                throw error;
            }
        }
        root = await harness.root(context, {
            agent: {
                model: { provider: base.id, modelId: model.id },
                thinkingLevel: "off",
                instructions: definition.instructions,
            },
        });
        if (!terminal)
            await root.configure(
                {
                    model: { provider: base.id, modelId: model.id },
                    thinkingLevel: "off",
                    instructions: definition.instructions,
                },
                context,
            );
        if (mission.status === "cancelled") {
            await root.abort(context);
            nativeSettled = true;
            return;
        }
        if (!terminal) await refreshTools();
        await syncInputs();
        const submission = definition.nativeConversation
            ? undefined
            : await root.submit(
                  {
                      type: "input",
                      content: PI_MISSION_INPUT,
                      requestId: `mission:${mission._id}`,
                  },
                  context,
              );
        await Promise.race([root.waitForIdle(context), sleeping]);
        if (
            resumeAt !== undefined ||
            (wake.at !== undefined && wake.at > Date.now())
        ) {
            failure = executionError("pi_slice_complete");
            abort.abort(failure);
            return;
        }
        const settled = submission
            ? await submission.wait(context)
            : { status: "done" as const };
        if (definition.nativeConversation && !failure) {
            const publication = await ctx.runQuery(
                internal.execution.piControl.publicationState,
                args,
            );
            if (
                publication.completed &&
                publication.publishedText !== undefined
            ) {
                const entries = await root.entries(
                    { order: "descending" },
                    32,
                    undefined,
                    context,
                );
                const original = entries.items.find(
                    (entry) =>
                        AssistantEntry.is(entry) &&
                        entry.model?.some(
                            (message) =>
                                message.role === "assistant" &&
                                message.stopReason === "stop",
                        ),
                );
                const answer = original?.model?.find(
                    (message) => message.role === "assistant",
                );
                if (!original || !answer || answer.role !== "assistant")
                    throw executionError("publication_context_unavailable");
                const text = answer.content
                    .flatMap((content) =>
                        content.type === "text" ? [content.text] : [],
                    )
                    .join("");
                if (text !== publication.publishedText) {
                    const edited = await root.submit(
                        {
                            type: "write",
                            requestId: `publication:${mission.conversationTurnId}`,
                            entry: {
                                kind: "workbench.published-response",
                                data: { missionId: mission._id },
                                edits: [
                                    {
                                        target: original.id,
                                        action: "replace",
                                        messages: [
                                            {
                                                ...answer,
                                                content: [
                                                    {
                                                        type: "text",
                                                        text: publication.publishedText,
                                                    },
                                                ],
                                            },
                                        ],
                                    },
                                ],
                            },
                        },
                        context,
                    );
                    await edited.wait(context);
                }
            }
        }
        if (definition.nativeConversation && !failure)
            await nativeDelivery.synchronizeControls(root, context);
        nativeSettled =
            !failure && (await harness.inspect(context)).tasks.length === 0;
        if (settled.status !== "done") {
            const current = await ctx.runQuery(
                internal.execution.piControl.state,
                args,
            );
            const last = current.lastInvocationId
                ? await ctx.runQuery(internal.execution.piControl.invocation, {
                      invocationId: current.lastInvocationId,
                      expectedGeneration: args.expectedGeneration,
                  })
                : null;
            const response = last?.receivedOutputJson
                ? JSON.parse(last.receivedOutputJson)
                : null;
            throw executionError(
                response?.kind === "blocked"
                    ? response.code
                    : settled.status === "unanswered" &&
                        settled.reason === "no_model"
                      ? "missing_authorized_route"
                      : "execution_interrupted",
            );
        }
        if (failure && executionFailureCode(failure) !== "pi_slice_complete")
            throw failure;
    } catch (error) {
        if (failure && executionFailureCode(failure) === "pi_slice_complete")
            return;
        throw failure ?? error;
    } finally {
        clearInterval(heartbeat);
        const nextWake = wake;
        await harness.close(BACKGROUND_CONTEXT);
        await ctx.runMutation(internal.execution.piControl.closeWorker, {
            ...args,
            writer,
            nativeSettled,
            ...(failure && executionFailureCode(failure) !== "pi_slice_complete"
                ? {
                      error:
                          executionFailureCode(failure) ??
                          "execution_interrupted",
                  }
                : executionFailureCode(failure) === "pi_slice_complete"
                  ? { at: resumeAt ?? Date.now() + 1000 }
                  : nextWake.at !== undefined || nextWake.active
                    ? { at: nextWake.at ?? Date.now() + 1000 }
                    : {}),
        });
    }
}
