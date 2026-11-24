import { readFileSync, writeFileSync } from "node:fs";
import { internal } from "@convex/_generated/api";
import type { Doc, Id } from "@convex/_generated/dataModel";
import { sha256Hex } from "@convex/domain/sourcePassages";
import { recordMissionEvent } from "@convex/execution/authority";
import type { readHistoryPage } from "@convex/execution/history";
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
    const sources = await f.t.run(async (ctx) => {
        const mission = await ctx.db.get(f.missionId);
        assert(mission);
        const retained = [];
        for (let i = 0; i < 20; i++) {
            const id = await recordMissionEvent(ctx, mission, {
                kind: "retained_evidence",
                cause: `dense:${i}`,
                historySource: "material",
                observation: {
                    text: `Evidence ${i}. ${"x".repeat(44000)}`,
                },
            });
            const event = await ctx.db.get(id);
            assert(event?.sequence);
            retained.push({
                sequence: event.sequence,
                ...(await projectMissionHistoryEvent(ctx, event)),
            });
        }
        return retained;
    });
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
    const cursors = new Set<string>();
    const restored = new Map<number, string>();
    do {
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
        for (const entry of history.entries) {
            const prior = restored.get(entry.sequence) ?? "";
            expect(entry.offset).toBe(prior.length);
            restored.set(entry.sequence, prior + entry.content);
        }
        cursor = history.continueCursor ?? undefined;
        if (cursor) {
            expect(cursors.has(cursor)).toBe(false);
            cursors.add(cursor);
        }
    } while (cursor);
    for (const source of sources) {
        expect(restored.get(source.sequence)).toBe(source.json);
        expect(sha256Hex(restored.get(source.sequence) ?? "")).toBe(
            source.contentHash,
        );
    }
    expect(measurements.length).toBeGreaterThan(1);
    if (process.env.HARNESS_PERF_OUTPUT)
        writeFileSync(
            process.env.HARNESS_PERF_OUTPUT,
            JSON.stringify(
                {
                    boundary:
                        "Logical documents and inline payload bytes delivered to the real Convex history query; physical database bytes and latency are not measured",
                    sourceCount: sources.length,
                    sourceCharacters: sources.reduce(
                        (sum, source) => sum + source.json.length,
                        0,
                    ),
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
        expect(measurement.resultBytes).toBeLessThanOrEqual(64 * 1024);
        expect(measurement.documents).toBeGreaterThan(0);
        expect(measurement.documents).toBeLessThanOrEqual(
            measurement.entries + 1,
        );
        expect(measurement.payloadBytes).toBeLessThanOrEqual(
            measurement.documents * 45000,
        );
    }
});

