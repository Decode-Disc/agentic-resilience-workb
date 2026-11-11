"use node";

import { components, internal } from "@convex/_generated/api";
import { executionError } from "@convex/execution/errors";
import {
    type AgentBackendIdentity,
    type AgentGenerationBackend,
    type AgentGenerationLifecycle,
    type AgentGenerationRuntime,
    LEGACY_AGENT_BACKEND,
} from "@convex/execution/executionProtocol";
import { Agent } from "@convex-dev/agent";
import { isStepCount } from "ai";
import { invokeDeferredAgentTurn } from "./modelTransport";

function transportDependencies(
    runtime: AgentGenerationRuntime,
    lifecycle: AgentGenerationLifecycle,
) {
    return {
        ...runtime.transport,
        authority: runtime.authority,
        signal: lifecycle.signal,
        beforeDispatch: lifecycle.beforeDispatch,
        onObservation: lifecycle.observe,
    };
}

const convexAgentBackend: AgentGenerationBackend = {
    id: "convex-agent",
    version: 1,
    generate: (input, lifecycle, runtime) =>
        invokeDeferredAgentTurn({
            ...input,
            dependencies: transportDependencies(runtime, lifecycle),
            generateStep: async (step) => {
                const reference = await runtime.ctx.runMutation(
                    internal.integrations.agentStorage.prepare,
                    {
                        invocationId: runtime.invocationId,
                        expectedGeneration: runtime.expectedGeneration,
                    },
                );
                const agent = new Agent(components.agent, {
                    name: "workbench-controlled-turn",
                    languageModel: step.model,
                    instructions: step.instructions,
                    tools: step.tools,
                    stopWhen: isStepCount(1),
                    contextOptions: { recentMessages: 0 },
                });
                const result = await agent.generateText(
                    runtime.ctx,
                    { threadId: reference },
                    {
                        prompt: step.prompt,
                        ...step.generation,
                        abortSignal: step.signal,
                    },
                );
                // SDK notification callbacks swallow errors, including Agent's message save.
                if (
                    !result.savedMessages?.some(
                        (message) =>
                            message.status === "success" &&
                            message.message?.role === "assistant",
                    )
                )
                    throw executionError(
                        "generation_backend_storage_unconfirmed",
                    );
            },
        }),
};

const backends: readonly AgentGenerationBackend[] = [
    {
        ...LEGACY_AGENT_BACKEND,
        generate: (input, lifecycle, runtime) =>
            invokeDeferredAgentTurn({
                ...input,
                dependencies: transportDependencies(runtime, lifecycle),
            }),
    },
    convexAgentBackend,
    { ...convexAgentBackend, version: 2 },
];

/** Static composition returns the shared contract, without exposing either generation library. */
export function resolveAgentGenerationBackend(
    identity: AgentBackendIdentity,
): AgentGenerationBackend | undefined {
    return backends.find(
        (backend) =>
            backend.id === identity.id && backend.version === identity.version,
    );
}
