import { api, internal } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { sha256Hex, stableStringify } from "@convex/domain/sourcePassages";
import { recordMissionEvent } from "@convex/execution/authority";
import {
    projectMissionHistoryEvent,
    recordContextObservation,
} from "@convex/execution/journal";
import { readMissionState } from "@convex/execution/missionHistory";
import { MAX_OPERATION_RESULT_BYTES } from "@convex/resourcePolicy";
import { afterEach, assert, expect, test, vi } from "vitest";
import {
    dispatchHistory,
    seedHistoryMission,
} from "@/__tests__/setup/execution-history";
import { seedInspectedEvidence } from "@/__tests__/setup/source-preparation";

afterEach(() => {
    vi.unstubAllEnvs();
    vi.useRealTimers();
});

test("history_text_is_unchanged_when_live_request_and_invocation_change", async () => {
    const f = await seedHistoryMission();
    const begun = await f.t.mutation(internal.execution.invocations.begin, {
        missionId: f.missionId,
        expectedGeneration: 1,
        taskKey: "history-stability",
        provenance: "simulation",
    });
    assert(begun.kind === "ready");
    const finished = await f.t.mutation(internal.execution.invocations.finish, {
        invocationId: begun.invocationId,
        expectedGeneration: 1,
        response: {
            kind: "operations",
            requests: [
                {
                    callId: "observe",
                    name: "consult_run_state",
                    inputJson: "{}",
                },
            ],
        },
    });
    const requestId = finished.requestIds[0];
    assert(requestId);
    const request = await f.t.run((ctx) => ctx.db.get(requestId));
    assert(request?.admissionEventId);
    const eventId = request.admissionEventId;
    const event = await f.t.run((ctx) => ctx.db.get(eventId));
    assert(event?.sequence);
    const read = () =>
        f.t.run(async (ctx) => {
            const retained = await ctx.db.get(event._id);
            assert(retained);
            return projectMissionHistoryEvent(ctx, retained);
        });
    const before = await read();
    await f.t.run(async (ctx) => {
        await ctx.db.patch(requestId, { status: "running" });
        await ctx.db.patch(begun.invocationId, {
            status: "blocked",
            blockCode: "later_incident",
        });
    });
    expect(await read()).toEqual(before);
});

test("old_missing_operation_payload_is_explicit", async () => {
    const f = await seedHistoryMission();
    const requestId = await f.t.mutation(
        internal.execution.operations.enqueue,
        {
            missionId: f.missionId,
            expectedGeneration: 1,
            cause: "original",
            input: { kind: "consult_run_state" },
        },
    );
    const event = await f.t.run(async (ctx) => {
        const mission = await ctx.db.get(f.missionId);
        assert(mission);
        const id = await recordMissionEvent(ctx, mission, {
            kind: "operation_observed",
            cause: "pre-projection-record",
            requestId,
        });
        return ctx.db.get(id);
    });
    assert(event?.sequence);
    const page = await f.t.run((ctx) => projectMissionHistoryEvent(ctx, event));
    expect(page.json).toContain("operation_observation_unavailable");
    expect(page.json).not.toContain('"status":"pending"');
});

test("consultation_only_activity_does_not_advance_history_source", async () => {
    const f = await seedHistoryMission();
    async function frontier() {
        const events = await f.t.run((ctx) =>
            ctx.db
                .query("agentExecutionEvents")
                .withIndex("by_mission_and_sequence", (q) =>
                    q.eq("missionId", f.missionId),
                )
                .take(128),
        );
        return Math.max(
            0,
            ...events.map((event) => {
                const value = Reflect.get(event, "historySourceSequence");
                return typeof value === "number" ? value : 0;
            }),
        );
    }
    const before = await frontier();
    expect(before).toBeGreaterThan(0);
    for (let i = 0; i < 3; i++)
        await dispatchHistory(f, { kind: "consult_mission_state" });
    expect(await frontier()).toBe(before);
    await f.client.mutation(api.execution.conversations.submit, {
        runId: f.runId,
        turnId: f.turnId,
        requestKey: "new-steer",
        delivery: "steer",
        text: "Keep the original question and inspect payment terms.",
    });
    expect(await frontier()).toBeGreaterThan(before);
});

