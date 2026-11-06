import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { internal } from "@convex/_generated/api";
import type { Doc, Id } from "@convex/_generated/dataModel";
import type { FunctionArgs, FunctionReturnType } from "convex/server";

const { collectSourcesTranscripts } = await import(
    /* @vite-ignore */ pathToFileURL(
        resolve("scripts/evaluations/workbench-browser/sources.ts"),
    ).href
);
type ReadPage = (
    args: FunctionArgs<
        typeof internal.execution.fixtures.inspectSourcesInvocations
    >["paginationOpts"],
) => Promise<
    FunctionReturnType<
        typeof internal.execution.fixtures.inspectSourcesInvocations
    >
>;

import { expect, test, vi } from "vitest";

const invocation: Doc<"agentInvocations"> = {
    _id: "invocation" as Id<"agentInvocations">,
    _creationTime: 1,
    runId: "run" as Id<"researchRuns">,
    generation: 1,
    definitionVersion: 3,
    taskKey: "observed",
    provenance: "simulation",
    status: "returned",
    inputJson: "{}",
    createdAt: 1,
};

test.each([
    false,
    true,
])("transcript export preserves the exact invocation bound with empty terminal page=%s", async (emptyTerminalPage) => {
    const read = vi
        .fn<ReadPage>()
        .mockResolvedValueOnce({
            page: [invocation],
            payloads: [],
            isDone: !emptyTerminalPage,
            continueCursor: "native-last",
        })
        .mockResolvedValueOnce({
            page: [],
            payloads: [],
            isDone: true,
            continueCursor: "native-end",
        });
    const result = await collectSourcesTranscripts(read, 1);
    expect(result.invocations).toEqual([invocation]);
    expect(read).toHaveBeenCalledTimes(emptyTerminalPage ? 2 : 1);
    if (emptyTerminalPage)
        expect(read).toHaveBeenLastCalledWith({
            numItems: 1,
            cursor: "native-last",
        });
});

test("transcript export refuses an extra invocation instead of relaxing the lot bound", async () => {
    const read = vi
        .fn<ReadPage>()
        .mockResolvedValueOnce({
            page: [invocation],
            payloads: [],
            isDone: false,
            continueCursor: "native-last",
        })
        .mockResolvedValueOnce({
            page: [{ ...invocation, _id: "excess" as Id<"agentInvocations"> }],
            payloads: [],
            isDone: true,
            continueCursor: "native-end",
        });
    await expect(collectSourcesTranscripts(read, 1)).rejects.toThrow(
        "authorized invocation count",
    );
});
