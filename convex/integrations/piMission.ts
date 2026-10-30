"use node";

import { internal } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import type { ActionCtx } from "@convex/_generated/server";
import { getAgentDefinition } from "@convex/execution/agentCatalog";
import { executionError, executionFailureCode } from "@convex/execution/errors";
import {
    type AgentGenerationBackend,
    type AgentOperationDefinition,
    MAX_CONTEXT_BYTES,
    MAX_OBSERVABLE_OUTPUT_BYTES,
} from "@convex/execution/executionProtocol";
import { invokeControlledGeneration } from "@convex/execution/invokeAgentModel";
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
    Type,
} from "@earendil-works/pi-ai";
import { openrouterProvider } from "@earendil-works/pi-ai/providers/openrouter";
import {
    createRegistry,
    defineExtension,
    defineTask,
    defineTool,
    GenerationTask,
    Harness,
    hook,
    type Wake,
} from "@earendil-works/pi-durable";
import { asSchema } from "ai";
import {
    PI_MISSION_EXTENSION,
    PI_MISSION_INPUT,
    piMissionMessages,
    preparePiModelPayload,
    preparePiSimulationRequest,
} from "./modelInput";
import {
    MODEL_ATTEMPT_TIMEOUT_MS,
    MODEL_MAX_OUTPUT_TOKENS,
    missionRoutes,
} from "./modelRouting";
import {
    agentOperationInputSchema,
    createBoundedModelFetch,
    generationObservation,
    readReportedCost,
} from "./modelTransport";
import { openMissionPiStorage } from "./piStorage";
import { createPiToolArgumentsCapture } from "./piToolArguments";