test.each([
    "system",
    "agent",
] as const)("an invalid %s history request retains a refusal and permits a corrected read", async (actor) => {
    const { t, args } = await seedInspectedEvidence();
    const missionId = await t.mutation(internal.execution.missions.start, {
        runId: args.runId,
        corpusRevisionId: args.corpusRevisionId,
        definitionId: "saved_material_inspection_v1",
        requestKey: "history-refusal",
        expectedGeneration: args.executionGeneration,
    });
    let requestId: Id<"agentOperationRequests"> | undefined;
    if (actor === "system") {
        requestId = await t.mutation(internal.execution.operations.enqueue, {
            missionId,
            expectedGeneration: args.executionGeneration,
            cause: "history-refusal",
            input: { kind: "consult_mission_state", cursor: "bad" },
        });
    } else {
        const invocation = await t.mutation(
            internal.execution.invocations.begin,
            {
                missionId,
                expectedGeneration: args.executionGeneration,
                taskKey: "history-refusal",
                provenance: "simulation",
            },
        );
        if (invocation.kind !== "ready") throw new Error("Expected invocation");
        const response = await t.mutation(
            internal.execution.invocations.finish,
            {
                invocationId: invocation.invocationId,
                expectedGeneration: args.executionGeneration,
                response: {
                    kind: "operations",
                    requests: [
                        {
                            callId: "history",
                            name: "consult_mission_state",
                            inputJson: '{"cursor":"bad"}',
                        },
                    ],
                },
            },
        );
        requestId = response.requestIds[0];
    }
    if (!requestId) throw new Error("Expected retained history request");
    expect(
        await t.action(internal.execution.operations.dispatch, {
            requestId,
            expectedGeneration: args.executionGeneration,
        }),
    ).toEqual({ kind: "refused", code: "history_cursor_invalid" });
    expect(await t.run((ctx) => ctx.db.get(requestId))).toMatchObject({
        actor,
        status: "completed",
        outcome: { kind: "refused", code: "history_cursor_invalid" },
    });
    const correctedId = await t.mutation(
        internal.execution.operations.enqueue,
        {
            missionId,
            expectedGeneration: args.executionGeneration,
            cause: "corrected-history",
            input: { kind: "consult_mission_state" },
        },
    );
    expect(
        await t.action(internal.execution.operations.dispatch, {
            requestId: correctedId,
            expectedGeneration: args.executionGeneration,
        }),
    ).toMatchObject({ kind: "success" });
    expect(
        await t.mutation(internal.execution.invocations.begin, {
            missionId,
            expectedGeneration: args.executionGeneration,
            taskKey: "after-corrected-history",
            provenance: "simulation",
        }),
    ).toMatchObject({ kind: "ready" });
});

test("unexpected history read failures remain visible as errors", async () => {
    const { t, args } = await seedInspectedEvidence();
    const missionId = await t.mutation(internal.execution.missions.start, {
        runId: args.runId,
        corpusRevisionId: args.corpusRevisionId,
        definitionId: "saved_material_inspection_v1",
        requestKey: "history-transport",
        expectedGeneration: args.executionGeneration,
    });
    await expect(
        t.run((ctx) => {
            const runQuery: import("@convex/_generated/server").QueryCtx["runQuery"] =
                async () => {
                    throw new Error("History read channel failed");
                };
            return readMissionState(
                { ...ctx, runQuery },
                {
                    missionId,
                    expectedGeneration: args.executionGeneration,
                },
            );
        }),
    ).rejects.toThrow("History read channel failed");
});

