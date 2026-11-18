/** Read the active environment, which Convex can replace between Node invocations. */
export function readExaApiKey(): string | undefined {
    return (
        (typeof process === "undefined"
            ? undefined
            : process.env?.EXA_API_KEY?.trim()) || undefined
    );
}

export function isExaConfigured(): boolean {
    return readExaApiKey() !== undefined;
}
