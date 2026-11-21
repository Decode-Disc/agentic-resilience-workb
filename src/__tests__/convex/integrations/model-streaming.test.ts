import { createBoundedModelFetch } from "@convex/integrations/modelTransport";
import { MODEL_NON_STREAMING_RESPONSE_MAX_BYTES } from "@convex/resourcePolicy";
import { assert, expect, test, vi } from "vitest";

test.each([
    false,
    true,
])("a failed header observation cancels the unread stream and retains both failures when cancellation fails: %s", async (cancelFails) => {
    const cancellationFailure = new Error("Cancellation was not acknowledged");
    const cancel = vi.fn(async () => {
        if (cancelFails) throw cancellationFailure;
    });
    const failure = new Error("Header observation was not acknowledged");
    const bounded = createBoundedModelFetch(
        {
            fetch: vi.fn(
                async () =>
                    new Response(new ReadableStream({ cancel }), {
                        headers: { "content-type": "text/event-stream" },
                    }),
            ),
            onHeaders: async () => {
                throw failure;
            },
        },
        { responseTooLarge: false },
    );
    if (cancelFails) {
        await expect(bounded("https://fixture.invalid")).rejects.toMatchObject({
            cause: failure,
            errors: [failure, cancellationFailure],
        });
    } else {
        await expect(bounded("https://fixture.invalid")).rejects.toBe(failure);
    }
    expect(cancel).toHaveBeenCalledOnce();
});

test("delivers SSE before EOF and observes a complete response only after EOF", async () => {
    let upstream!: ReadableStreamDefaultController<Uint8Array>;
    const prefix = new TextEncoder().encode(
        'data: {"id":"early-generation"}\n\n',
    );
    const onResponse = vi.fn();
    const bounded = createBoundedModelFetch(
        {
            fetch: vi.fn(
                async () =>
                    new Response(
                        new ReadableStream<Uint8Array>({
                            start(controller) {
                                upstream = controller;
                                controller.enqueue(prefix);
                            },
                        }),
                        { headers: { "content-type": "text/event-stream" } },
                    ),
            ),
            onResponse,
        },
        { responseTooLarge: false },
    );
    let response: Response | undefined;
    const pending = bounded("https://fixture.invalid").then((value) => {
        response = value;
        return value;
    });
    for (let tick = 0; tick < 20; tick++) await Promise.resolve();
    try {
        expect(
            response,
            "the SSE response must be available before upstream closes",
        ).toBeDefined();
        const reader = response?.body?.getReader();
        expect(await reader?.read()).toEqual({ done: false, value: prefix });
        expect(onResponse).not.toHaveBeenCalled();
        upstream.close();
        expect(await reader?.read()).toEqual({ done: true, value: undefined });
        expect(onResponse).toHaveBeenCalledExactlyOnceWith({
            status: 200,
            body: new TextDecoder().decode(prefix),
            requestId: undefined,
            generationId: undefined,
        });
    } finally {
        try {
            upstream.close();
        } catch {
            /* Already closed by the successful read. */
        }
        await pending;
    }
});

test("bounds buffered provider response bytes and cancels the upstream without a complete observation", async () => {
    const cancel = vi.fn();
    const onResponse = vi.fn();
    const state = { responseTooLarge: false };
    const bounded = createBoundedModelFetch(
        {
            fetch: vi.fn(
                async () =>
                    new Response(
                        new ReadableStream<Uint8Array>({
                            start(controller) {
                                controller.enqueue(
                                    new Uint8Array(
                                        MODEL_NON_STREAMING_RESPONSE_MAX_BYTES,
                                    ),
                                );
                                controller.enqueue(new Uint8Array(1));
                            },
                            cancel,
                        }),
                        { headers: { "content-type": "application/json" } },
                    ),
            ),
            onResponse,
        },
        state,
    );
    await expect(bounded("https://fixture.invalid")).rejects.toThrow(
        "byte bound",
    );
    expect(state.responseTooLarge).toBe(true);
    expect(cancel).toHaveBeenCalledOnce();
    expect(onResponse).not.toHaveBeenCalled();
});

test("downstream cancellation cancels upstream and never observes partial SSE as complete", async () => {
    const cancel = vi.fn();
    const onResponse = vi.fn();
    const bounded = createBoundedModelFetch(
        {
            fetch: vi.fn(
                async () =>
                    new Response(new ReadableStream<Uint8Array>({ cancel }), {
                        headers: { "content-type": "text/event-stream" },
                    }),
            ),
            onResponse,
        },
        { responseTooLarge: false },
    );
    const response = await bounded("https://fixture.invalid");
    await response.body?.cancel("analyst stopped");
    expect(cancel).toHaveBeenCalledWith("analyst stopped");
    expect(onResponse).not.toHaveBeenCalled();
});

test("cancellation during a pending read cannot turn partial SSE into a complete observation", async () => {
    const onResponse = vi.fn();
    const cancel = vi.fn();
    const bounded = createBoundedModelFetch(
        {
            fetch: vi.fn(
                async () =>
                    new Response(new ReadableStream<Uint8Array>({ cancel }), {
                        headers: { "content-type": "text/event-stream" },
                    }),
            ),
            onResponse,
        },
        { responseTooLarge: false },
    );
    const response = await bounded("https://fixture.invalid");
    assert(response.body);
    const reader = response.body.getReader();
    const reading = reader.read();
    await Promise.resolve();
    await reader.cancel("cancel while waiting");
    await reading;
    expect(cancel).toHaveBeenCalledWith("cancel while waiting");
    expect(onResponse).not.toHaveBeenCalled();
});