test("targeted cross-mission context observation traverses 3+ pages with colliding mission sequence, legacy intermediate pins, and rejects diverged or cyclic ancestry", async () => {
    const f = await seedHistoryMission();
    vi.stubGlobal("fetch", () => {
        throw new Error("No provider calls in history test");
    });
    const seeded = await f.t.run(async (ctx) => {
        const mission = await ctx.db.get(f.missionId);
        assert(mission);
        // Create a cross-mission dossier context_observed event (> 130,000 chars so 3+ pages at 64 KiB)
        const contextId = await recordContextObservation(ctx, f.runId, {
            key: "long-targeted-context",
            topic: "research",
            actor: { type: "system" },
            value: {
                kind: "long_context",
                marker: "TARGET_CONTEXT_EVENT",
                body: `Ctx-${"T".repeat(135_000)}-END`,
            },
        });
        const contextEvent = await ctx.db.get(contextId);
        assert(contextEvent?.sequence);

        // Create a colliding mission event with the SAME sequence number as contextEvent
        const collidingId = await ctx.db.insert("agentExecutionEvents", {
            runId: f.runId,
            missionId: f.missionId,
            sequence: contextEvent.sequence,
            historySourceSequence: contextEvent.sequence,
            kind: "retained_evidence",
            cause: "colliding-mission-event",
            occurredAt: Date.now(),
            actor: { type: "system" },
            payload: {
                version: 1,
                state: "complete",
                json: JSON.stringify({
                    marker: "COLLIDING_MISSION_EVENT",
                    body: "M".repeat(140_000),
                }),
                contentHash: sha256Hex("colliding"),
                sizeBytes: 140_100,
            },
        });
        await ctx.db.patch(f.missionId, {
            nextEventSequence: Math.max(
                mission.nextEventSequence,
                contextEvent.sequence + 1,
            ),
            historyMaterialSequence: contextEvent.sequence,
        });
        const projected = await projectMissionHistoryEvent(ctx, contextEvent);
        return {
            contextId,
            collidingId,
            sequence: contextEvent.sequence,
            expectedJson: projected.json,
            expectedHash: projected.contentHash,
        };
    });

    // 1. Traverse all 3+ pages using fresh resolved continuation pins
    let cursor: string | undefined;
    let restored = "";
    let pageCount = 0;
    const requestIds: import("@convex/_generated/dataModel").Id<"agentOperationRequests">[] =
        [];
    while (pageCount < 10) {
        const res = await dispatchHistory(f, {
            kind: "consult_mission_state",
            ...(cursor ? { cursor } : { reference: seeded.contextId }),
        });
        assert(res.outcome.kind === "success", JSON.stringify(res.outcome));
        requestIds.push(res.requestId);
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
        expect(parsed.history.entries).toHaveLength(1);
        const entry = parsed.history.entries[0];
        assert(entry);
        expect(entry.sequence).toBe(seeded.sequence);
        expect(entry.offset).toBe(restored.length);
        expect(entry.content).not.toContain("COLLIDING_MISSION_EVENT");
        restored += entry.content;
        pageCount++;
        cursor = parsed.history.continueCursor ?? undefined;
        if (!cursor) break;
    }
    expect(pageCount).toBeGreaterThanOrEqual(3);
    expect(restored).toBe(seeded.expectedJson);
    expect(sha256Hex(restored)).toBe(seeded.expectedHash);

    // Every continuation pin must retain resolved frontier and target reference
    for (const reqId of requestIds.slice(1)) {
        const req = await f.t.run((ctx) => ctx.db.get(reqId));
        expect(req?.pin).toEqual({
            kind: "history_read",
            source: "mission",
            reference: seeded.contextId,
            frontier: { source: "mission", sequence: seeded.sequence },
        });
    }

    // 2. Simulate legacy 4,000-width intermediate chain (page 1 root -> page 2 pin missing reference & frontier)
    const legacyCursor2 = await f.t.run(async (ctx) => {
        const firstRequestId = requestIds[0];
        assert(firstRequestId);
        const req1 = await ctx.db.get(firstRequestId);
        assert(req1 && req1.outcome?.kind === "success");
        const stateObj = JSON.parse(req1.outcome.valueJson).state;
        const frag1 = seeded.expectedJson.slice(0, 4000);
        const frag2 = seeded.expectedJson.slice(4000, 8000);
        const fid1 = sha256Hex(
            stableStringify({
                source: "mission",
                id: seeded.contextId,
                textHash: seeded.expectedHash,
                offset: 0,
                end: 4000,
            }),
        );
        const fid2 = sha256Hex(
            stableStringify({
                source: "mission",
                id: seeded.contextId,
                textHash: seeded.expectedHash,
                offset: 4000,
                end: 8000,
            }),
        );
        const legacy1 = await ctx.db.insert("agentOperationRequests", {
            runId: f.runId,
            missionId: f.missionId,
            logicalKey: "legacy-targeted-1",
            operationVersion: 3,
            actor: "agent",
            cause: "legacy-1",
            expectedGeneration: 1,
            instructionVersion: req1.instructionVersion,
            input: {
                kind: "consult_mission_state",
                reference: seeded.contextId,
            },
            pin: {
                kind: "history_read",
                source: "mission",
                reference: seeded.contextId,
                frontier: { source: "mission", sequence: seeded.sequence },
            },
            status: "completed",
            adoptedAt: 100,
            createdAt: 100,
            completedAt: 100,
        });
        await ctx.db.patch(legacy1, {
            outcome: {
                kind: "success",
                valueJson: JSON.stringify({
                    kind: "consult_mission_state",
                    state: stateObj,
                    history: {
                        entries: [
                            {
                                sequence: seeded.sequence,
                                offset: 0,
                                totalCharacters: seeded.expectedJson.length,
                                content: frag1,
                            },
                        ],
                        continueCursor: `history:${legacy1}`,
                    },
                }),
            },
            historyRead: {
                version: 1,
                source: "mission",
                runId: f.runId,
                missionId: f.missionId,
                generation: 1,
                instructionVersion: req1.instructionVersion,
                frontier: { source: "mission", sequence: seeded.sequence },
                fragmentIds: [fid1],
                next: {
                    source: "mission",
                    sequence: seeded.sequence,
                    offset: 4000,
                },
            },
        });
        const legacy2 = await ctx.db.insert("agentOperationRequests", {
            runId: f.runId,
            missionId: f.missionId,
            logicalKey: "legacy-targeted-2",
            operationVersion: 3,
            actor: "agent",
            cause: "legacy-2",
            expectedGeneration: 1,
            instructionVersion: req1.instructionVersion,
            input: {
                kind: "consult_mission_state",
                cursor: `history:${legacy1}`,
            },
            // Old legacy intermediate pin: omits reference and frontier
            pin: {
                kind: "history_read",
                source: "mission",
            },
            status: "completed",
            adoptedAt: 101,
            createdAt: 101,
            completedAt: 101,
        });
        await ctx.db.patch(legacy2, {
            outcome: {
                kind: "success",
                valueJson: JSON.stringify({
                    kind: "consult_mission_state",
                    state: stateObj,
                    history: {
                        entries: [
                            {
                                sequence: seeded.sequence,
                                offset: 4000,
                                totalCharacters: seeded.expectedJson.length,
                                content: frag2,
                            },
                        ],
                        continueCursor: `history:${legacy2}`,
                    },
                }),
            },
            historyRead: {
                version: 1,
                source: "mission",
                runId: f.runId,
                missionId: f.missionId,
                generation: 1,
                instructionVersion: req1.instructionVersion,
                frontier: { source: "mission", sequence: seeded.sequence },
                fragmentIds: [fid2],
                next: {
                    source: "mission",
                    sequence: seeded.sequence,
                    offset: 8000,
                },
            },
        });
        return {
            legacy1,
            legacy2,
            stateObj,
            instructionVersion: req1.instructionVersion,
        };
    });

    // Resuming from legacy2 resolves target via legacy1, resumes at offset 8000 under new 64 KiB sizing, and restores exact remainder!
    let legacyRestored = seeded.expectedJson.slice(0, 8000);
    let legCursor: string | undefined = `history:${legacyCursor2.legacy2}`;
    let legPages = 0;
    while (legCursor && legPages < 10) {
        const res = await dispatchHistory(f, {
            kind: "consult_mission_state",
            cursor: legCursor,
        });
        assert(res.outcome.kind === "success", JSON.stringify(res.outcome));
        const parsed = JSON.parse(res.outcome.valueJson);
        expect(parsed.history.entries).toHaveLength(1);
        const entry = parsed.history.entries[0];
        expect(entry.offset).toBe(legacyRestored.length);
        expect(entry.content).not.toContain("COLLIDING_MISSION_EVENT");
        legacyRestored += entry.content;
        legPages++;
        legCursor = parsed.history.continueCursor ?? undefined;
    }
    expect(legacyRestored).toBe(seeded.expectedJson);
    expect(legPages).toBeLessThanOrEqual(3);

    // 3. Already-diverged legacy chain (fragment came from colliding mission event) is rejected as an incident
    const divergedId = await f.t.run(async (ctx) => {
        const fakeFrag = "M".repeat(4000);
        const fakeFid = sha256Hex(
            stableStringify({
                source: "mission",
                id: seeded.collidingId,
                textHash: sha256Hex("colliding"),
                offset: 8000,
                end: 12000,
            }),
        );
        const id = await ctx.db.insert("agentOperationRequests", {
            runId: f.runId,
            missionId: f.missionId,
            logicalKey: "legacy-diverged-3",
            operationVersion: 3,
            actor: "agent",
            cause: "legacy-diverged",
            expectedGeneration: 1,
            instructionVersion: legacyCursor2.instructionVersion,
            input: {
                kind: "consult_mission_state",
                cursor: `history:${legacyCursor2.legacy2}`,
            },
            pin: { kind: "history_read", source: "mission" },
            status: "completed",
            adoptedAt: 102,
            createdAt: 102,
            completedAt: 102,
        });
        await ctx.db.patch(id, {
            outcome: {
                kind: "success",
                valueJson: JSON.stringify({
                    kind: "consult_mission_state",
                    state: legacyCursor2.stateObj,
                    history: {
                        entries: [
                            {
                                sequence: seeded.sequence,
                                offset: 8000,
                                totalCharacters: seeded.expectedJson.length,
                                content: fakeFrag,
                            },
                        ],
                        continueCursor: `history:${id}`,
                    },
                }),
            },
            historyRead: {
                version: 1,
                source: "mission",
                runId: f.runId,
                missionId: f.missionId,
                generation: 1,
                instructionVersion: legacyCursor2.instructionVersion,
                frontier: { source: "mission", sequence: seeded.sequence },
                fragmentIds: [fakeFid],
                next: {
                    source: "mission",
                    sequence: seeded.sequence,
                    offset: 12000,
                },
            },
        });
        return id;
    });
    expect(
        (
            await dispatchHistory(f, {
                kind: "consult_mission_state",
                cursor: `history:${divergedId}`,
            })
        ).outcome,
    ).toEqual({ kind: "unavailable", code: "operation_execution_failed" });

    // 4. Cyclic legacy chain is rejected
    const cyclicId = await f.t.run(async (ctx) => {
        const id = await ctx.db.insert("agentOperationRequests", {
            runId: f.runId,
            missionId: f.missionId,
            logicalKey: "legacy-cyclic",
            operationVersion: 3,
            actor: "agent",
            cause: "legacy-cyclic",
            expectedGeneration: 1,
            instructionVersion: legacyCursor2.instructionVersion,
            input: { kind: "consult_mission_state" },
            pin: { kind: "history_read", source: "mission" },
            status: "completed",
            adoptedAt: 103,
            createdAt: 103,
            completedAt: 103,
        });
        await ctx.db.patch(id, {
            input: { kind: "consult_mission_state", cursor: `history:${id}` },
            outcome: {
                kind: "success",
                valueJson: JSON.stringify({
                    kind: "consult_mission_state",
                    state: legacyCursor2.stateObj,
                    history: {
                        entries: [
                            {
                                sequence: seeded.sequence,
                                offset: 0,
                                totalCharacters: seeded.expectedJson.length,
                                content: seeded.expectedJson.slice(0, 10),
                            },
                        ],
                        continueCursor: `history:${id}`,
                    },
                }),
            },
            historyRead: {
                version: 1,
                source: "mission",
                runId: f.runId,
                missionId: f.missionId,
                generation: 1,
                instructionVersion: legacyCursor2.instructionVersion,
                frontier: { source: "mission", sequence: seeded.sequence },
                fragmentIds: [sha256Hex("cycle")],
                next: {
                    source: "mission",
                    sequence: seeded.sequence,
                    offset: 10,
                },
            },
        });
        return id;
    });
    expect(
        (
            await dispatchHistory(f, {
                kind: "consult_mission_state",
                cursor: `history:${cyclicId}`,
            })
        ).outcome,
    ).toEqual({ kind: "unavailable", code: "operation_execution_failed" });
});