test(`restores ${process.env.HARNESS_REAL_TRAVERSAL_INPUT ? "supplied retained traversal" : "synthetic traversal-shaped"} payloads through readHistoryPage with exact hashes`, async () => {
    const f = await seedHistoryMission();
    vi.stubGlobal("fetch", () => {
        throw new Error("No provider calls in history replay");
    });
    const realInputPath = process.env.HARNESS_REAL_TRAVERSAL_INPUT;
    const realData = realInputPath
        ? (JSON.parse(readFileSync(realInputPath, "utf8")) as {
              sourceArchive: string;
              traversalIndex: number;
              items: {
                  originalSequence: number;
                  characters: number;
                  sha256: string;
                  parsed: { observation?: unknown };
              }[];
          })
        : null;
    const payloadSpecs = realData
        ? realData.items.map((item) => ({
              label: `real-seq-${item.originalSequence}`,
              observation: item.parsed.observation ?? item.parsed,
          }))
        : [
              331, 1672, 2943, 1159, 1124, 1148, 2287, 1116, 1106, 2567, 1129,
              1158, 2785, 1081, 1092, 2216, 11085, 4053, 2069, 2562, 4252, 2118,
              6540, 3921, 1613, 4012, 4009,
          ].map((size, index) => ({
              label: `synthetic-shape-${index}`,
              observation: { text: "a".repeat(Math.max(1, size - 250)) },
          }));

    const expectedBySequence = new Map<
        number,
        { json: string; contentHash: string }
    >();
    await f.t.run(async (ctx) => {
        const mission = await ctx.db.get(f.missionId);
        assert(mission);
        for (const spec of payloadSpecs) {
            const id = await recordMissionEvent(ctx, mission, {
                kind: "retained_evidence",
                cause: spec.label,
                historySource: "material",
                observation: spec.observation,
            });
            const event = await ctx.db.get(id);
            assert(event?.sequence);
            expectedBySequence.set(
                event.sequence,
                await projectMissionHistoryEvent(ctx, event),
            );
        }
    });

    const pages: {
        entries: number;
        resultBytes: number;
        historyCharacters: number;
    }[] = [];
    const restored = new Map<number, string>();
    let cursor: string | undefined;
    for (let i = 0; i < 30; i++) {
        const res = await dispatchHistory(f, {
            kind: "consult_mission_state",
            ...(cursor ? { cursor } : {}),
        });
        assert(res.outcome.kind === "success", JSON.stringify(res.outcome));
        const parsed = JSON.parse(res.outcome.valueJson) as {
            history: {
                entries: {
                    sequence: number;
                    offset: number;
                    totalCharacters: number;
                    content: string;
                }[];
                continueCursor: string | null;
            };
        };
        pages.push({
            entries: parsed.history.entries.length,
            resultBytes: Buffer.byteLength(res.outcome.valueJson),
            historyCharacters: parsed.history.entries.reduce(
                (sum, e) => sum + e.content.length,
                0,
            ),
        });
        for (const entry of parsed.history.entries) {
            const current = restored.get(entry.sequence) ?? "";
            expect(entry.offset).toBe(current.length);
            restored.set(entry.sequence, current + entry.content);
        }
        cursor = parsed.history.continueCursor ?? undefined;
        if (!cursor) break;
    }
    expect(cursor).toBeUndefined();
    for (const [seq, expected] of expectedBySequence) {
        const actual = restored.get(seq);
        expect(actual).toBe(expected.json);
        expect(sha256Hex(actual ?? "")).toBe(expected.contentHash);
    }
    if (process.env.HARNESS_REAL_PERF_OUTPUT)
        writeFileSync(
            process.env.HARNESS_REAL_PERF_OUTPUT,
            JSON.stringify(
                {
                    sourceIdentity: realData
                        ? `${realData.sourceArchive}#traversal-${realData.traversalIndex}`
                        : "synthetic-traversal-shape-27-events",
                    eventCount: expectedBySequence.size,
                    totalCharacters: [...expectedBySequence.values()].reduce(
                        (sum, item) => sum + item.json.length,
                        0,
                    ),
                    restoredHashesVerified: true,
                    consultations: pages.length,
                    totalResponseBytes: pages.reduce(
                        (sum, page) => sum + page.resultBytes,
                        0,
                    ),
                    pages,
                },
                null,
                2,
            ),
        );
});

