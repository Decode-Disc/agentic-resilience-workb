import { internal } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import type { readInContextResult } from "@convex/domain/savedMaterialOperations";
import { sourcesDefinition } from "@convex/domain/sourcesAgent";
import {
    bindAgentDefinition,
    registeredAgentDefinitions,
} from "@convex/execution/agentCatalog";
import {
    agentToolSchemas,
    modelOperationOutcome,
} from "@convex/execution/agentDefinition";
import type { AgentOperationDefinition } from "@convex/execution/executionProtocol";
import { operationResultValidator } from "@convex/execution/operationResults";
import {
    agentToolSetKey,
    piInputProfileKey,
} from "@convex/integrations/modelInput";
import { v } from "convex/values";
import { assert, expect, expectTypeOf, test } from "vitest";
import { z } from "zod";
import {
    dispatchSourcesOperation,
    seedCapturedSources,
    startSourcesOperation,
} from "@/__tests__/setup/sources-mission";

test("every registered operation declares its result schema", () => {
    for (const definition of registeredAgentDefinitions())
        for (const operation of Object.values(definition.operations))
            expect(operation).toHaveProperty("resultValidator");
});
test("Sources receives structured success values instead of nested JSON strings", () => {
    expect(
        JSON.parse(
            modelOperationOutcome(sourcesDefinition, {
                kind: "success",
                valueJson: JSON.stringify({
                    sourceId: "source",
                    captureId: "capture",
                }),
            }),
        ),
    ).toEqual({
        kind: "success",
        value: { sourceId: "source", captureId: "capture" },
    });
});

test("malformed documentary success stays observed but cannot be adopted or replayed as success", async () => {
    const f = await seedCapturedSources();
    const id = await f.t.mutation(internal.execution.operations.enqueue, {
        missionId: f.missionId,
        expectedGeneration: 4,
        cause: "bad-result",
        input: {
            kind: "read_in_context",
            sourceId: f.sourceId,
            passageOrder: 0,
        },
    });
    expect(
        await startSourcesOperation(f.t, {
            requestId: id,
            expectedGeneration: 4,
        }),
    ).toMatchObject({ kind: "execute" });
    const valueJson = JSON.stringify({ sourceCaptureId: f.captureId });
    expect(
        await f.t.mutation(internal.execution.operations.recordResult, {
            requestId: id,
            expectedGeneration: 4,
            outcome: { kind: "success", valueJson },
        }),
    ).toEqual({ kind: "refused", code: "operation_adoption_failed" });
    const retained = await f.t.run((ctx) => ctx.db.get(id));
    expect(retained?.outcome).toEqual({ kind: "success", valueJson });
    expect(retained?.adoptionRefusalCode).toBe("operation_adoption_failed");
    expect(
        await dispatchSourcesOperation(f.t, {
            requestId: id,
            expectedGeneration: 4,
        }),
    ).toMatchObject({ kind: "refused" });
    expect((await f.t.run((ctx) => ctx.db.get(id)))?.outcome).toEqual({
        kind: "success",
        valueJson,
    });
});

test("native settlement replay preserves the adoption refusal and rechecks current authority", async () => {
    const f = await seedCapturedSources();
    const requestId = await f.t.mutation(
        internal.execution.operations.enqueueNative,
        {
            runId: f.runId,
            expectedGeneration: 4,
            cause: "malformed-settlement-replay",
            input: {
                kind: "read_in_context",
                sourceId: f.sourceId,
                passageOrder: 0,
            },
        },
    );
    expect(
        await startSourcesOperation(f.t, {
            requestId,
            expectedGeneration: 4,
        }),
    ).toMatchObject({ kind: "execute" });
    const outcome = {
        kind: "success" as const,
        valueJson: JSON.stringify({ sourceCaptureId: f.captureId }),
    };
    const args = { requestId, expectedGeneration: 4, outcome };
    const refused = { kind: "refused", code: "operation_adoption_failed" };
    expect(
        await f.t.mutation(internal.execution.operations.recordResult, args),
    ).toEqual(refused);
    expect(
        await f.t.mutation(internal.execution.operations.recordResult, args),
    ).toEqual(refused);
    expect(
        await dispatchSourcesOperation(f.t, {
            requestId,
            expectedGeneration: 4,
        }),
    ).toEqual(refused);
    expect(await f.t.run((ctx) => ctx.db.get(requestId))).toMatchObject({
        outcome,
        adoptionRefusalCode: refused.code,
    });
    await f.t.run((ctx) => ctx.db.patch(f.visitorId, { status: "revoked" }));
    expect(
        await f.t.mutation(internal.execution.operations.recordResult, args),
    ).toEqual({ kind: "refused", code: "not_authorized" });
});

