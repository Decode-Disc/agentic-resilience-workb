import { writeFileSync } from "node:fs";
import { performance } from "node:perf_hooks";
import type { Id } from "@convex/_generated/dataModel";
import type { ActionCtx } from "@convex/_generated/server";
import {
    openMissionPiStorage,
    type PiCommit,
} from "@convex/integrations/piStorage";
import {
    approvedCaptureForMission,
    availableCapturesForMission,
} from "@convex/sourceRetrieval";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { type EntryId, ROOT_CONVERSATION_ID } from "@earendil-works/pi-durable";
import { getFunctionName } from "convex/server";
import { afterAll, assert, expect, test, vi } from "vitest";
import { seedWorkbenchMaterials } from "@/__tests__/setup/workbench-materials";

const results: unknown[] = [];
const samples = Number(process.env.HARNESS_PERF_SAMPLES ?? 7);
assert(Number.isSafeInteger(samples) && samples > 0);
function stats(values: number[]) {
    const sorted = [...values].sort((a, b) => a - b);
    return {
        samples: values.length,
        median: sorted[Math.floor(sorted.length / 2)],
        p95: sorted[Math.ceil(sorted.length * 0.95) - 1],
    };
}
afterAll(() => {
    const output = JSON.stringify({ node: process.version, results }, null, 2);
    if (process.env.HARNESS_PERF_OUTPUT)
        writeFileSync(process.env.HARNESS_PERF_OUTPUT, output);
    console.log(output);
    vi.useRealTimers();
    vi.unstubAllGlobals();
});

test("measure admission through the real conversation mutation", async () => {
    vi.stubGlobal("fetch", () => {
        throw new Error("unexpected_provider_io");
    });
    // This spy observes the real registered query; no domain collaborator is replaced.
    const capture = vi.spyOn(
        approvedCaptureForMission as unknown as {
            _handler(): Promise<unknown>;
        },
        "_handler",
    );
    const batch = vi.spyOn(
        availableCapturesForMission as unknown as {
            _handler(): Promise<unknown>;
        },
        "_handler",
    );
    try {
        for (const [sources, messages] of [
            [1, 1],
            [60, 1],
            [60, 20],
        ] as const) {
            const elapsed: number[] = [];
            const calls: number[] = [];
            for (let sample = -1; sample < samples; sample++) {
                const fixture = await seedWorkbenchMaterials(sources, messages);
                capture.mockClear();
                batch.mockClear();
                const began = performance.now();
                const turn = await fixture.start();
                const duration = performance.now() - began;
                assert(turn);
                const retained = await fixture.t.run((ctx) =>
                    ctx.db.get(turn.turnId),
                );
                expect(retained?.messageCount).toBe(messages);
                if (sample >= 0) {
                    elapsed.push(duration);
                    calls.push(
                        capture.mock.calls.length + batch.mock.calls.length,
                    );
                }
            }
            results.push({
                workload: "admission",
                sources,
                messages,
                milliseconds: stats(elapsed),
                captureQueries: calls,
            });
        }
    } finally {
        capture.mockRestore();
        batch.mockRestore();
    }
});

test("measure replay CPU, retained heap and actual adapter RPC policy", async () => {
    vi.useRealTimers();
    for (const [count, textBytes] of [
        [128, 8192],
        [1024, 8192],
        [1024, 32500],
    ] as const) {
        const commits: PiCommit[] = Array.from(
            { length: count },
            (_, index) => ({
                sequence: index + 1,
                key: `commit-${index}`,
                payload: JSON.stringify(
                    index === 0
                        ? [
                              {
                                  type: "conversation",
                                  value: { id: ROOT_CONVERSATION_ID },
                              },
                          ]
                        : [
                              {
                                  type: "entry",
                                  value: {
                                      id: index + 1,
                                      conversationId: ROOT_CONVERSATION_ID,
                                      kind: "workbench.original",
                                      data: {
                                          text: "x".repeat(textBytes),
                                          index,
                                      },
                                  },
                              },
                          ],
                ),
            }),
        );
        const bytes = commits.reduce(
            (total, commit) => total + Buffer.byteLength(commit.payload),
            0,
        );
        const elapsed: number[] = [],
            heap: number[] = [],
            scans: number[] = [],
            renewals: number[] = [];
        for (let sample = -1; sample < samples; sample++) {
            globalThis.gc?.();
            let scanCount = 0,
                renewCount = 0;
            // Execute the real action adapter, including its requested page limits.
            const ctx = {
                async runMutation(
                    reference: Parameters<typeof getFunctionName>[0],
                ) {
                    const name = getFunctionName(reference);
                    if (name === "execution/piStore:claim")
                        return {
                            sessionId: "benchmark",
                            missionId: "benchmark",
                            generation: 1,
                            epoch: 1,
                            writer: "benchmark",
                        };
                    assert(name === "execution/piStore:renew");
                    renewCount++;
                    return null;
                },
                async runQuery(
                    reference: Parameters<typeof getFunctionName>[0],
                    args: {
                        paginationOpts: {
                            cursor: string | null;
                            numItems: number;
                            maximumBytesRead: number;
                        };
                    },
                ) {
                    assert(
                        getFunctionName(reference) === "execution/piStore:scan",
                    );
                    scanCount++;
                    const offset = Number(args.paginationOpts.cursor ?? 0);
                    const page: PiCommit[] = [];
                    let size = 0;
                    for (
                        let index = offset;
                        index < count &&
                        page.length < args.paginationOpts.numItems;
                        index++
                    ) {
                        const commit = commits[index];
                        assert(commit);
                        if (
                            page.length &&
                            size + Buffer.byteLength(commit.payload) >
                                args.paginationOpts.maximumBytesRead
                        )
                            break;
                        page.push(commit);
                        size += Buffer.byteLength(commit.payload);
                    }
                    const next = offset + page.length;
                    return {
                        page,
                        isDone: next === count,
                        continueCursor: String(next),
                    };
                },
            };
            const before = process.memoryUsage().heapUsed;
            const began = performance.now();
            const storage = await openMissionPiStorage(
                ctx as unknown as ActionCtx,
                "benchmark" as Id<"agentMissions">,
                1,
                "benchmark",
                BACKGROUND_CONTEXT,
            );
            elapsed.push(performance.now() - began);
            heap.push(process.memoryUsage().heapUsed - before);
            const last = await storage.entry(
                count as EntryId,
                BACKGROUND_CONTEXT,
            );
            expect(last?.entry.data).toEqual({
                text: "x".repeat(textBytes),
                index: count - 1,
            });
            await storage.close(BACKGROUND_CONTEXT);
            scans.push(scanCount);
            renewals.push(renewCount);
            if (sample < 0) {
                elapsed.length =
                    heap.length =
                    scans.length =
                    renewals.length =
                        0;
            }
        }
        results.push({
            workload: "replay",
            commits: count,
            bytes,
            milliseconds: stats(elapsed),
            heapDeltaBytes: stats(heap),
            scans,
            renewals,
        });
    }
});