test("history fragment loads its inline invocation payload once", async () => {
    const f = await seedHistoryMission();
    const begun = await f.t.mutation(internal.execution.invocations.begin, {
        missionId: f.missionId,
        expectedGeneration: 1,
        taskKey: "history-inline-cost",
        provenance: "simulation",
    });
    assert(begun.kind === "ready");
    const { readMissionHistoryEventFragment } = await import(
        "@convex/execution/journal"
    );
    await f.t.run(async (ctx) => {
        const json = JSON.stringify({ question: "Inspect retained evidence" });
        const payloadId = await ctx.db.insert("agentInvocationPayloads", {
            invocationId: begun.invocationId,
            runId: f.runId,
            part: "request",
            version: 1,
            state: "complete",
            json,
            contentHash: sha256Hex(json),
            sizeBytes: Buffer.byteLength(json),
            createdAt: Date.now(),
        });
        const mission = await ctx.db.get(f.missionId);
        assert(mission);
        const eventId = await recordMissionEvent(ctx, mission, {
            kind: "invocation_request_recorded",
            cause: "inline-read-cost",
            invocationId: begun.invocationId,
            invocationPayloadId: payloadId,
            historySource: "material",
        });
        const event = await ctx.db.get(eventId);
        assert(event?.invocationPayloadId);
        const expected = await projectMissionHistoryEvent(ctx, event);
        let payloadReads = 0;
        const db = new Proxy(ctx.db, {
            get(target, key, receiver) {
                if (key === "get")
                    return (...args: Parameters<typeof target.get>) => {
                        if (args[0] === event.invocationPayloadId)
                            payloadReads++;
                        return target.get(...args);
                    };
                const value = Reflect.get(target, key, receiver);
                return typeof value === "function" ? value.bind(target) : value;
            },
        });
        const fragment = await readMissionHistoryEventFragment(
            { ...ctx, db },
            event,
            0,
        );
        expect(fragment.content).toBe(expected.json);
        expect(fragment.contentHash).toBe(sha256Hex(fragment.content));
        expect(payloadReads).toBe(1);
    });
});

test("fragmented retained invocation history restores exact Unicode content across bounded pages", async () => {
    const f = await seedHistoryMission();
    const begun = await f.t.mutation(internal.execution.invocations.begin, {
        missionId: f.missionId,
        expectedGeneration: 1,
        taskKey: "fragmented-history-cost",
        provenance: "simulation",
    });
    assert(begun.kind === "ready");
    const text = `start:${'界🧭\\"'.repeat(20000)}:end`;
    const { retainedTextParts, stageRetainedText } = await import(
        "@convex/execution/retainedText"
    );
    const json = JSON.stringify({ text });
    const target = await f.t.run(async (ctx) => {
        const split = retainedTextParts(json);
        let textId: Id<"retainedTexts"> | undefined;
        for (const [index, content] of split.parts.entries())
            textId = await stageRetainedText(ctx, "fragmented-history", {
                ...split.manifest,
                index,
                content,
            });
        assert(textId);
        const payloadId = await ctx.db.insert("agentInvocationPayloads", {
            invocationId: begun.invocationId,
            runId: f.runId,
            part: "reply",
            version: 1,
            state: "complete",
            textId,
            contentHash: sha256Hex(json),
            sizeBytes: Buffer.byteLength(json),
            createdAt: Date.now(),
        });
        const mission = await ctx.db.get(f.missionId);
        assert(mission);
        const eventId = await recordMissionEvent(ctx, mission, {
            kind: "invocation_reply_recorded",
            cause: "fragmented-cost",
            invocationId: begun.invocationId,
            invocationPayloadId: payloadId,
            historySource: "material",
        });
        const event = await ctx.db.get(eventId);
        assert(event?.sequence);
        return { sequence: event.sequence, parts: split.parts.length };
    });
    expect(target.parts).toBeGreaterThanOrEqual(3);
    let cursor: string | undefined;
    let restored = "";
    let pages = 0;
    do {
        const result = await dispatchHistory(f, {
            kind: "consult_mission_state",
            ...(cursor ? { cursor } : {}),
        });
        assert(result.outcome.kind === "success");
        expect(Buffer.byteLength(result.outcome.valueJson)).toBeLessThanOrEqual(
            65536,
        );
        const history = JSON.parse(result.outcome.valueJson).history;
        for (const entry of history.entries)
            if (entry.sequence === target.sequence) {
                expect(entry.offset).toBe(restored.length);
                restored += entry.content;
            }
        cursor = history.continueCursor ?? undefined;
        pages++;
    } while (cursor && pages < 20);
    expect(cursor).toBeUndefined();
    expect(pages).toBeGreaterThanOrEqual(3);
    expect(pages).toBeLessThan(20);
    expect(JSON.parse(restored).invocation).toEqual({
        state: "complete",
        value: { text },
    });
});