test("mission history sizing fits exact 64 KiB envelope, handles 1-char overflow, non-BMP emoji and JSON control escaping without splitting surrogate pairs", async () => {
    const f = await seedHistoryMission();
    vi.stubGlobal("fetch", () => {
        throw new Error("No provider calls in history boundary test");
    });

    // Probe empty-content envelope size independently to derive exact-fit length
    const probeId = await f.t.run(async (ctx) => {
        const mission = await ctx.db.get(f.missionId);
        assert(mission);
        return recordMissionEvent(ctx, mission, {
            kind: "retained_evidence",
            cause: "probe-size",
            historySource: "material",
            observation: { text: "p" },
        });
    });
    const probeRes = await dispatchHistory(f, {
        kind: "consult_mission_state",
        reference: probeId,
    });
    assert(probeRes.outcome.kind === "success");
    const probeParsed = JSON.parse(probeRes.outcome.valueJson);
    // Build an event whose projected JSON (when JSON-escaped inside entry.content) hits MAX_OPERATION_RESULT_BYTES
    const testExactAndOverflow = async (delta: 0 | 1) => {
        const eventId = await f.t.run(async (ctx) => {
            const mission = await ctx.db.get(f.missionId);
            assert(mission);
            const cause = `exact-target-${delta}`;
            const firstId = await recordMissionEvent(ctx, mission, {
                kind: "retained_evidence",
                cause,
                historySource: "material",
                observation: { text: "a".repeat(60_000) },
            });
            const ev = await ctx.db.get(firstId);
            assert(ev?.sequence);
            const actualProj = await projectMissionHistoryEvent(ctx, ev);
            const nextSeq = ev.sequence + 1;
            const currentBytes = Buffer.byteLength(
                JSON.stringify({
                    kind: "consult_mission_state",
                    state: probeParsed.state,
                    history: {
                        entries: [
                            {
                                sequence: nextSeq,
                                offset: 0,
                                totalCharacters: actualProj.json.length,
                                content: actualProj.json,
                            },
                        ],
                        continueCursor: null,
                    },
                }),
            );
            const seqDigitDelta =
                String(nextSeq).length - String(ev.sequence).length;
            const diff =
                MAX_OPERATION_RESULT_BYTES +
                delta -
                currentBytes -
                seqDigitDelta;
            return recordMissionEvent(ctx, mission, {
                kind: "retained_evidence",
                cause,
                historySource: "material",
                observation: { text: "a".repeat(60_000 + diff) },
            });
        });
        const first = await dispatchHistory(f, {
            kind: "consult_mission_state",
            reference: eventId,
        });
        assert(first.outcome.kind === "success", JSON.stringify(first.outcome));
        const parsed = JSON.parse(first.outcome.valueJson);
        const bytes = Buffer.byteLength(first.outcome.valueJson);
        expect(bytes).toBeLessThanOrEqual(MAX_OPERATION_RESULT_BYTES);
        if (delta === 0) {
            expect(bytes).toBe(MAX_OPERATION_RESULT_BYTES);
            expect(parsed.history.continueCursor).toBeNull();
        } else {
            expect(parsed.history.continueCursor).toMatch(/^history:/);
            const second = await dispatchHistory(f, {
                kind: "consult_mission_state",
                cursor: parsed.history.continueCursor,
            });
            assert(second.outcome.kind === "success");
            const secondParsed = JSON.parse(second.outcome.valueJson);
            expect(secondParsed.history.continueCursor).toBeNull();
            const ev = await f.t.run((ctx) => ctx.db.get(eventId));
            assert(ev);
            const expected = await f.t.run((ctx) =>
                projectMissionHistoryEvent(ctx, ev),
            );
            expect(
                parsed.history.entries[0].content +
                    secondParsed.history.entries[0].content,
            ).toBe(expected.json);
        }
    };
    await testExactAndOverflow(0);
    await testExactAndOverflow(1);

    // Non-BMP emoji + JSON-escaped control chars (\u0000, quotes, newlines) across 64 KiB boundary
    const unicodeId = await f.t.run(async (ctx) => {
        const mission = await ctx.db.get(f.missionId);
        assert(mission);
        return recordMissionEvent(ctx, mission, {
            kind: "retained_evidence",
            cause: "unicode-escaping-boundary",
            historySource: "material",
            observation: {
                text: `${"🧭".repeat(12_000)}${'\u0000"\n\\'.repeat(3_500)}`,
            },
        });
    });
    const expectedUnicode = await f.t.run(async (ctx) => {
        const ev = await ctx.db.get(unicodeId);
        assert(ev);
        return projectMissionHistoryEvent(ctx, ev);
    });
    let uCursor: string | undefined;
    let uRestored = "";
    let uPages = 0;
    while (uPages < 10) {
        const res = await dispatchHistory(f, {
            kind: "consult_mission_state",
            ...(uCursor ? { cursor: uCursor } : { reference: unicodeId }),
        });
        assert(res.outcome.kind === "success", JSON.stringify(res.outcome));
        expect(Buffer.byteLength(res.outcome.valueJson)).toBeLessThanOrEqual(
            MAX_OPERATION_RESULT_BYTES,
        );
        const parsed = JSON.parse(res.outcome.valueJson);
        const entry = parsed.history.entries[0];
        expect(entry.offset).toBe(uRestored.length);
        // Never leave a dangling high surrogate at the end or low surrogate at the start
        expect(/[\uD800-\uDBFF]$/.test(entry.content)).toBe(false);
        expect(/^[\uDC00-\uDFFF]/.test(entry.content)).toBe(false);
        uRestored += entry.content;
        uPages++;
        uCursor = parsed.history.continueCursor ?? undefined;
        if (!uCursor) break;
    }
    expect(uRestored).toBe(expectedUnicode.json);
    expect(sha256Hex(uRestored)).toBe(expectedUnicode.contentHash);
    expect(uPages).toBeLessThanOrEqual(3);

    // No-character capacity failure when even one complete character cannot fit in the 64 KiB envelope
    await f.t.run(async (ctx) => {
        await ctx.db.patch(f.missionId, {
            executionRuntime: undefined,
            workingNotes: "n".repeat(MAX_OPERATION_RESULT_BYTES),
        });
    });
    const capRes = await dispatchHistory(f, {
        kind: "consult_mission_state",
        reference: probeId,
    });
    expect(capRes.outcome).toEqual({
        kind: "unavailable",
        code: "history_result_capacity",
    });
});

