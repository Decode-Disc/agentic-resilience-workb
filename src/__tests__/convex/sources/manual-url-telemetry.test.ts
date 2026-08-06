import type { Id } from "@convex/_generated/dataModel";
import type { ActionCtx } from "@convex/_generated/server";
import { manualSourceIntakeError } from "@convex/domain/manualSourceIntake";
import { addManualUrlWithInspector } from "@convex/sourceActions";
import { expect, test, vi } from "vitest";

const args = {
    authUserId: "user-1" as Id<"users">,
    runId: "run-1" as Id<"researchRuns">,
    corpusRevisionId: "revision-1" as Id<"corpusRevisions">,
    requestKey: "request-1",
    url: "https://example.com/report",
};

test("records success around manual URL metadata and persists once", async () => {
    const runQuery = vi
        .fn()
        .mockResolvedValueOnce({
            executionGeneration: 3,
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
        addManualUrlWithInspector(
            { runQuery, runMutation } as unknown as Pick<
                ActionCtx,
                "runMutation" | "runQuery"
            >,
            args,
            inspect,
        ),
    ).resolves.toEqual({
        sourceId: "source-1",
        canonicalUrl: "https://example.com/report",
        title: "Public report",
    });

    expect(inspect).toHaveBeenCalledOnce();
    expect(runMutation.mock.calls[1]?.[1]).toMatchObject({
        service: "url_metadata",
        status: "started",
        attempt: 1,
        executionGeneration: 3,
    });
    expect(runMutation.mock.calls[2]?.[1]).toMatchObject({
        providerReference: expect.stringContaining("url_metadata:"),
    });
    expect(runMutation.mock.calls[3]?.[1]).toMatchObject({
        service: "url_metadata",
        status: "succeeded",
        attempt: 1,
    });
});

test("replays a completed URL operation without another external request", async () => {
    const runQuery = vi
        .fn()
        .mockResolvedValueOnce({
            executionGeneration: 3,
            workflowVersion: 2,
            stepKey: "source_review",
            hasCapacity: true,
        })
        .mockResolvedValueOnce({
            sourceId: "source-existing",
            canonicalUrl: "https://example.com/report",
            title: "Public report",
        });
    const runMutation = vi.fn();
    const inspect = vi.fn();

    await expect(
        addManualUrlWithInspector(
            { runQuery, runMutation } as unknown as Pick<
                ActionCtx,
                "runMutation" | "runQuery"
            >,
            args,
            inspect,
        ),
    ).resolves.toEqual({
        sourceId: "source-existing",
        canonicalUrl: "https://example.com/report",
        title: "Public report",
    });

    expect(inspect).not.toHaveBeenCalled();
    expect(runMutation).not.toHaveBeenCalled();
});

test("records failed manual URL metadata inspection", async () => {
    const runQuery = vi
        .fn()
        .mockResolvedValueOnce({
            executionGeneration: 3,
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
        .mockResolvedValueOnce({
            shouldExecute: false,
            status: "failed",
        })
        .mockResolvedValueOnce({
            shouldExecute: true,
            status: "started",
        })
        .mockResolvedValueOnce({
            shouldExecute: false,
            status: "failed",
        });
    const inspect = vi.fn(async () => {
        throw new TypeError("network failed");
    });

    await expect(
        addManualUrlWithInspector(
            { runQuery, runMutation } as unknown as Pick<
                ActionCtx,
                "runMutation" | "runQuery"
            >,
            args,
            inspect,
        ),
    ).rejects.toMatchObject({
        data: {
            code: "connection_failed",
            retryable: true,
        },
    });
    expect(runMutation.mock.calls[2]?.[1]).toMatchObject({
        service: "url_metadata",
        status: "failed",
        attempt: 1,
        errorCode: "connection_failed",
    });
    expect(runMutation.mock.calls[4]?.[1]).toMatchObject({
        service: "url_metadata",
        status: "failed",
        attempt: 2,
        errorCode: "connection_failed",
    });
    expect(inspect).toHaveBeenCalledTimes(2);
});

test("retries one typed timeout and records both attempts", async () => {
    const runQuery = vi
        .fn()
        .mockResolvedValueOnce({
            executionGeneration: 3,
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
        .mockResolvedValueOnce({
            shouldExecute: false,
            status: "failed",
        })
        .mockResolvedValueOnce({
            shouldExecute: true,
            status: "started",
        })
        .mockResolvedValueOnce("source-1")
        .mockResolvedValueOnce({
            shouldExecute: false,
            status: "succeeded",
        });
    const inspect = vi
        .fn()
        .mockRejectedValueOnce(manualSourceIntakeError("request_timeout"))
        .mockResolvedValueOnce({
            canonicalUrl: "https://example.com/report",
            title: "Public report",
        });

    await expect(
        addManualUrlWithInspector(
            { runQuery, runMutation } as unknown as Pick<
                ActionCtx,
                "runMutation" | "runQuery"
            >,
            args,
            inspect,
        ),
    ).resolves.toEqual({
        sourceId: "source-1",
        canonicalUrl: "https://example.com/report",
        title: "Public report",
    });

    expect(inspect).toHaveBeenCalledTimes(2);
    expect(runMutation.mock.calls[2]?.[1]).toMatchObject({
        status: "failed",
        attempt: 1,
        errorCode: "request_timeout",
    });
    expect(runMutation.mock.calls[3]?.[1]).toMatchObject({
        status: "started",
        attempt: 2,
    });
    expect(runMutation.mock.calls[5]?.[1]).toMatchObject({
        status: "succeeded",
        attempt: 2,
    });
});