/** Canonical schemas and Pi replay policy also own offline native-input calibration. */
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
    const route = missionRoutes[mission.definitionId];
    if (!simulated && (!route || !process.env.OPENROUTER_API_KEY?.trim()))
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
                contextWindow: 32000,
                maxTokens: MODEL_MAX_OUTPUT_TOKENS,
            },
        ],
    });
    const base = simulated ? faux.provider : openrouterProvider();
    const model = simulated
        ? faux.getModel()
        : base.getModels().find((m) => m.id === route?.model);
    if (!model) throw executionError("missing_authorized_route");
    const startedAt = Date.now();
    const responseState: {
        responseTooLarge: boolean;
        httpStatus?: number;
        retryAfterAt?: number;
    } = { responseTooLarge: false };
    const nativeFetch = createBoundedModelFetch({}, responseState);
    const registry = createRegistry();
    let harness: Harness;
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
                            result: JSON.stringify(outcome),
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

    const tools = await Promise.all(
        Object.entries(definition.operations).map(async ([name, operation]) =>
            defineTool({
                ...(await piToolMetadata(name, operation)),
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
                        let text = JSON.stringify(outcome);
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
                            if (result.state.outcome.status !== "completed")
                                throw executionError(
                                    "continuation_unavailable",
                                );
                            text = result.state.outcome.result;
                        }
                        return { output: [{ type: "text" as const, text }] };
                    } catch (error) {
                        stop(error);
                        throw error;
                    }
                },
            }),
        ),
    );
    registry.install(
        defineExtension({
            name: PI_MISSION_EXTENSION,
            tools,
            tasks: [waitOperation],
            hooks: [
                hook(GenerationTask, {
                    async onYield() {
                        const state = await ctx.runQuery(
                            internal.execution.piControl.publicationState,
                            args,
                        );
                        if (state.staleInstructions)
                            return {
                                continue:
                                    "The analyst updated the active instructions. Continue with the current required mission state before publishing.",
                            };
                        return undefined;
                    },
                }),
            ],
        }),
    );

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

    async function request(
        model: Model<string>,
        transcript: TranscriptContext,
        options?: SimpleStreamOptions,
    ): Promise<AssistantMessage> {
        if (Date.now() - startedAt > 80_000)
            throw executionError("pi_slice_complete");
        await drainRetainedOperations();
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
        if (!auxiliary) {
            const current = await ctx.runQuery(
                internal.execution.piControl.state,
                args,
            );
            if (current.lastInvocationId) {
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
                        throw executionError(
                            settled.code ?? "pending_operations",
                        );
                }
            }
        }
        const begun = await ctx.runMutation(
            internal.execution.invocations.begin,
            {
                ...args,
                taskKey: `pi:${task.record.id}:${attempt}:${checkpoint && typeof checkpoint === "object" && "cutoff" in checkpoint ? checkpoint.cutoff : "summary"}`,
                provenance: simulated ? "simulation" : "live",
                ...(auxiliary ? { purpose: "compaction" as const } : {}),
            },
        );
        if (begun.kind !== "ready") throw executionError(begun.code);
        const invocationArgs = {
            invocationId: begun.invocationId,
            expectedGeneration: args.expectedGeneration,
        };
        const retained = await ctx.runQuery(
            internal.execution.piControl.invocation,
            invocationArgs,
        );
        let message: AssistantMessage | undefined;
        if (retained.receivedOutputJson) {
            const response = JSON.parse(retained.receivedOutputJson);
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
                async generate(input, lifecycle) {
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
                        ? transcript.messages
                        : piMissionMessages(
                              input.instructions,
                              input.prompt,
                              transcript.messages,
                          );
                    const simulationRequest = simulated
                        ? preparePiSimulationRequest(expandedMessages)
                        : undefined;
                    const messages =
                        simulationRequest?.messages ?? expandedMessages;
                    const requestJson =
                        simulationRequest?.json ??
                        JSON.stringify({
                            version: 1,
                            backend: "pi-durable",
                            route: route ?? {
                                model: "simulation/controlled",
                                provider: "simulation",
                            },
                            messages,
                            settings: {
                                maxTokens: MODEL_MAX_OUTPUT_TOKENS,
                                maxRetries: 0,
                                temperature: 0,
                            },
                        });
                    if (
                        new TextEncoder().encode(requestJson).length >
                        (simulated
                            ? MAX_CONTEXT_BYTES
                            : MAX_OBSERVABLE_OUTPUT_BYTES)
                    )
                        return reject(
                            simulated
                                ? "context_capacity"
                                : "journal_request_capacity",
                        );
                    if (simulated) {
                        await storage.renewLease();
                        await lifecycle.beforeDispatch(requestJson);
                        const response = auxiliary
                            ? undefined
                            : await ctx.runQuery(
                                  internal.execution.simulation.invoke,
                                  invocationArgs,
                              );
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
                                              : JSON.stringify(response),
                                      ),
                                  ),
                        ]);
                    }
                    let preparationCode: string | undefined;
                    let upstreamProvider: string | undefined;
                    let reportedCost: number | undefined;
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
                            maxRetries: 0,
                            maxTokens: MODEL_MAX_OUTPUT_TOKENS,
                            timeoutMs: MODEL_ATTEMPT_TIMEOUT_MS,
                            signal: AbortSignal.any([
                                abort.signal,
                                ...(lifecycle.signal ? [lifecycle.signal] : []),
                                AbortSignal.timeout(MODEL_ATTEMPT_TIMEOUT_MS),
                            ]),
                            onProviderStreamEvent: async (data, eventModel) => {
                                argumentCapture.observe(data);
                                await options?.onProviderStreamEvent?.(
                                    data,
                                    eventModel,
                                );
                                if (!data || typeof data !== "object") return;
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
                                    if (
                                        new TextEncoder().encode(json).length >
                                        MAX_CONTEXT_BYTES
                                    )
                                        throw executionError(
                                            "context_capacity",
                                        );
                                    await storage.renewLease();
                                    await lifecycle.beforeDispatch(json);
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
                            ? { errorMessage: "model_request_failed" }
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
                    const observation = generationObservation(
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
                            argumentsError:
                                message.content
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
                            requests: message.content.flatMap((c) =>
                                c.type === "toolCall"
                                    ? [
                                          {
                                              callId: c.id,
                                              name: c.name,
                                              inputJson: JSON.stringify(
                                                  c.arguments,
                                              ),
                                          },
                                      ]
                                    : [],
                            ),
                        },
                    );
                    await lifecycle.observe(observation);
                    return observation;
                },
            };
            const reply = await invokeControlledGeneration(
                ctx,
                invocationArgs,
                native,
            );
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
        if (
            JSON.parse(current.receivedOutputJson).code ===
                "context_capacity" &&
            message.stopReason === "error"
        ) {
            await ctx.runMutation(
                internal.execution.piControl.retireCapacity,
                invocationArgs,
            );
            return message;
        }
        if (auxiliary)
            await ctx.runMutation(
                internal.execution.piControl.finishAuxiliary,
                invocationArgs,
            );
        else {
            const adopted = await ctx.runMutation(
                internal.execution.invocations.finish,
                {
                    ...invocationArgs,
                    response: JSON.parse(current.receivedOutputJson),
                    ...(current.rawOutputJson
                        ? { rawOutputJson: current.rawOutputJson }
                        : {}),
                },
            );
            if (adopted.kind === "blocked") {
                if (adopted.code === "pending_operations")
                    throw executionError("pi_slice_complete");
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
        stream: (m, t, o) =>
            guarded(m, t, { signal: o?.signal, maxRetries: 0 }),
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
                stream: { maxRetries: 0, timeoutMs: MODEL_ATTEMPT_TIMEOUT_MS },
                compaction: {
                    enabled: true,
                    reserveTokens: 8192,
                    keepRecentTokens: 8192,
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
    }, 25_000);
    try {
        const root = await harness.root(context, {
            agent: {
                model: { provider: base.id, modelId: model.id },
                thinkingLevel: "off",
                instructions: definition.instructions,
            },
        });
        await root.configure(
            {
                model: { provider: base.id, modelId: model.id },
                thinkingLevel: "off",
                instructions: definition.instructions,
            },
            context,
        );
        const submission = await root.submit(
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
        const settled = await submission.wait(context);
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