test.each([
    "native",
    "mission",
] as const)("%s identity refusal retains the exact observation and immutable journal", async (mode) => {
    const f = await seedCapturedSources();
    const observed = await f.t.run(async (ctx) => {
        const requests = await ctx.db
            .query("agentOperationRequests")
            .withIndex("by_mission_and_status", (q) =>
                q.eq("missionId", f.missionId).eq("status", "completed"),
            )
            .take(10);
        return requests.find(
            (request) => request.input.kind === "search_available_material",
        )?.outcome;
    });
    assert(observed?.kind === "success");
    const otherSourceId = await f.t.run(async (ctx) => {
        const source = await ctx.db.get(f.sourceId);
        assert(source);
        const { _id, _creationTime, ...fields } = source;
        return ctx.db.insert("sources", fields);
    });
    const common = {
        expectedGeneration: 4,
        cause: "wrong-source-observation",
        input: {
            kind: "search_available_material" as const,
            sourceId: f.sourceId,
            query: "workflow observation",
        },
    };
    const requestId =
        mode === "native"
            ? await f.t.mutation(internal.execution.operations.enqueueNative, {
                  ...common,
                  runId: f.runId,
              })
            : await f.t.mutation(internal.execution.operations.enqueue, {
                  ...common,
                  missionId: f.missionId,
              });
    expect(
        await startSourcesOperation(f.t, {
            requestId,
            expectedGeneration: 4,
        }),
    ).toMatchObject({ kind: "execute" });
    const outcome = {
        ...observed,
        valueJson: JSON.stringify({
            ...JSON.parse(observed.valueJson),
            sourceId: otherSourceId,
        }),
    };
    const args = { requestId, expectedGeneration: 4, outcome };
    const refused = { kind: "refused", code: "capture_identity_conflict" };
    expect(
        await f.t.mutation(internal.execution.operations.recordResult, args),
    ).toEqual(refused);
    const retained = await f.t.run((ctx) => ctx.db.get(requestId));
    expect(retained?.outcome).toEqual(outcome);
    expect(retained?.adoptionRefusalCode).toBe(refused.code);
    expect(retained?.adoptedAt).toBeUndefined();
    const events = await f.t.run(async (ctx) =>
        (
            await ctx.db
                .query("agentExecutionEvents")
                .withIndex("by_run", (q) => q.eq("runId", f.runId))
                .take(100)
        ).filter((event) => event.requestId === requestId),
    );
    const observation = events.find(
        (event) => event.kind === "operation_observed",
    );
    assert(
        observation?.payload?.state === "complete" && observation.payload.json,
    );
    expect(JSON.parse(observation.payload.json).outcome).toEqual(outcome);
    expect(
        events.some(
            (event) =>
                event.kind === "operation_adoption_failed" &&
                event.code === refused.code,
        ),
    ).toBe(true);
    expect(events.some((event) => event.kind === "operation_completed")).toBe(
        false,
    );
    if (mode === "native") {
        expect(
            await f.t.mutation(
                internal.execution.operations.recordResult,
                args,
            ),
        ).toEqual(refused);
        expect(
            await dispatchSourcesOperation(f.t, {
                requestId,
                expectedGeneration: 4,
            }),
        ).toEqual(refused);
    }
});

test("registration rejects an operation without a result validator", () => {
    const operation = sourcesDefinition.operations.read_in_context;
    assert(operation);
    const { resultValidator: _, ...incomplete } = operation;
    // @ts-expect-error Operations cannot omit their result contract.
    const invalid: AgentOperationDefinition = incomplete;
    expect(() =>
        bindAgentDefinition({
            ...sourcesDefinition,
            operations: { read_in_context: invalid },
        }),
    ).toThrow("operation_contract_invalid");
});

