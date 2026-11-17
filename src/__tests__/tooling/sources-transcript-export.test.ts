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
import { createHash } from "node:crypto";

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

test("transcript export hydrates and verifies fragmented admitted input and requests", async () => {
    const input = JSON.stringify({ large: "état".repeat(20000) });
    const request = JSON.stringify({ messages: "original".repeat(20000) });
    const hash = (text: string) =>
        createHash("sha256").update(text).digest("hex");
    const read = vi.fn<ReadPage>().mockResolvedValue({
        page: [
            {
                ...invocation,
                inputJson: "",
                inputTextId: "input-text" as Id<"retainedTexts">,
                inputContentHash: hash(input),
            },
        ],
        payloads: [
            {
                _id: "payload" as Id<"agentInvocationPayloads">,
                _creationTime: 1,
                runId: invocation.runId,
                invocationId: invocation._id,
                part: "request",
                version: 1,
                state: "complete",
                textId: "request-text" as Id<"retainedTexts">,
                contentHash: hash(request),
                sizeBytes: Buffer.byteLength(request),
                createdAt: 1,
            },
        ],
        isDone: true,
        continueCursor: "",
    });
    const readText = vi.fn(
        async (args: {
            part: string;
            paginationOpts: { cursor: string | null };
        }) => {
            const content = args.part === "input" ? input : request;
            const index = args.paginationOpts.cursor === null ? 0 : 1;
            return {
                page: [
                    {
                        index,
                        content:
                            index === 0
                                ? content.slice(0, 60000)
                                : content.slice(60000),
                    },
                ],
                isDone: index === 1,
                continueCursor: "next",
            };
        },
    );
    const result = await collectSourcesTranscripts(
        read,
        1,
        undefined,
        readText,
    );
    expect(result.invocations[0]?.inputJson).toBe(input);
    expect(result.payloads[0]?.json).toBe(request);
    expect(readText).toHaveBeenCalledTimes(4);
    await expect(collectSourcesTranscripts(read, 1)).rejects.toThrow(
        "fragment reader",
    );
    await expect(
        collectSourcesTranscripts(read, 1, undefined, async () => ({
            page: [{ index: 0, content: "wrong" }],
            isDone: true,
            continueCursor: "",
        })),
    ).rejects.toThrow("hash");
});
