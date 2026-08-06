import type { Id } from "@convex/_generated/dataModel";
import type { ActionCtx } from "@convex/_generated/server";
import { addManualUrlWithInspector } from "@convex/sourceActions";
import { expect, test, vi } from "vitest";

const args = {
    runId: "run-1" as Id<"researchRuns">,
    corpusRevisionId: "revision-1" as Id<"corpusRevisions">,
    url: "https://example.com/report",
};

test("records success around manual URL metadata and persists once", async () => {
    const runQuery = vi.fn(async () => ({
        executionGeneration: 3,
        stepKey: "source_review",
    }));
    const runMutation = vi
        .fn()
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
    ).resolves.toEqual({ sourceId: "source-1" });

    expect(inspect).toHaveBeenCalledOnce();
    expect(runMutation.mock.calls[0]?.[1]).toMatchObject({
        service: "url_metadata",
        status: "started",
        attempt: 1,
        executionGeneration: 3,
    });
    expect(runMutation.mock.calls[1]?.[1]).toMatchObject({
        providerReference: expect.stringContaining("url_metadata:"),
    });
    expect(runMutation.mock.calls[2]?.[1]).toMatchObject({
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
            stepKey: "source_review",
        })
        .mockResolvedValueOnce("source-existing");
    const runMutation = vi.fn(async () => ({
        shouldExecute: false,
        status: "succeeded",
    }));
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
    ).resolves.toEqual({ sourceId: "source-existing" });

    expect(inspect).not.toHaveBeenCalled();
    expect(runMutation).toHaveBeenCalledOnce();
});

test("records failed manual URL metadata inspection", async () => {
    const runQuery = vi.fn(async () => ({
        executionGeneration: 3,
        stepKey: "source_review",
    }));
    const runMutation = vi
        .fn()
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
    ).rejects.toThrow("network failed");
    expect(runMutation.mock.calls[1]?.[1]).toMatchObject({
        service: "url_metadata",
        status: "failed",
        errorCode: "TypeError",
    });
});