test("acquisition returns the source and immutable capture consumed by the shared reading contract", async () => {
    const f = await seedCapturedSources();
    const previousRead = await f.t.mutation(
        internal.execution.operations.enqueue,
        {
            missionId: f.missionId,
            expectedGeneration: 4,
            cause: "read-before-acquisition",
            input: {
                kind: "read_in_context",
                sourceId: f.sourceId,
                passageOrder: 0,
            },
        },
    );
    const reserved = await f.t.mutation(internal.sourceCaptures.reserveUpload, {
        preparationId: f.preparationId,
        sourceId: f.sourceId,
    });
    await f.t.run(async (ctx) => {
        const old = await ctx.db.get(f.captureId);
        assert(old);
        const { _id, _creationTime, requestInputHash, ...value } = old;
        await ctx.db.patch(reserved.capture._id, {
            ...value,
            requestInputHash: reserved.capture.requestInputHash,
            status: "committed",
        });
    });
    const id = await f.t.mutation(internal.execution.operations.enqueue, {
        missionId: f.missionId,
        expectedGeneration: 4,
        cause: "acquire-ready",
        input: {
            kind: "make_source_consultable",
            sourceId: f.sourceId,
            needId: "common-context",
        },
    });
    const outcome = await dispatchSourcesOperation(f.t, {
        requestId: id,
        expectedGeneration: 4,
    });
    assert(outcome.kind === "success");
    const value = JSON.parse(outcome.valueJson);
    expect(value).toMatchObject({
        sourceId: f.sourceId,
        captureId: reserved.capture._id,
        status: "complete",
    });
    expect(value).not.toHaveProperty("sourceCaptureId");
    expect(value.contentHash).toBeTruthy();
    expect(
        await dispatchSourcesOperation(f.t, {
            requestId: previousRead,
            expectedGeneration: 4,
        }),
    ).toMatchObject({ kind: "refused", code: "version_conflict" });
    const read = await f.t.mutation(internal.execution.operations.enqueue, {
        missionId: f.missionId,
        expectedGeneration: 4,
        cause: "read-acquired",
        input: {
            kind: "read_in_context",
            sourceId: value.sourceId,
            passageOrder: 0,
        },
    });
    const readOutcome = await dispatchSourcesOperation(f.t, {
        requestId: read,
        expectedGeneration: 4,
    });
    assert(readOutcome.kind === "success");
    expect(JSON.parse(readOutcome.valueJson)).toMatchObject({
        sourceId: value.sourceId,
        captureId: value.captureId,
        contentHash: value.contentHash,
    });
});

test("wrong-table input retains a field-level diagnostic and delivers it to Sources", async () => {
    const f = await seedCapturedSources();
    const invocation = await f.t.mutation(
        internal.execution.invocations.begin,
        {
            missionId: f.missionId,
            expectedGeneration: 4,
            taskKey: "wrong-table",
            provenance: "simulation",
        },
    );
    assert(invocation.kind === "ready");
    const finished = await f.t.mutation(internal.execution.invocations.finish, {
        invocationId: invocation.invocationId,
        expectedGeneration: 4,
        response: {
            kind: "operations",
            requests: [
                {
                    callId: "wrong-table",
                    name: "read_in_context",
                    inputJson: JSON.stringify({
                        sourceId: f.captureId,
                        passageOrder: 0,
                    }),
                },
            ],
        },
    });
    const requestId = finished.requestIds[0];
    assert(requestId);
    const result = await dispatchSourcesOperation(f.t, {
        requestId,
        expectedGeneration: 4,
    });
    expect(result).toMatchObject({
        kind: "refused",
        code: "invalid_operation_input",
        validation: { path: "sourceId", expected: "Id<sources>" },
    });
    expect(
        JSON.parse(modelOperationOutcome(sourcesDefinition, result)),
    ).toMatchObject({
        validation: { path: "sourceId", expected: "Id<sources>" },
    });
});

test("registration refuses an unconstrained result schema", () => {
    const operation = sourcesDefinition.operations.read_in_context;
    assert(operation);
    expect(() =>
        bindAgentDefinition({
            ...sourcesDefinition,
            operations: {
                read_in_context: { ...operation, resultValidator: z.unknown() },
            },
        }),
    ).toThrow("operation_contract_invalid");
});

