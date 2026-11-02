import { manualSourceIntakeError } from "@convex/domain/manualSourceIntake";
import { addManualUrlWithInspector } from "@convex/sourceActions";
import { expect, test, vi } from "vitest";
import { seedManualSource } from "@/__tests__/setup/manual-source";

const metadata = {
    canonicalUrl: "https://example.com/report",
    title: "Public report",
};

test("persists source and successful manual URL metadata telemetry", async () => {
    const { t, owned, args } = await seedManualSource();
    const inspect = vi.fn(async () => metadata);
    const result = await owned.action((ctx) =>
        addManualUrlWithInspector(ctx, args, inspect),
    );
    expect(result).toMatchObject(metadata);
    expect(inspect).toHaveBeenCalledOnce();
    expect(await t.run((ctx) => ctx.db.get(result.sourceId))).toMatchObject({
        ...metadata,
        providerReference: expect.stringContaining("url_metadata:"),
    });
    expect(
        await t.run((ctx) => ctx.db.query("providerCalls").collect()),
    ).toEqual([
        expect.objectContaining({
            service: "url_metadata",
            status: "succeeded",
            attempt: 1,
            executionGeneration: 3,
        }),
    ]);
});

test("replays a completed URL operation without another external request", async () => {
    const { t, owned, args } = await seedManualSource();
    const inspect = vi.fn(async () => metadata);
    const first = await owned.action((ctx) =>
        addManualUrlWithInspector(ctx, args, inspect),
    );
    expect(
        await owned.action((ctx) =>
            addManualUrlWithInspector(ctx, args, inspect),
        ),
    ).toEqual(first);
    expect(inspect).toHaveBeenCalledOnce();
    expect(
        await t.run((ctx) => ctx.db.query("providerCalls").collect()),
    ).toHaveLength(1);
});

test("records failed manual URL metadata inspection attempts", async () => {
    const { t, owned, args } = await seedManualSource();
    const inspect = vi.fn(async () => {
        throw new TypeError("network failed");
    });
    await expect(
        owned.action((ctx) => addManualUrlWithInspector(ctx, args, inspect)),
    ).rejects.toMatchObject({
        data: { code: "connection_failed", retryable: true },
    });
    expect(inspect).toHaveBeenCalledTimes(2);
    const calls = await t.run((ctx) => ctx.db.query("providerCalls").collect());
    expect(calls).toHaveLength(2);
    expect(
        calls.map(({ status, attempt, errorCode }) => ({
            status,
            attempt,
            errorCode,
        })),
    ).toEqual([
        { status: "failed", attempt: 1, errorCode: "connection_failed" },
        { status: "failed", attempt: 2, errorCode: "connection_failed" },
    ]);
});

test("retries one typed timeout and records both attempts", async () => {
    const { t, owned, args } = await seedManualSource();
    const inspect = vi
        .fn()
        .mockRejectedValueOnce(manualSourceIntakeError("request_timeout"))
        .mockResolvedValueOnce(metadata);
    const result = await owned.action((ctx) =>
        addManualUrlWithInspector(ctx, args, inspect),
    );
    expect(result).toMatchObject(metadata);
    expect(inspect).toHaveBeenCalledTimes(2);
    expect(await t.run((ctx) => ctx.db.get(result.sourceId))).toMatchObject(
        metadata,
    );
    const calls = await t.run((ctx) => ctx.db.query("providerCalls").collect());
    expect(calls).toHaveLength(2);
    expect(
        calls.map(({ status, attempt, errorCode }) => ({
            status,
            attempt,
            errorCode,
        })),
    ).toEqual([
        { status: "failed", attempt: 1, errorCode: "request_timeout" },
        { status: "succeeded", attempt: 2, errorCode: undefined },
    ]);
});
