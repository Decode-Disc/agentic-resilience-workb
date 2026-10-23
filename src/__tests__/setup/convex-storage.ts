import { vi } from "vitest";

/** Serializes fake storage writes: convex-test 0.0.54 can lose its shared transaction while blob hashing yields. Metadata and blob storage still use the real test backend. */
export async function serializeFakeStorageWrites(t: {
    run<Result>(handler: () => Promise<Result>): Promise<Result>;
}) {
    const runtime = Reflect.get(globalThis, "Convex") as {
        readonly jsSyscall: unknown;
    };
    const bridge: {
        invoke?: (operation: string, args: unknown) => Promise<unknown>;
    } = {};
    await t.run(async () => {
        const invoke = runtime.jsSyscall;
        if (typeof invoke !== "function")
            throw new Error("Convex test syscall is unavailable");
        bridge.invoke = (operation, args) =>
            Reflect.apply(invoke, runtime, [
                operation,
                args,
            ]) as Promise<unknown>;
    });
    const original = bridge.invoke;
    if (!original) throw new Error("Convex test storage bridge is unavailable");
    return vi
        .spyOn(runtime, "jsSyscall", "get")
        .mockReturnValue((operation: string, args: unknown) =>
            operation === "storage/storeBlob"
                ? t.run(() => original(operation, args))
                : original(operation, args),
        );
}
