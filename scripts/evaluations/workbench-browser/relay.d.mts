import type { Server } from "node:http";
/** Persisted events emitted by the retained qualification relay. */
export type RelayEvent = {
    event: string;
    scenario?: string;
    call?: number;
    generationId?: string;
    cost?: number;
    reserveUsd?: number;
    outcome?: string;
    retryable?: boolean;
    retryAfterAt?: number;
};
export function createQualificationRelay(
    root: string,
    key: string | undefined,
    providerFetch?: typeof fetch,
): Server;
export function readRelayContinuation(root: string): {
    safe: boolean;
    reason: string | null;
};