test("result table identities participate in preparation without changing provider tool inputs", async () => {
    const operation = sourcesDefinition.operations.read_in_context;
    assert(operation);
    const contract = (table: "sources" | "sourceCaptures") =>
        operationResultValidator(v.object({ sourceId: v.id(table) }));
    const tools = (table: "sources" | "sourceCaptures") =>
        agentToolSchemas({
            modelOperation: () => ({
                description: operation.description,
                inputValidator: operation.inputValidator,
                resultValidator: contract(table),
            }),
            operations: {
                read_in_context: {
                    ...operation,
                    resultValidator: contract(table),
                },
            },
        });
    const a = tools("sources"),
        b = tools("sourceCaptures");
    expect(await agentToolSetKey(a)).toBe(await agentToolSetKey(b));
    expect(
        await piInputProfileKey({
            instructions: "same",
            prompt: "same",
            operations: a,
        }),
    ).not.toBe(
        await piInputProfileKey({
            instructions: "same",
            prompt: "same",
            operations: b,
        }),
    );
    expectTypeOf<
        z.output<typeof readInContextResult>["sourceId"]
    >().toEqualTypeOf<Id<"sources">>();
    expectTypeOf<
        z.output<typeof readInContextResult>["captureId"]
    >().toEqualTypeOf<Id<"sourceCaptures">>();
});

test("a result ID from another table cannot become an adopted documentary control", async () => {
    const f = await seedCapturedSources();
    const id = await f.t.mutation(internal.execution.operations.enqueue, {
        missionId: f.missionId,
        expectedGeneration: 4,
        cause: "wrong-result-table",
        input: {
            kind: "request_documentary_check",
            needId: "common-context",
            sourceId: f.sourceId,
            proposition: "Workflow context",
            evidence: [
                {
                    captureId: f.captureId,
                    passageOrder: f.passage.order,
                    quotation: f.passage.quotation,
                },
            ],
        },
    });
    expect(
        await startSourcesOperation(f.t, {
            requestId: id,
            expectedGeneration: 4,
        }),
    ).toMatchObject({ kind: "outcome", outcome: { kind: "waiting" } });
    const request = await f.t.run((ctx) => ctx.db.get(id));
    assert(request?.admissionEventId);
    const valueJson = JSON.stringify({
        taskId: f.sourceId,
        controlVersion: 2,
        reference: request.admissionEventId,
        objectionCount: 0,
        needOrder: [],
        effectiveContributions: [],
    });
    expect(
        await f.t.mutation(internal.execution.operations.recordResult, {
            requestId: id,
            expectedGeneration: 4,
            epoch: 1,
            outcome: { kind: "success", valueJson },
        }),
    ).toMatchObject({ kind: "refused", code: "operation_adoption_failed" });
    expect((await f.t.run((ctx) => ctx.db.get(id)))?.outcome).toEqual({
        kind: "success",
        valueJson,
    });
});

test("nested invalid containers describe the declared type rather than the received constructor", async () => {
    const f = await seedCapturedSources();
    const invocation = await f.t.mutation(
        internal.execution.invocations.begin,
        {
            missionId: f.missionId,
            expectedGeneration: 4,
            taskKey: "nested-type",
            provenance: "simulation",
        },
    );
    assert(invocation.kind === "ready");
    const result = await f.t.mutation(internal.execution.invocations.finish, {
        invocationId: invocation.invocationId,
        expectedGeneration: 4,
        response: {
            kind: "operations",
            requests: [
                {
                    callId: "nested-type",
                    name: "submit_documentary_qualification",
                    inputJson: JSON.stringify({
                        sourceId: f.sourceId,
                        captureId: f.captureId,
                        expectedTaskId: null,
                        changes: [[]],
                    }),
                },
            ],
        },
    });
    const id = result.requestIds[0];
    assert(id);
    expect(
        await dispatchSourcesOperation(f.t, {
            requestId: id,
            expectedGeneration: 4,
        }),
    ).toMatchObject({
        kind: "refused",
        validation: { path: "changes[0]", expected: "object" },
    });
});
