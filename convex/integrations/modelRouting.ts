import type { AgentScope } from "@convex/execution/agentDefinition";
export type ModelRoute = Readonly<{
    model: string;
    provider: string;
    reasoningEffort?: "low";
}>;
export const SIMULATION_MODEL_ROUTE: ModelRoute = {
    model: "simulation/controlled",
    provider: "simulation",
};
export const MODEL_MAX_OUTPUT_TOKENS = 6144;
export const MODEL_ATTEMPT_TIMEOUT_MS = 60_000;
export const MODEL_MAX_INPUT_PRICE_PER_MILLION = 0.15;
export const MODEL_MAX_OUTPUT_PRICE_PER_MILLION = 0.6;
/** Candidate configuration is calibrated without enabling provider calls. */
export const WORKBENCH_MODEL_ROUTE: ModelRoute & { authorizedForAgent: true } =
    {
        model: "z-ai/glm-5.3-flash",
        provider: "open-inference/fp4",
        reasoningEffort: "low",
        authorizedForAgent: true,
    };
/** Activation remains explicit and server-owned; absent configuration dispatches no paid call. */
export const missionRoutes: Partial<
    Record<AgentScope["kind"], ModelRoute & { authorizedForAgent: true }>
> = {};

export function routedModelSettings(route: ModelRoute) {
    return {
        provider: {
            only: [route.provider],
            require_parameters: true,
            allow_fallbacks: false,
            max_price: {
                prompt: MODEL_MAX_INPUT_PRICE_PER_MILLION,
                completion: MODEL_MAX_OUTPUT_PRICE_PER_MILLION,
            },
        },
        reasoning: route.reasoningEffort
            ? { enabled: true, effort: route.reasoningEffort, exclude: true }
            : { enabled: false, effort: "none" as const, exclude: true },
        usage: { include: true },
    };
}

/** Schema evaluation cannot read environment variables; activation is resolved only at execution time. */
export function configuredMissionRoute(
    kind: AgentScope["kind"],
    routes: typeof missionRoutes = missionRoutes,
) {
    return (
        routes[kind] ??
        (kind === "workbench_v1" &&
        process.env.WORKBENCH_AGENT_ENABLED === "true"
            ? WORKBENCH_MODEL_ROUTE
            : undefined)
    );
}
