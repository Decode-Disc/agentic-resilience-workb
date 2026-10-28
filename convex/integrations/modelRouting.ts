import type { AgentScope } from "@convex/execution/agentDefinition";
export type ModelRoute = Readonly<{ model: string; provider: string }>;
export const MODEL_MAX_OUTPUT_TOKENS = 6144;
export const MODEL_ATTEMPT_TIMEOUT_MS = 60_000;
export const MODEL_MAX_INPUT_PRICE_PER_MILLION = 0.15;
export const MODEL_MAX_OUTPUT_PRICE_PER_MILLION = 0.6;
/** Empty until a reasoning route receives explicit activation. */
export const missionRoutes: Partial<
    Record<AgentScope["kind"], ModelRoute & { authorizedForAgent: true }>
> = {};