test("continuation rejects a predecessor pin whose frontier disagrees with its receipt", async () => {
    const f = await seedHistoryMission();
    await f.t.run(async (ctx) => {
        const mission = await ctx.db.get(f.missionId);
        assert(mission);
        for (let i = 0; i < 2; i++)
            await recordMissionEvent(ctx, mission, {
                kind: "retained_evidence",
                cause: `frontier:${i}`,
                historySource: "material",
                observation: { text: "x".repeat(44000) },
            });
    });
    const first = await dispatchHistory(f, { kind: "consult_mission_state" });
    assert(first.outcome.kind === "success");
    const cursor = JSON.parse(first.outcome.valueJson).history.continueCursor;
    assert(cursor);
    await f.t.run(async (ctx) => {
        const request = await ctx.db.get(first.requestId);
        assert(
            request?.pin?.kind === "history_read" &&
                request.historyRead?.frontier.source === "mission",
        );
        await ctx.db.patch(request._id, {
            pin: {
                ...request.pin,
                frontier: {
                    source: "mission",
                    sequence: request.historyRead.frontier.sequence + 1,
                },
            },
        });
    });
    const requestId = await f.t.mutation(
        internal.execution.operations.enqueue,
        {
            missionId: f.missionId,
            expectedGeneration: 1,
            cause: "frontier-test",
            input: { kind: "consult_mission_state", cursor },
        },
    );
    await f.t.run((ctx) => ctx.db.patch(requestId, { status: "running" }));
    await expect(
        f.t.query(internal.execution.history.read, {
            requestId,
            expectedGeneration: 1,
        }),
    ).rejects.toThrow("history_receipt_invalid");
});
