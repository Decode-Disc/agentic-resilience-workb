import { ConvexError } from "convex/values";

export function executionError(code: string) {
    return new ConvexError({ code });
}

export function executionFailureCode(error: unknown): string | undefined {
    if (
        !(error instanceof ConvexError) ||
        typeof error.data !== "object" ||
        !error.data ||
        !("code" in error.data)
    )
        return undefined;
    return typeof error.data.code === "string" ? error.data.code : undefined;
}
