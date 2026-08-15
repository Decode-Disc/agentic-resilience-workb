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
    return (
        mutationFunctions.get(functionName(reference)) ??
        missingMock("mutation", reference)
    );
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
    usePaginatedQuery.mockClear();
    useMutation.mockClear();
    useAction.mockClear();
}

export const convexReactHarness = {
    query,
    paginatedQuery,
    mutation,
    action,
    reset,
    module: {
        useQuery,
        usePaginatedQuery,
        useMutation,
        useAction,
    },
};
