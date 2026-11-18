/** Convex replaces the Node environment between invocations. */
export function readOpenRouterApiKey(): string | undefined {
    return process.env.OPENROUTER_API_KEY;
}

export function isOpenRouterConfigured(): boolean {
    return Boolean(readOpenRouterApiKey()?.trim());
}
