import type { Id } from "@convex/_generated/dataModel";
import type { ActionCtx } from "@convex/_generated/server";
import schema from "@convex/schema";
import { submitManualUrlWithInspector } from "@convex/sourceActions";
import { makeFunctionReference } from "convex/server";
import { ConvexError } from "convex/values";
import { convexTest } from "convex-test";
import { expect, test, vi } from "vitest";

const modules = import.meta.glob("/convex/**/*.ts");

const submitManualUrl = makeFunctionReference<
    "action",
    {
        requestKey: string;
        url: string;
        target:
            | { kind: "prelaunch"; collectionKey: string }
            | {
                  kind: "run";
                  runId: Id<"researchRuns">;
                  corpusRevisionId: Id<"corpusRevisions">;
              };
    },
    | {
          kind: "prepared";
          preparationId: Id<"manualSourcePreparations">;
          canonicalUrl: string;
          title: string;
          expiresAt: number;
      }
    | {
          kind: "persisted";
          sourceId: Id<"sources">;
          canonicalUrl: string;
          title: string;
      }
>("sourceActions:submitManualUrl");

test("rejects unauthenticated source intake with structured application data", async () => {
    const t = convexTest(schema, modules);

    await expect(
        t.action(submitManualUrl, {
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

test("prepares a source before launch and returns canonical metadata", async () => {
    const runQuery = vi.fn(async () => null);
    const runMutation = vi
        .fn()
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({
            shouldExecute: true,
            status: "started",
        })
        .mockResolvedValueOnce({
            shouldExecute: false,
            status: "succeeded",
        })
        .mockResolvedValueOnce({
            preparationId: "preparation-1",
            canonicalUrl: "https://example.com/report",
            title: "Public report",
            expiresAt: 123_456,
        });
    const inspect = vi.fn(async () => ({
        canonicalUrl: "https://example.com/report",
        title: "Public report",
    }));

    await expect(
        submitManualUrlWithInspector(
            { runQuery, runMutation } as unknown as Pick<
                ActionCtx,
                "runMutation" | "runQuery"
            >,
            "user-1" as Id<"users">,
            {
                requestKey: "request-1",
                url: "https://example.com/report#overview",
                target: {
                    kind: "prelaunch",
                    collectionKey: "composer-1",
                },
            },
            inspect,
            () => 100_000,
        ),
    ).resolves.toEqual({
        kind: "prepared",
        preparationId: "preparation-1",
        canonicalUrl: "https://example.com/report",
        title: "Public report",
        expiresAt: 123_456,
    });

    expect(runQuery).toHaveBeenCalledOnce();
    expect(runMutation.mock.calls[0]?.[1]).toEqual({
        authUserId: "user-1",
    });
    expect(inspect).toHaveBeenCalledOnce();
    expect(runMutation.mock.calls[3]?.[1]).toMatchObject({
        collectionKey: "composer-1",
        requestKey: "request-1",
        canonicalUrl: "https://example.com/report",
        expiresAt: 700_000,
    });
});

test("replays an existing preparation without rate limiting or inspection", async () => {
    const existing = {
        preparationId: "preparation-1",
        canonicalUrl: "https://example.com/report",
        title: "Public report",
        expiresAt: 123_456,
    };
    const runQuery = vi.fn(async () => existing);
    const runMutation = vi.fn();
    const inspect = vi.fn();

    await expect(
        submitManualUrlWithInspector(
            { runQuery, runMutation } as unknown as Pick<
                ActionCtx,
                "runMutation" | "runQuery"
            >,
            "user-1" as Id<"users">,
            {
                requestKey: "request-1",
                url: "https://example.com/report",
                target: {
                    kind: "prelaunch",
                    collectionKey: "composer-1",
                },
            },
            inspect,
            () => 100_000,
        ),
    ).resolves.toEqual({ kind: "prepared", ...existing });

    expect(runMutation).not.toHaveBeenCalled();
    expect(inspect).not.toHaveBeenCalled();
});

test("stops a rate-limited preparation before inspection with structured data", async () => {
    const runQuery = vi.fn(async () => null);
    const runMutation = vi.fn(async () => {
        throw new ConvexError({
            area: "manual_source_intake" as const,
            code: "intake_rate_limited" as const,
            retryable: false,
        });
    });
    const inspect = vi.fn();

    await expect(
        submitManualUrlWithInspector(
            { runQuery, runMutation } as unknown as Pick<
                ActionCtx,
                "runMutation" | "runQuery"
            >,
            "user-1" as Id<"users">,
            {
                requestKey: "request-1",
                url: "https://example.com/report",
                target: {
                    kind: "prelaunch",
                    collectionKey: "composer-1",
                },
            },
            inspect,
        ),
    ).rejects.toMatchObject({
        data: {
            code: "intake_rate_limited",
            retryable: false,
        },
    });

    expect(inspect).not.toHaveBeenCalled();
});

test("persists an active-run source through the same action helper", async () => {
    const runQuery = vi
        .fn()
        .mockResolvedValueOnce({
            executionGeneration: 4,
            workflowVersion: 2,
            stepKey: "source_review",
            hasCapacity: true,
        })
        .mockResolvedValueOnce(null);
    const runMutation = vi
        .fn()
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({
            shouldExecute: true,
            status: "started",
        })
        .mockResolvedValueOnce("source-1")
        .mockResolvedValueOnce({
            shouldExecute: false,
            status: "succeeded",
        });
    const inspect = vi.fn(async () => ({
        canonicalUrl: "https://example.com/report",
        title: "Public report",
    }));

    await expect(
        submitManualUrlWithInspector(
            { runQuery, runMutation } as unknown as Pick<
                ActionCtx,
                "runMutation" | "runQuery"
            >,
            "user-1" as Id<"users">,
            {
                requestKey: "request-1",
                url: "https://example.com/report",
                target: {
                    kind: "run",
                    runId: "run-1" as Id<"researchRuns">,
                    corpusRevisionId: "revision-1" as Id<"corpusRevisions">,
                },
            },
            inspect,
        ),
    ).resolves.toEqual({
        kind: "persisted",
        sourceId: "source-1",
        canonicalUrl: "https://example.com/report",
        title: "Public report",
    });

    expect(runMutation.mock.calls[0]?.[1]).toEqual({
        authUserId: "user-1",
    });
    expect(runQuery).toHaveBeenCalledWith(expect.anything(), {
        runId: "run-1",
        corpusRevisionId: "revision-1",
    });
});

test("replays an active-run request with persisted canonical metadata", async () => {
    const runQuery = vi
        .fn()
        .mockResolvedValueOnce({
            executionGeneration: 4,
            workflowVersion: 2,
            stepKey: "source_review",
            hasCapacity: true,
        })
        .mockResolvedValueOnce({
            sourceId: "source-1",
            canonicalUrl: "https://example.com/report",
            title: "Public report",
        });
    const runMutation = vi.fn();
    const inspect = vi.fn();

    await expect(
        submitManualUrlWithInspector(
            { runQuery, runMutation } as unknown as Pick<
                ActionCtx,
                "runMutation" | "runQuery"
            >,
            "user-1" as Id<"users">,
            {
                requestKey: "request-1",
                url: "https://example.com/report",
                target: {
                    kind: "run",
                    runId: "run-1" as Id<"researchRuns">,
                    corpusRevisionId: "revision-1" as Id<"corpusRevisions">,
                },
            },
            inspect,
        ),
    ).resolves.toEqual({
        kind: "persisted",
        sourceId: "source-1",
        canonicalUrl: "https://example.com/report",
        title: "Public report",
    });

    expect(runMutation).not.toHaveBeenCalled();
    expect(inspect).not.toHaveBeenCalled();
    expect(runQuery.mock.calls[1]?.[1]).toMatchObject({
        runId: "run-1",
        providerReference: expect.stringMatching(
            /workflow:2:.*step:source_review:.*request:/,
        ),
    });
});
