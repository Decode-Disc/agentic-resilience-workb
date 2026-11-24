import type { LookupAddress, LookupAllOptions } from "node:dns";
import { EventEmitter } from "node:events";
import { IncomingMessage } from "node:http";
import type { RequestOptions } from "node:https";
import { Socket } from "node:net";
import { api, internal } from "@convex/_generated/api";
import schema from "@convex/schema";
import { submitManualUrlWithInspector } from "@convex/sourceActions";
import { convexTest } from "convex-test";
import { afterEach, expect, test, vi } from "vitest";
import { seedManualSource } from "@/__tests__/setup/manual-source";

const { request, lookup } = vi.hoisted(() => ({
    request: vi.fn(),
    lookup: vi.fn<
        (
            hostname: string,
            options: LookupAllOptions,
        ) => Promise<LookupAddress[]>
    >(),
}));
vi.mock("node:https", async (importOriginal) => {
    const actual = await importOriginal<typeof import("node:https")>();
    return { ...actual, request, default: { ...actual, request } };
});
vi.mock("node:dns/promises", () => ({ lookup, default: { lookup } }));

const modules = import.meta.glob("/convex/**/*.ts");
const metadata = {
    canonicalUrl: "https://example.com/report",
    title: "Public report",
};

afterEach(() => {
    vi.useRealTimers();
    vi.resetAllMocks();
});

test("rejects unauthenticated source intake with structured application data", async () => {
    const t = convexTest(schema, modules);
    await expect(
        t.action(api.sourceActions.submitManualUrl, {
            requestKey: "request-1",
            url: "https://example.com/report",
            target: { kind: "prelaunch", collectionKey: "composer-1" },
        }),
    ).rejects.toMatchObject({
        data: {
            area: "manual_source_intake",
            code: "not_authenticated",
            retryable: false,
        },
    });
});

test("authenticated public intake prepares a source before launch and persists canonical metadata", async () => {
    vi.useFakeTimers();
    const { t, owned, userId } = await seedManualSource();
    lookup.mockResolvedValue([{ address: "93.184.216.34", family: 4 }]);
    request.mockImplementation(
        (
            url: URL,
            options: RequestOptions,
            receive: (response: IncomingMessage) => void,
        ) => {
            expect(url.href).toBe(metadata.canonicalUrl);
            expect(options.servername).toBe("example.com");
            const response = new IncomingMessage(new Socket());
            Object.defineProperty(response.socket, "remoteAddress", {
                value: "93.184.216.34",
            });
            response.statusCode = 200;
            response.headers = { "content-type": "text/html" };
            return Object.assign(new EventEmitter(), {
                destroy() {},
                end() {
                    receive(response);
                    response.emit(
                        "data",
                        Buffer.from(
                            "<html><title>Public report</title><body>Source material</body></html>",
                        ),
                    );
                    response.emit("end");
                },
            });
        },
    );
    const now = Date.now();
    const result = await owned.action(api.sourceActions.submitManualUrl, {
        requestKey: "request-1",
        url: "https://example.com/report#overview",
        target: { kind: "prelaunch", collectionKey: "composer-1" },
    });
    expect(result).toMatchObject({
        kind: "prepared",
        ...metadata,
        expiresAt: now + 600_000,
    });
    if (result.kind !== "prepared") throw new Error("Expected prepared source");
    expect(
        await t.run((ctx) => ctx.db.get(result.preparationId)),
    ).toMatchObject({
        ownerAuthUserId: userId,
        collectionKey: "composer-1",
        requestKey: "request-1",
        ...metadata,
    });
    expect(request).toHaveBeenCalledOnce();
    expect(lookup).toHaveBeenCalledWith("example.com", {
        all: true,
        verbatim: true,
    });
    expect(
        await t.run((ctx) => ctx.db.query("providerCalls").collect()),
    ).toEqual([
        expect.objectContaining({
            service: "url_metadata",
            status: "succeeded",
            attempt: 1,
        }),
    ]);
});

test("replays an existing preparation without rate limiting or inspection", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2025-01-01T00:00:00Z"));
    const { t, owned, userId } = await seedManualSource();
    const inspect = vi.fn(async () => metadata);
    const args = {
        requestKey: "request-1",
        url: metadata.canonicalUrl,
        target: { kind: "prelaunch" as const, collectionKey: "composer-1" },
    };
    const first = await owned.action((ctx) =>
        submitManualUrlWithInspector(ctx, userId, args, inspect),
    );
    for (let i = 0; i < 11; i++) {
        await t.mutation(
            internal.providerCalls.reserveSourceMetadataRateLimit,
            { authUserId: userId },
        );
    }
    const second = await owned.action((ctx) =>
        submitManualUrlWithInspector(ctx, userId, args, inspect),
    );
    expect(second).toEqual(first);
    expect(inspect).toHaveBeenCalledOnce();
    expect(
        await t.run((ctx) =>
            ctx.db.query("manualSourcePreparations").collect(),
        ),
    ).toHaveLength(1);
    expect(
        await t.run((ctx) => ctx.db.query("providerCalls").collect()),
    ).toHaveLength(1);
});

test("stops a rate-limited preparation before inspection with structured data", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2025-01-01T00:00:00Z"));
    const { t, owned, userId } = await seedManualSource();
    for (let i = 0; i < 12; i++) {
        await t.mutation(
            internal.providerCalls.reserveSourceMetadataRateLimit,
            { authUserId: userId },
        );
    }
    const inspect = vi.fn();
    await expect(
        owned.action((ctx) =>
            submitManualUrlWithInspector(
                ctx,
                userId,
                {
                    requestKey: "request-1",
                    url: metadata.canonicalUrl,
                    target: { kind: "prelaunch", collectionKey: "composer-1" },
                },
                inspect,
            ),
        ),
    ).rejects.toMatchObject({
        data: { code: "intake_rate_limited", retryable: false },
    });
    expect(inspect).not.toHaveBeenCalled();
    expect(
        await t.run((ctx) => ctx.db.query("providerCalls").collect()),
    ).toHaveLength(0);
});

test("replays an active-run request with persisted canonical metadata", async () => {
    const { t, owned, userId, runId, corpusRevisionId } =
        await seedManualSource();
    const inspect = vi.fn(async () => metadata);
    const args = {
        requestKey: "request-1",
        url: metadata.canonicalUrl,
        target: { kind: "run" as const, runId, corpusRevisionId },
    };
    const first = await owned.action((ctx) =>
        submitManualUrlWithInspector(ctx, userId, args, inspect),
    );
    expect(first).toMatchObject({ kind: "persisted", ...metadata });
    if (first.kind !== "persisted")
        throw new Error("Expected persisted source");
    expect(await t.run((ctx) => ctx.db.get(first.sourceId))).toMatchObject({
        runId,
        ...metadata,
        providerReference: expect.stringContaining(
            `corpus:${corpusRevisionId}:manual-source:request:`,
        ),
    });
    expect(
        await owned.action((ctx) =>
            submitManualUrlWithInspector(ctx, userId, args, inspect),
        ),
    ).toEqual(first);
    expect(inspect).toHaveBeenCalledOnce();
    expect(
        await t.run((ctx) => ctx.db.query("providerCalls").collect()),
    ).toHaveLength(1);
});
