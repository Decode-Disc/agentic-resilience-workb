import type { useConvexConnectionState as connectionStateHook } from "convex/react";
import {
    type FunctionArgs,
    type FunctionReference,
    type FunctionReturnType,
    getFunctionName,
} from "convex/server";
import { vi } from "vitest";

type AnyFunctionReference = FunctionReference<
    "query" | "mutation" | "action",
    "public" | "internal"
>;

type QueryResolver = (args: unknown) => unknown;
type PaginatedQueryResolver = (args: unknown, options: unknown) => unknown;
type CallableFunction = (...args: Array<unknown>) => unknown;

const queryResolvers = new Map<string, QueryResolver>();
const paginatedQueryResolvers = new Map<string, PaginatedQueryResolver>();
const mutationFunctions = new Map<string, CallableFunction>();
const actionFunctions = new Map<string, CallableFunction>();
const connectedState: ReturnType<typeof connectionStateHook> = {
    isWebSocketConnected: true,
    hasEverConnected: true,
    hasInflightRequests: false,
    timeOfOldestInflightRequest: null,
    connectionCount: 1,
    connectionRetries: 0,
    inflightActions: 0,
    inflightMutations: 0,
};
const useConvexConnectionState = vi.fn(() => connectedState);

function functionName(reference: AnyFunctionReference) {
    return getFunctionName(reference);
}

function missingMock(kind: string, reference: AnyFunctionReference): never {
    throw new Error(
        `No Convex ${kind} mock configured for ${functionName(reference)}`,
    );
}

const useQuery = vi.fn(
    (reference: AnyFunctionReference, args: unknown | "skip") => {
        if (args === "skip") {
            return undefined;
        }
        const resolver = queryResolvers.get(functionName(reference));
        return resolver ? resolver(args) : missingMock("query", reference);
    },
);

const convexClient = {
    query: vi.fn(async (reference: AnyFunctionReference, args: unknown) => {
        const resolver = queryResolvers.get(functionName(reference));
        return resolver ? resolver(args) : missingMock("query", reference);
    }),
};

const usePaginatedQuery = vi.fn(
    (
        reference: AnyFunctionReference,
        args: unknown | "skip",
        options?: unknown,
    ) => {
        const resolver = paginatedQueryResolvers.get(functionName(reference));
        return resolver
            ? resolver(args, options)
            : missingMock("paginated query", reference);
    },
);

const useMutation = vi.fn((reference: AnyFunctionReference) => {
    const implementation =
        mutationFunctions.get(functionName(reference)) ??
        missingMock("mutation", reference);
    // Cache reconciliation is exercised with the real SDK and the local-backend browser suite.
    return Object.assign(implementation, {
        withOptimisticUpdate: () => implementation,
    });
});

const useAction = vi.fn((reference: AnyFunctionReference) => {
    return (
        actionFunctions.get(functionName(reference)) ??
        missingMock("action", reference)
    );
});

function query<Reference extends FunctionReference<"query">>(
    reference: Reference,
) {
    const name = functionName(reference);
    return {
        returns(value: unknown) {
            queryResolvers.set(name, () => value);
            return this;
        },
        returnsFrom(
            resolver: (context: {
                args: FunctionArgs<Reference> | "skip";
            }) => unknown,
        ) {
            queryResolvers.set(name, (args) =>
                resolver({
                    args: args as FunctionArgs<Reference> | "skip",
                }),
            );
            return this;
        },
        throws(error: Error) {
            queryResolvers.set(name, () => {
                throw error;
            });
            return this;
        },
    };
}

function paginatedQuery<Reference extends FunctionReference<"query">>(
    reference: Reference,
) {
    const name = functionName(reference);
    return {
        returns(value: unknown) {
            paginatedQueryResolvers.set(name, () => value);
            return this;
        },
        returnsFrom(
            resolver: (context: {
                args: Omit<FunctionArgs<Reference>, "paginationOpts"> | "skip";
                options: unknown;
            }) => unknown,
        ) {
            paginatedQueryResolvers.set(name, (args, options) =>
                resolver({
                    args: args as
                        | Omit<FunctionArgs<Reference>, "paginationOpts">
                        | "skip",
                    options,
                }),
            );
            return this;
        },
        throws(error: Error) {
            paginatedQueryResolvers.set(name, () => {
                throw error;
            });
            return this;
        },
    };
}

function mutation<Reference extends FunctionReference<"mutation">>(
    reference: Reference,
) {
    const name = functionName(reference);
    return {
        uses(
            implementation: (
                args: FunctionArgs<Reference>,
            ) => Promise<FunctionReturnType<Reference>>,
        ) {
            mutationFunctions.set(name, implementation as CallableFunction);
            return this;
        },
    };
}

function action<Reference extends FunctionReference<"action">>(
    reference: Reference,
) {
    const name = functionName(reference);
    return {
        uses(
            implementation: (
                args: FunctionArgs<Reference>,
            ) => Promise<FunctionReturnType<Reference>>,
        ) {
            actionFunctions.set(name, implementation as CallableFunction);
            return this;
        },
    };
}

function reset() {
    queryResolvers.clear();
    paginatedQueryResolvers.clear();
    mutationFunctions.clear();
    actionFunctions.clear();
    useQuery.mockClear();
    convexClient.query.mockClear();
    usePaginatedQuery.mockClear();
    useMutation.mockClear();
    useAction.mockClear();
    useConvexConnectionState.mockReset().mockReturnValue(connectedState);
}

export const convexReactHarness = {
    query,
    paginatedQuery,
    mutation,
    action,
    reset,
    module: {
        useQuery,
        useConvex: () => convexClient,
        usePaginatedQuery,
        useMutation,
        useAction,
        useConvexConnectionState,
    },
};
