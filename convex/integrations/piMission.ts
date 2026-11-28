"use node";

import { internal } from "@convex/_generated/api";
import type { Doc, Id } from "@convex/_generated/dataModel";
import type { ActionCtx } from "@convex/_generated/server";
import { sha256Hex } from "@convex/domain/sourcePassages";
import { getAgentDefinition } from "@convex/execution/agentCatalog";
import {
    agentToolSchemas,
    modelOperationOutcome,
    renderCompletionToolOutcome,
    renderCompletionToolRefusal,
    SUBMIT_COMPLETION_TOOL,
} from "@convex/execution/agentDefinition";
import {
    classifyDispatchFailure,
    executionError,
    executionFailureCode,
    protectedDiagnostic,
} from "@convex/execution/errors";
import type { AgentGenerationBackend } from "@convex/execution/executionProtocol";
import { invokeControlledGeneration } from "@convex/execution/invokeAgentModel";
import { generationInterruption } from "@convex/execution/missionData";
import { revisionRoute } from "@convex/execution/modelConfigurationCore";
import {
    piRequiredContextTokens,
    piToolMetadata,
} from "@convex/integrations/piModelAdapter";
import {
    NATIVE_WORKER_POLICY,
    PI_IN_SLICE_POLL_INTERVAL_MS,
    PI_IN_SLICE_WAIT_MS,
    PI_LEASE_RENEW_INTERVAL_MS,
    PI_OPERATION_WAIT_POLL_MS,
    PI_RETAINED_OPERATION_BATCH,
    PI_SLICE_YIELD_SAFETY_MS,
    PI_WORKER_SLICE_MS,
    resolveGenerationAuthority,
} from "@convex/resourcePolicy";
import { recoverCorrectionDraft } from "@convex/responseControlCore";
import {
    BACKGROUND_CONTEXT,
    withAbortSignal,
} from "@earendil-works/chord/context";
import {
    type AssistantMessage,
    type AssistantMessageEvent,
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
    AgentDoc,
    type AgentState,
    AssistantEntry,
    type Conversation,
    createRegistry,
    type DocumentState,
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
    PI_STATE_SECTION,
    piMissionInput,
    piMissionMessages,
    piMissionStateText,
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
import {
    lookupPiOperation,
    preparePiReply,
    preparePiResult,
    preparePiSubmission,
    recoverHistoricalCompletion,
    recoverPiInvocationBody,
    recoverPiPublication,
} from "./piInvocation";
import { configuredNativeModel } from "./piModelProfiles";
import { createNativeInputDelivery } from "./piNativeInput";
import { openMissionPiStorage } from "./piStorage";
import { createPiToolArgumentsCapture } from "./piToolArguments";

export { piToolMetadata } from "./piModelAdapter";

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
    let inputJson = section?.startsWith(prefix)
        ? section.slice(prefix.length)
        : undefined;
    if (inputJson?.includes('"draftResponseHash"')) {
        const snapshot = JSON.parse(inputJson);
        const control = snapshot.domain?.responseControl;
        if (typeof control?.draftResponseHash === "string") {
            delete control.draft;
            inputJson = JSON.stringify(snapshot);
        }
    }
    return {
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
    executionDeadlineAt: number,
) {
    const mission = await ctx.runQuery(
        internal.execution.piControlReads.state,
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
    if (!storage.lease) throw executionError("pi_writer_fenced");
    const { sessionId, writer: leaseWriter, epoch } = storage.lease;
    const piLease = { sessionId, writer: leaseWriter, epoch };
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
    const sliceDeadline = Math.min(
        startedAt + PI_WORKER_SLICE_MS,
        executionDeadlineAt,
    );
    const waitedInSlice = new Set<Id<"agentOperationRequests">>();
    const pendingToolWakes = new Set<Id<"agentOperationRequests">>();
    const adoptedWakes = new Set<Id<"agentOperationRequests">>();
    const responseState: {
        responseTooLarge: boolean;
        httpStatus?: number;
        retryAfterAt?: number;
    } = { responseTooLarge: false };
    const registry = createRegistry();
    let harness: Harness;
    let root: Conversation;
    let publicInvocation:
        | { invocationId: Id<"agentInvocations">; afterSequence: number }
        | undefined;
    let progressView:
        | Awaited<ReturnType<Conversation["viewState"]>>
        | undefined;
    let unsubscribeProgress: (() => void) | undefined;
    let progressWrite: Promise<unknown> = Promise.resolve();
    let nativeSettled = false;
    let preparationChanges = 0;
    let agentDocument: DocumentState<AgentState> | undefined;
    let pendingTurnContext:
        | Awaited<ReturnType<typeof buildTurnContext>>
        | undefined;
    let afterToolsPrepared = false;
    let afterToolsHadQueuedInputs = false;
    function resetTurnPreparation() {
        pendingTurnContext = undefined;
        afterToolsPrepared = false;
        afterToolsHadQueuedInputs = false;
    }
    const lastPreparedDelivery = { messages: 0, observations: 0, controls: 0 };
    function changedPreparation() {
        resetTurnPreparation();
        if (++preparationChanges >= 3)
            throw executionError("native_preparation_stalled");
        return fauxAssistantMessage(
            fauxText(
                "The request preparation changed before dispatch. Continue with freshly prepared state, active instructions and tools.",
            ),
        );
    }
    const nativeDelivery = createNativeInputDelivery(ctx, args, storage);
    function syncInputs() {
        return definition.nativeConversation
            ? nativeDelivery.synchronize(root, context)
            : nativeDelivery.synchronizeObservations(root, context);
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
        operationKind?: Doc<"agentOperationRequests">["input"]["kind"],
    ) {
        const scope = {
            requestId,
            piLease,
            expectedGeneration: args.expectedGeneration,
        };
        if (
            operationKind &&
            definition.operations[operationKind]?.executeInTransaction
        ) {
            try {
                return await ctx.runMutation(
                    internal.execution.operations.executeLocal,
                    scope,
                );
            } catch (error) {
                return ctx.runMutation(
                    internal.execution.operations.settleLocalRollback,
                    {
                        ...scope,
                        failure: classifyDispatchFailure(
                            error,
                            "before_callback",
                        ),
                    },
                );
            }
        }
        return ctx.runAction(internal.execution.operations.dispatch, scope);
    }

    async function wakeStatus(requestId: Id<"agentOperationRequests">) {
        return ctx.runQuery(internal.execution.piControl.operationWakeStatus, {
            ...piLease,
            missionId: args.missionId,
            generation: args.expectedGeneration,
            requestId,
        });
    }

    async function waitBrieflyInSlice(
        requestId: Id<"agentOperationRequests">,
        signal: AbortSignal,
    ) {
        waitedInSlice.add(requestId);
        const until = Math.min(
            Date.now() + PI_IN_SLICE_WAIT_MS,
            sliceDeadline - PI_SLICE_YIELD_SAFETY_MS,
        );
        while (Date.now() < until) {
            signal.throwIfAborted();
            const current = await wakeStatus(requestId);
            signal.throwIfAborted();
            if (
                current.outcome &&
                current.outcome.kind !== "waiting" &&
                (current.status === "observed" ||
                    current.status === "completed")
            ) {
                return dispatchRetainedOperation(requestId);
            }
            const remaining = until - Date.now();
            if (remaining <= 0) break;
            await new Promise<void>((resolve) => {
                const done = () => {
                    clearTimeout(timer);
                    signal.removeEventListener("abort", done);
                    resolve();
                };
                const timer = setTimeout(
                    done,
                    Math.min(remaining, PI_IN_SLICE_POLL_INTERVAL_MS),
                );
                signal.addEventListener("abort", done, { once: true });
            });
        }
        signal.throwIfAborted();
        return undefined;
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
                    waitedInSlice.add(task.input.requestId);
                    resumeAt = Date.now() + PI_OPERATION_WAIT_POLL_MS;
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
        const operationTools = await Promise.all(
            Object.entries(definition.operations).map(
                async ([name, operation]) =>
                    defineTool({
                        ...(await piToolMetadata(
                            name,
                            projected[name] ?? all[name] ?? operation,
                        )),
                        async execute(_input, api, toolContext) {
                            try {
                                const request = await lookupPiOperation(
                                    ctx,
                                    { ...args, callId: api.callId },
                                    toolContext.abortSignal,
                                );
                                if (!request)
                                    throw executionError(
                                        "operation_correlation_invalid",
                                    );
                                let outcome = await dispatchRetainedOperation(
                                    request._id,
                                    request.input.kind,
                                );
                                if (outcome.kind === "waiting") {
                                    const ready = await waitBrieflyInSlice(
                                        request._id,
                                        toolContext.abortSignal ?? abort.signal,
                                    );
                                    if (ready && ready.kind !== "waiting") {
                                        (
                                            toolContext.abortSignal ??
                                            abort.signal
                                        ).throwIfAborted();
                                        pendingToolWakes.add(request._id);
                                        outcome = ready;
                                    }
                                }
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
                                    if (waitedInSlice.has(request._id)) {
                                        const current = await wakeStatus(
                                            request._id,
                                        );
                                        if (
                                            current.outcome &&
                                            current.outcome.kind !== "waiting"
                                        )
                                            pendingToolWakes.add(request._id);
                                    }
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
        if (definition.completionTransport !== "native_tool")
            return operationTools;
        const completionSchema =
            projected[SUBMIT_COMPLETION_TOOL] ?? all[SUBMIT_COMPLETION_TOOL];
        if (!completionSchema)
            throw executionError("definition_contract_invalid");
        const completionTool = defineTool({
            ...(await piToolMetadata(SUBMIT_COMPLETION_TOOL, completionSchema)),
            async execute(_input, api) {
                try {
                    if (!storage.lease)
                        throw executionError("pi_writer_fenced");
                    const lease = storage.lease;
                    const lookup = {
                        ...lease,
                        callId: api.callId,
                    };
                    const read =
                        internal.execution.piControlReads.completionDisposition;
                    let disposition = await ctx.runQuery(read, lookup);
                    if (disposition.kind === "historical") {
                        await recoverHistoricalCompletion(
                            ctx,
                            lease,
                            disposition.invocation,
                            context.abortSignal,
                        );
                        disposition = await ctx.runQuery(read, lookup);
                    }
                    if (disposition.kind === "historical")
                        throw executionError("completion_correlation_invalid");
                    if (disposition.kind === "operation") {
                        const outcome = await dispatchRetainedOperation(
                            disposition.requestId,
                        );
                        return {
                            output: [
                                {
                                    type: "text" as const,
                                    text: modelOperationOutcome(
                                        definition,
                                        outcome,
                                    ),
                                },
                            ],
                        };
                    }
                    if (disposition.kind === "accepted") {
                        return {
                            output: [
                                {
                                    type: "text" as const,
                                    text: renderCompletionToolOutcome({
                                        kind: "accepted",
                                    }),
                                },
                            ],
                            control: { terminate: true },
                        };
                    }
                    if (disposition.kind === "pending")
                        throw executionError("pi_slice_complete");
                    return {
                        isError: true,
                        output: [
                            {
                                type: "text" as const,
                                text: renderCompletionToolRefusal(
                                    disposition.code,
                                    disposition.correction,
                                ),
                            },
                        ],
                    };
                } catch (error) {
                    stop(error);
                    throw error;
                }
            },
        });
        return [...operationTools, completionTool];
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
                                const prepared = pendingTurnContext;
                                if (!prepared) resetTurnPreparation();
                                pendingTurnContext = undefined;
                                const current =
                                    prepared ?? (await buildTurnContext());
                                let inputJson = current.inputJson;
                                if (inputJson.includes('"draftResponseHash"')) {
                                    const snapshot = JSON.parse(inputJson);
                                    const control =
                                        snapshot.domain?.responseControl;
                                    if (
                                        typeof control?.draftResponseHash ===
                                        "string"
                                    ) {
                                        control.draft =
                                            await recoverCorrectionDraft(ctx, {
                                                ...args,
                                                contentHash:
                                                    control.draftResponseHash,
                                            });
                                        inputJson = JSON.stringify(snapshot);
                                    }
                                }
                                const messages = piMissionMessages(
                                    definition.instructions,
                                    inputJson,
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
                            for (const id of pendingToolWakes)
                                adoptedWakes.add(id);
                            pendingToolWakes.clear();
                            if (
                                definition.completionTransport ===
                                    "native_tool" &&
                                storage.lease
                            ) {
                                const lease = storage.lease;
                                const read =
                                    internal.execution.piControlReads
                                        .terminalCompletionAccepted;
                                let accepted = await ctx.runQuery(read, lease);
                                if (typeof accepted === "object") {
                                    await recoverHistoricalCompletion(
                                        ctx,
                                        lease,
                                        accepted.invocation,
                                        context.abortSignal,
                                    );
                                    accepted = await ctx.runQuery(read, lease);
                                }
                                if (accepted === true) return;
                            }
                            await settleRetainedOperations();
                            const { hadQueued } = await syncInputs();
                            pendingTurnContext = await refreshTools();
                            afterToolsPrepared = true;
                            afterToolsHadQueuedInputs = hadQueued;
                        },
                        async onYield() {
                            resetTurnPreparation();
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
    async function buildTurnContext() {
        const current = await ctx.runQuery(internal.execution.context.build, {
            ...args,
            correctionAdmission: true,
        });
        if (current.kind === "blocked") throw executionError(current.code);
        return current;
    }
    async function refreshTools() {
        const current = await buildTurnContext();
        const snapshot: unknown = JSON.parse(current.inputJson);
        tools = await buildTools(snapshot);
        installTools();
        const offered = new Set(
            Object.keys(agentToolSchemas(definition, snapshot)),
        );
        const modelTools = tools.filter((tool) => offered.has(tool.name));
        const previous = agentDocument?.value?.modelTools;
        if (
            !Array.isArray(previous) ||
            previous.length !== modelTools.length ||
            modelTools.some((tool, index) => tool.name !== previous[index])
        ) {
            await root.configure({ modelTools }, context);
        }
        return current;
    }

    async function drainRetainedOperations() {
        for (let count = 0; count < PI_RETAINED_OPERATION_BATCH; count++) {
            const pending = await ctx.runQuery(
                internal.execution.piControlReads.nextOperation,
                args,
            );
            if (!pending) return;
            const outcome = await dispatchRetainedOperation(
                pending._id,
                pending.input.kind,
            );
            if (outcome.kind === "waiting") {
                const ready = await waitBrieflyInSlice(
                    pending._id,
                    abort.signal,
                );
                if (!ready || ready.kind === "waiting") {
                    resumeAt = Date.now() + PI_OPERATION_WAIT_POLL_MS;
                    throw executionError("pi_slice_complete");
                }
                abort.signal.throwIfAborted();
                adoptedWakes.add(pending._id);
            }
        }
        if (
            await ctx.runQuery(
                internal.execution.piControlReads.nextOperation,
                args,
            )
        )
            throw executionError("pi_slice_complete");
    }

    async function settleRetainedOperations() {
        await drainRetainedOperations();
        const current = await ctx.runQuery(
            internal.execution.piControlReads.state,
            args,
        );
        if (!current.lastInvocationId) return;
        const previous = await ctx.runQuery(
            internal.execution.piControlReads.invocation,
            {
                invocationId: current.lastInvocationId,
                expectedGeneration: args.expectedGeneration,
            },
        );
        const output =
            previous.status === "returned"
                ? await recoverPiInvocationBody(
                      ctx,
                      previous,
                      "adopted",
                      args,
                      context.abortSignal,
                  )
                : undefined;
        if (output && JSON.parse(output).kind === "operations") {
            const settled = await ctx.runMutation(
                internal.execution.invocations.settle,
                {
                    invocationId: previous._id,
                    expectedGeneration: args.expectedGeneration,
                },
            );
            if (settled.kind !== "ready")
                throw executionError("pending_operations");
        }
    }

    async function request(
        model: Model<string>,
        transcript: TranscriptContext,
        options?: SimpleStreamOptions,
        onProgress?: (event: AssistantMessageEvent) => void,
    ): Promise<AssistantMessage> {
        if (Date.now() - startedAt > PI_WORKER_SLICE_MS)
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
            terminal &&
            (definition.nativeConversation ||
                definition.completionTransport === "native_tool") &&
            storage.sessionId
                ? await ctx.runQuery(
                      internal.execution.piControlReads.nativeInvocation,
                      { ...args, sessionId: storage.sessionId, taskKey },
                  )
                : null;
        if (
            terminal &&
            original?.status === "returned" &&
            !original.blockCode &&
            (original.receivedOutputJson || original.receivedOutputTextId) &&
            storage.sessionId
        ) {
            const authority = {
                expectedGeneration: args.expectedGeneration,
                sessionId: storage.sessionId,
            };
            const received = await recoverPiInvocationBody(
                ctx,
                original,
                "received",
                authority,
                context.abortSignal,
            );
            const rawJson = received
                ? await recoverPiInvocationBody(
                      ctx,
                      original,
                      "raw",
                      authority,
                      context.abortSignal,
                  )
                : undefined;
            const raw = rawJson ? JSON.parse(rawJson) : null;
            if (raw?.backendOutputJson)
                return JSON.parse(raw.backendOutputJson);
        }
        if (["completed", "cancelled"].includes(mission.status))
            throw executionError("pi_terminal_dispatch_forbidden");
        const skipSettle = afterToolsPrepared;
        const skipSync = afterToolsPrepared && !afterToolsHadQueuedInputs;
        resetTurnPreparation();
        if (auxiliary) await drainRetainedOperations();
        else {
            if (!skipSettle) await settleRetainedOperations();
            if (!skipSync) await syncInputs();
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
                piLease,
                returnInputReference: true,
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
                    : definition.completionTransport === "native_tool"
                      ? {
                            piSessionId: storage.sessionId,
                        }
                      : {}),
                provenance: simulated ? "simulation" : "live",
                ...(auxiliary ? { purpose: "compaction" as const } : {}),
            },
        );
        if (begun.kind === "blocked") {
            if (begun.code === "native_input_changed")
                return changedPreparation();
            throw executionError(begun.code);
        }
        if (begun.kind !== "ready_reference")
            throw executionError("native_state_unavailable");
        preparationChanges = 0;
        const invocationArgs = {
            invocationId: begun.invocationId,
            expectedGeneration: args.expectedGeneration,
        };
        const retained = await ctx.runQuery(
            internal.execution.piControlReads.invocation,
            invocationArgs,
        );
        const retainedResponseJson = await recoverPiInvocationBody(
            ctx,
            retained,
            "received",
            args,
            context.abortSignal,
        );
        if (
            !auxiliary &&
            !retainedResponseJson &&
            !retained.providerCallId &&
            (!retained.nativePreparation ||
                prepared?.inputHash !== begun.inputHash ||
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
        publicInvocation =
            !auxiliary && definition.nativeConversation
                ? {
                      invocationId: begun.invocationId,
                      afterSequence: storage.committedSequence,
                  }
                : undefined;
        let message: AssistantMessage | undefined;
        if (
            !auxiliary &&
            ["blocked", "returned"].includes(retained.status) &&
            generationInterruption(retained.blockCode) !== undefined &&
            retainedResponseJson &&
            retained.receivedWhileAuthorized === true &&
            retained.generation !== args.expectedGeneration &&
            retained.adoptionGeneration === args.expectedGeneration
        ) {
            // Resume authorizes a new continuation, not adoption or dispatch of the refused generation.
            preparationChanges++;
            return fauxAssistantMessage(
                fauxText(
                    "The preceding response was refused and remains recorded. This mission has explicitly resumed under current authority. Continue using current required state, correct the response and do not repeat completed operations.",
                ),
            );
        }
        if (retainedResponseJson) {
            const response = JSON.parse(retainedResponseJson);
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
            const rawJson = await recoverPiInvocationBody(
                ctx,
                retained,
                "raw",
                args,
                context.abortSignal,
            );
            const raw = rawJson ? JSON.parse(rawJson) : null;
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
                async generate(_input, lifecycle, runtime) {
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
                        await lifecycle.beforeDispatch(simulationRequest.json, {
                            effectiveMaxOutputTokens:
                                simulationRequest.effectiveMaxOutputTokens,
                        });
                        const response = auxiliary
                            ? undefined
                            : await ctx.runAction(
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
                                : !auxiliary &&
                                    definition.completionTransport ===
                                        "native_tool" &&
                                    response?.kind === "complete"
                                  ? fauxAssistantMessage(
                                        [
                                            fauxToolCall(
                                                SUBMIT_COMPLETION_TOOL,
                                                response,
                                                {
                                                    id: `sim-complete:${retained._id}`,
                                                },
                                            ),
                                        ],
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
                    const authority = resolveGenerationAuthority(
                        runtime.authority,
                        Date.now(),
                    );
                    if (authority.kind === "blocked")
                        throw executionError(authority.code);
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
                                    throw executionError(
                                        "evaluation_dossier_not_authorized",
                                    );
                                request.headers.delete("authorization");
                                const body = await request.text();
                                const correlation = JSON.stringify({
                                    invocationId: retained._id,
                                    generation: args.expectedGeneration,
                                    bodyHash: sha256Hex(body),
                                });
                                request.headers.set(
                                    "x-workbench-relay-dispatch",
                                    correlation,
                                );
                                const response = await fetch(
                                    `${origin}/chat/completions`,
                                    {
                                        method: request.method,
                                        headers: Object.fromEntries(
                                            request.headers,
                                        ),
                                        body,
                                        signal: request.signal,
                                        redirect: "error",
                                    },
                                );
                                if (
                                    response.status === 400 &&
                                    response.headers.get(
                                        "x-workbench-relay-not-dispatched",
                                    ) === correlation
                                ) {
                                    await lifecycle.observeProvider?.({
                                        diagnostic: protectedDiagnostic(
                                            new Error(
                                                `relay_not_dispatched ${correlation}`,
                                            ),
                                            "provider_transport",
                                        ),
                                    });
                                    preparationCode =
                                        "qualification_relay_refused";
                                }
                                return response;
                            },
                            onHeaders: async ({
                                status,
                                generationId,
                                requestId,
                            }) => {
                                await lifecycle.observeProvider?.({
                                    httpStatus: status,
                                    generationId,
                                    requestId,
                                });
                            },
                        },
                        responseState,
                    );
                    const generationSignal = AbortSignal.any([
                        abort.signal,
                        ...(lifecycle.signal ? [lifecycle.signal] : []),
                        AbortSignal.timeout(authority.timeoutMs),
                    ]);
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
                            timeoutMs: authority.timeoutMs,
                            signal: generationSignal,
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
                    for await (const event of stream) {
                        if (event.type !== "done" && event.type !== "error")
                            onProgress?.(event);
                    }
                    const received = await stream.result();
                    if (preparationCode) return reject(preparationCode);
                    if (
                        received.stopReason === "error" ||
                        received.stopReason === "aborted"
                    ) {
                        const cause = new Error(
                            received.errorMessage ??
                                "Native generation ended without a confirmed result",
                        );
                        if (responseState.responseTooLarge) {
                            cause.name = "ResponseCapacityError";
                            cause.message = `Provider response exceeded its byte bound: ${cause.message}`;
                        } else if (generationSignal.aborted) {
                            const reason: unknown = generationSignal.reason;
                            if (reason && typeof reason === "object") {
                                if (
                                    "name" in reason &&
                                    typeof reason.name === "string"
                                )
                                    cause.name = reason.name;
                                if (
                                    "message" in reason &&
                                    typeof reason.message === "string"
                                )
                                    cause.message = `${reason.message}: ${cause.message}`;
                            }
                        }
                        await lifecycle.observeProvider?.({
                            httpStatus: responseState.httpStatus,
                            diagnostic: protectedDiagnostic(
                                cause,
                                "provider_transport",
                            ),
                        });
                    }
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
                        const error = executionError(
                            generationSignal.aborted &&
                                Date.now() >= executionDeadlineAt &&
                                runtime.authority.deadlineAt ===
                                    executionDeadlineAt
                                ? "node_action_deadline"
                                : "attempt_outcome_unknown",
                        );
                        stop(error);
                        throw error;
                    }
                    const validateOriginalArguments =
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
                                    const originalCall = toolArguments.get(
                                        c.id,
                                    );
                                    const original = originalCall?.rawArguments;
                                    if (typeof original !== "string")
                                        throw executionError(
                                            "native_tool_arguments_unavailable",
                                        );
                                    // Trim only validated JSON; invalid originals must reach canonical refusal unchanged.
                                    inputJson = originalCall?.argumentsError
                                        ? original
                                        : original.trim();
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
                executionDeadlineAt,
                native,
                piLease,
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
            internal.execution.piControlReads.invocation,
            invocationArgs,
        );
        const responseJson = await recoverPiInvocationBody(
            ctx,
            current,
            "received",
            args,
            context.abortSignal,
        );
        if (!responseJson || !message)
            throw executionError("retained_response_invalid");
        const currentResponse = JSON.parse(responseJson);
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
                {
                    ...invocationArgs,
                    recovered: {
                        responseHash: sha256Hex(responseJson),
                        refusalCode:
                            currentResponse.kind === "blocked"
                                ? currentResponse.code
                                : undefined,
                    },
                },
            );
        } else {
            const resultPreparation = await preparePiResult(
                ctx,
                invocationArgs,
                currentResponse,
                responseJson,
                definition,
                context.abortSignal,
            );
            const preparedResult = resultPreparation?.preparedResult;
            const replyPreparation = await preparePiReply(
                ctx,
                invocationArgs,
                currentResponse,
                responseJson,
                definition,
                context.abortSignal,
            );
            const preparedReply =
                replyPreparation && "textId" in replyPreparation
                    ? replyPreparation
                    : undefined;
            const useReference =
                preparedResult ||
                (preparedReply &&
                    (definition.id === "conversation_validation_v1" ||
                        current.workbenchCompletionAdmission));
            const preparedSubmission = useReference
                ? undefined
                : (resultPreparation?.refusal ??
                  (replyPreparation && "correctionWording" in replyPreparation
                      ? {
                            responseHash: sha256Hex(responseJson),
                            response: {
                                kind: "completion_correction" as const,
                                completion: replyPreparation.completion,
                            },
                        }
                      : preparePiSubmission(
                            currentResponse,
                            responseJson,
                            definition,
                            current.workbenchOperationAdmission ??
                                current.sourcesOperationAdmission ??
                                (current.inputJson
                                    ? JSON.parse(current.inputJson)
                                    : undefined),
                        )));
            const adopted = await ctx.runMutation(
                internal.execution.invocations.finish,
                {
                    ...invocationArgs,
                    ...(useReference
                        ? {}
                        : preparedSubmission
                          ? { preparedSubmission }
                          : { response: currentResponse }),
                    ...(preparedReply ? { preparedReply } : {}),
                    ...(preparedResult ? { preparedResult } : {}),
                    ...(replyPreparation &&
                    "correctionWording" in replyPreparation
                        ? {
                              correctionWording:
                                  replyPreparation.correctionWording,
                          }
                        : {}),
                },
            );
            if (adopted.kind === "blocked") {
                if (adopted.code === "pending_operations")
                    throw executionError("pi_slice_complete");
                const isToolCompletion =
                    currentResponse.kind === "completion_submission" &&
                    currentResponse.call !== null;
                if (
                    isToolCompletion &&
                    [
                        "completion_correction_required",
                        "mission_context_changed",
                        "stale_instructions",
                    ].includes(adopted.code ?? "")
                )
                    return message;
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
        void request(model, transcript, options, (event) =>
            stream.push(event),
        ).then(
            (message) => stream.end(message),
            (error) => {
                stop(error);
                const end = () =>
                    stream.end(
                        fauxAssistantMessage([], {
                            stopReason: "error",
                            errorMessage: "execution_interrupted",
                        }),
                    );
                if (
                    executionFailureCode(error) === "pi_slice_complete" &&
                    options?.signal &&
                    !options.signal.aborted
                ) {
                    // Close the native task before ending the stream: a planned yield
                    // must retain its checkpoint, not commit a terminal model error.
                    options.signal.addEventListener("abort", end, {
                        once: true,
                    });
                } else end();
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
        if (definition.nativeConversation && storage.lease) {
            const lease = storage.lease;
            progressView = await root.viewState(context);
            let lastProgress = "";
            unsubscribeProgress = progressView.subscribe((value) => {
                const current = publicInvocation;
                const sequence = storage.committedSequence;
                if (!current || sequence <= current.afterSequence) return;
                const generation = value.docs["pi.live"]?.generation;
                if (
                    !generation ||
                    typeof generation !== "object" ||
                    Array.isArray(generation)
                )
                    return;
                const message = generation.message;
                if (
                    !message ||
                    typeof message !== "object" ||
                    Array.isArray(message) ||
                    !Array.isArray(message.content)
                )
                    return;
                const text = message.content
                    .flatMap((part) =>
                        part &&
                        typeof part === "object" &&
                        !Array.isArray(part) &&
                        part.type === "text" &&
                        typeof part.text === "string"
                            ? [part.text]
                            : [],
                    )
                    .join("");
                const key = `${current.invocationId}:${text}`;
                if (!text || key === lastProgress) return;
                lastProgress = key;
                progressWrite = progressWrite
                    .then(() =>
                        ctx.runMutation(
                            internal.execution.piStore.publishPreview,
                            {
                                ...lease,
                                invocationId: current.invocationId,
                                sequence,
                                text,
                            },
                        ),
                    )
                    .catch(stop);
            });
        }
        if (!terminal) {
            agentDocument = await harness.documentState(
                AgentDoc,
                root.id,
                context,
            );
            const active = agentDocument?.value;
            if (
                active?.model?.provider !== base.id ||
                active.model.modelId !== model.id ||
                active.thinkingLevel !== "off" ||
                active.instructions !== definition.instructions
            ) {
                await root.configure(
                    {
                        model: { provider: base.id, modelId: model.id },
                        thinkingLevel: "off",
                        instructions: definition.instructions,
                    },
                    context,
                );
            }
        }
        if (mission.status === "cancelled") {
            await root.abort(context);
            nativeSettled = true;
            return;
        }
        if (!terminal) await refreshTools();
        if (!terminal || definition.nativeConversation) await syncInputs();
        const submission = definition.nativeConversation
            ? undefined
            : await root.submit(
                  {
                      type: "input",
                      content: piMissionInput(definition.completionTransport),
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
            if (publication.completed && publication.publishedReply) {
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
                const reply = publication.publishedReply;
                if (sha256Hex(text) !== reply.contentHash) {
                    const publishedText = await recoverPiPublication(
                        ctx,
                        { ...args, ...reply },
                        context.abortSignal,
                    );
                    if (publishedText === undefined)
                        throw executionError("publication_context_unavailable");
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
                                                        text: publishedText,
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
                internal.execution.piControlReads.state,
                args,
            );
            const last = current.lastInvocationId
                ? await ctx.runQuery(
                      internal.execution.piControlReads.invocation,
                      {
                          invocationId: current.lastInvocationId,
                          expectedGeneration: args.expectedGeneration,
                      },
                  )
                : null;
            const json = last
                ? await recoverPiInvocationBody(
                      ctx,
                      last,
                      "received",
                      args,
                      context.abortSignal,
                  )
                : undefined;
            const response = json ? JSON.parse(json) : null;
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
        unsubscribeProgress?.();
        await progressWrite;
        if (failure) nativeSettled = false;
        progressView?.dispose();
        agentDocument?.dispose();
        const nextWake = wake;
        await harness.close(BACKGROUND_CONTEXT);
        await ctx.runMutation(internal.execution.piControl.closeWorker, {
            ...args,
            writer,
            nativeSettled,
            adoptedWakeCount: adoptedWakes.size,
            ...(failure && executionFailureCode(failure) !== "pi_slice_complete"
                ? {
                      error:
                          executionFailureCode(failure) ??
                          "execution_interrupted",
                  }
                : executionFailureCode(failure) === "pi_slice_complete"
                  ? {
                        at:
                            resumeAt ??
                            Date.now() + NATIVE_WORKER_POLICY.resumeDelayMs,
                    }
                  : nextWake.at !== undefined || nextWake.active
                    ? {
                          at:
                              nextWake.at ??
                              Date.now() + NATIVE_WORKER_POLICY.resumeDelayMs,
                      }
                    : {}),
        });
    }
}
