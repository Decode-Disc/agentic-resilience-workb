import { writeFileSync } from "node:fs";
import type { Doc } from "@convex/_generated/dataModel";
import type { readHistoryPage } from "@convex/execution/history";
import { recordMissionEvent } from "@convex/execution/authority";
import { projectMissionHistoryEvent } from "@convex/execution/journal";
import { afterEach, assert, expect, test, vi } from "vitest";
import {
    dispatchHistory,
    seedHistoryMission,
} from "@/__tests__/setup/execution-history";

afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.useRealTimers();
});

test("dense mission history reads only the source documents used by each page and restores exact fragments", async () => {
    const f = await seedHistoryMission();
    vi.stubGlobal("fetch", () => {
        throw new Error("No provider calls in history measurement");
    });
    const source = await f.t.run(
        async (
            ctx,
        ): Promise<{ sequence: number; json: string; contentHash: string }> => {
            const mission = await ctx.db.get(f.missionId);
            assert(mission);
            let first: Doc<"agentExecutionEvents"> | null = null;
            for (let i = 0; i < 20; i++) {
                const id = await recordMissionEvent(ctx, mission, {
                    kind: "retained_evidence",
                    cause: `dense:${i}`,
                    historySource: "material",
                    observation: {
                        text: `Evidence ${i}. ${"x".repeat(44000)}`,
                    },
                });
                if (i === 0) first = await ctx.db.get(id);
            }
            assert(first?.sequence);
            return {
                sequence: first.sequence,
                ...(await projectMissionHistoryEvent(ctx, first)),
            };
        },
    );
    const { read } = await import("@convex/execution/history");
    const registered = read as typeof read & {
        _handler: typeof readHistoryPage;
    };
    const original = registered._handler;
    const measurements: {
        documents: number;
        payloadBytes: number;
        resultBytes: number;
        entries: number;
    }[] = [];
    vi.spyOn(registered, "_handler").mockImplementation(async (ctx, args) => {
        const measurement = {
            documents: 0,
            payloadBytes: 0,
            resultBytes: 0,
            entries: 0,
        };
        const count = (row: Doc<"agentExecutionEvents">) => {
            measurement.documents++;
            measurement.payloadBytes += Buffer.byteLength(
                row.payload?.json ?? "",
            );
        };
        const observe = <T extends object>(object: T, track = false): T =>
            new Proxy(object, {
                get(target, key, receiver) {
                    const value = Reflect.get(target, key, receiver);
                    if (typeof value !== "function") return value;
                    if (track && key === Symbol.asyncIterator)
                        return async function* () {
                            for await (const row of target as T &
                                AsyncIterable<Doc<"agentExecutionEvents">>) {
                                count(row);
                                yield row;
                            }
                        };
                    return (...params: unknown[]) => {
                        const result = Reflect.apply(value, target, params);
                        if (track && key === "take")
                            return Promise.resolve(result).then(
                                (rows: Doc<"agentExecutionEvents">[]) => {
                                    for (const row of rows) count(row);
                                    return rows;
                                },
                            );
                        return result &&
                            typeof result === "object" &&
                            !(result instanceof Promise)
                            ? observe(
                                  result,
                                  track ||
                                      (key === "withIndex" &&
                                          params[0] ===
                                              "by_mission_and_history_source"),
                              )
                            : result;
                    };
                },
            });
        const result = await original({ ...ctx, db: observe(ctx.db) }, args);
        measurements.push(measurement);
        return result;
    });
    let cursor: string | undefined;
    let restored = "";
    for (
        let page = 0;
        page < 20 && restored.length < source.json.length;
        page++
    ) {
        const result = await dispatchHistory(f, {
            kind: "consult_mission_state",
            ...(cursor ? { cursor } : {}),
        });
        assert(result.outcome.kind === "success");
        const history = JSON.parse(result.outcome.valueJson).history as {
            entries: { sequence: number; offset: number; content: string }[];
            continueCursor: string | null;
        };
        const measure = measurements.at(-1);
        assert(measure);
        measure.entries = history.entries.length;
        measure.resultBytes = Buffer.byteLength(result.outcome.valueJson);
        for (const entry of history.entries)
            if (entry.sequence === source.sequence) {
                expect(entry.offset).toBe(restored.length);
                restored += entry.content;
            }
        cursor = history.continueCursor ?? undefined;
        assert(cursor);
    }
    expect(restored).toBe(source.json);
    expect(measurements.length).toBeGreaterThan(10);
    if (process.env.HARNESS_PERF_OUTPUT)
        writeFileSync(
            process.env.HARNESS_PERF_OUTPUT,
            JSON.stringify(
                {
                    boundary:
                        "Logical documents and inline payload bytes delivered to the real Convex history query; physical database bytes and latency are not measured",
                    sourceCharacters: source.json.length,
                    measurements,
                    totals: {
                        documents: measurements.reduce(
                            (sum, row) => sum + row.documents,
                            0,
                        ),
                        payloadBytes: measurements.reduce(
                            (sum, row) => sum + row.payloadBytes,
                            0,
                        ),
                    },
                },
                null,
                2,
            ),
        );
    for (const measurement of measurements) {
        expect(measurement.documents).toBeGreaterThan(0);
        expect(measurement.documents).toBeLessThanOrEqual(measurement.entries);
        expect(measurement.payloadBytes).toBeLessThanOrEqual(
            measurement.entries * 45000,
        );
    }
});
