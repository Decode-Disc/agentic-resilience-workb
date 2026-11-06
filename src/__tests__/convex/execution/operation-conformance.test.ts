import { internal } from "@convex/_generated/api";
import { initializeSources } from "@convex/domain/sources";
import {
    bindAgentDefinition,
    registeredAgentDefinitions,
} from "@convex/execution/agentCatalog";
import type {
    AgentDefinition,
    AgentScope,
} from "@convex/execution/agentDefinition";
import {
    agentMethodInstructions,
    separatedContextInstructions,
} from "@convex/execution/agentDefinition";
import { commonOperations } from "@convex/execution/commonOperations";
import { validateOperationExecutionResult } from "@convex/execution/executionProtocol";
import { afterEach, assert, expect, test, vi } from "vitest";
import { seedHistoryMission } from "@/__tests__/setup/execution-history";
import { seedInspectedEvidence } from "@/__tests__/setup/source-preparation";
import { workbenchAdmissionInput } from "@/__tests__/setup/workbench";

afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    vi.useRealTimers();
});

async function fixture(binding: AgentDefinition) {
    if (binding.executionScope === "conversation") {
        const f = await seedHistoryMission();
        await f.t.run((ctx) => ctx.db.patch(f.runId, { startMode: "framed" }));
        const scope = { kind: binding.id } as AgentScope;
        const initial = binding.initialState(scope);
        await f.t.run((ctx) =>
            ctx.db.patch(f.missionId, {
                definitionId: binding.id,
                definitionVersion: binding.version,
                scope,
                state: initial.state,
                obligations: initial.obligations,
            }),
        );
        return { ...f, generation: 1 };
    }
    const f = await seedInspectedEvidence();
    vi.stubEnv("E2E_FIXTURES_ENABLED", "true");
    vi.stubEnv("CONVEX_CLOUD_URL", "http://127.0.0.1:3210");
    await f.t.run((ctx) =>
        ctx.db.patch(f.invitationId, { slotKey: "analyst-4" }),
    );
    const contextId = await f.t.mutation(
        internal.runWorkspace.openBrowserTestContext,
        {
            slotKey: "analyst-4",
            contextKey: "operation-conformance",
            durationMs: 60_000,
        },
    );
    await f.t.run((ctx) =>
        ctx.db.patch(f.runId, {
            purpose: "browser_test",
            browserTestContextId: contextId,
        }),
    );
    let sourcesPreparationId:
        | import("@convex/_generated/dataModel").Id<"sourceSelectionProposalRebuilds">
        | undefined;
    if (binding.id === "sources_v1")
        sourcesPreparationId = await f.t.run(async (ctx) => {
            const run = await ctx.db.get(f.runId);
            if (!run?.sourcePreparationId)
                throw new Error("Missing preparation");
            await ctx.db.patch(f.runId, {
                sourcesProtocol: "sources_mission_v1",
                lifecycleState: "discovering_sources",
            });
            await ctx.db.patch(f.corpusRevisionId, { status: "draft" });
            await ctx.db.patch(run.sourcePreparationId, {
                status: "started",
                executionGeneration: 4,
                deadlineAt: Date.now() + 60_000,
                leaseExpiresAt: Date.now() + 60_000,
            });
            await initializeSources(ctx, run.sourcePreparationId, {
                version: 1,
                maxNeeds: 12,
                initialSearches: 4,
                complementSearches: 3,
                acquisitions: 10,
                controls: 20,
            });
            return run.sourcePreparationId;
        });
    const scope: AgentScope =
        binding.id === "sources_v1" && sourcesPreparationId
            ? { kind: "sources_v1", preparationId: sourcesPreparationId }
            : binding.id === "saved_material_inspection_v1"
              ? { kind: binding.id, corpusRevisionId: f.corpusRevisionId }
              : { kind: "execution_validation_v1", values: [3, 7] };
    const missionId = await f.t.mutation(internal.execution.missions.start, {
        runId: f.runId,
        expectedGeneration: 4,
        definitionId: binding.id,
        scope,
        requestKey: "conformance",
    });
    return { ...f, missionId, generation: 4 };
}

test.each(
    registeredAgentDefinitions().map((binding) => ({
        name: `${binding.id}@${binding.version}`,
        binding,
    })),
)("$name obeys shared refusal, replay, capacity and authority", async ({
    binding,
}) => {
    for (const [name, operation] of Object.entries(commonOperations))
        expect(binding.operations[name]).toBe(operation);
    const f = await fixture(binding);
    const enqueue = (cursor?: string) =>
        f.t.mutation(internal.execution.operations.enqueue, {
            missionId: f.missionId,
            expectedGeneration: f.generation,
            cause: "conformance",
            input: { kind: "consult_mission_state", cursor },
        });
    const begun = await f.t.mutation(internal.execution.invocations.begin, {
        missionId: f.missionId,
        expectedGeneration: f.generation,
        taskKey: "conformance-unknown",
        provenance: "simulation",
        ...(binding.nativeConversation
            ? {
                  nativeInput: await workbenchAdmissionInput(
                      f.t,
                      f.missionId,
                      f.generation,
                  ),
              }
            : {}),
    });
    assert(begun.kind === "ready");
    const invalid = await f.t.mutation(internal.execution.invocations.finish, {
        invocationId: begun.invocationId,
        expectedGeneration: f.generation,
        response: {
            kind: "operations",
            requests: [
                { callId: "invalid", name: "not_registered", inputJson: "{}" },
            ],
        },
    });
    const invalidId = invalid.requestIds[0];
    assert(invalidId);
    expect(await f.t.run((ctx) => ctx.db.get(invalidId))).toMatchObject({
        status: "completed",
        outcome: { kind: "refused", code: "invalid_operation_input" },
    });
    expect(
        await f.t.action(internal.execution.operations.dispatch, {
            requestId: invalidId,
            expectedGeneration: f.generation,
        }),
    ).toEqual({ kind: "refused", code: "invalid_operation_input" });
    const requestId = await enqueue("history:invalid");
    const dispatch = (id: typeof requestId) =>
        f.t.action(internal.execution.operations.dispatch, {
            requestId: id,
            expectedGeneration: f.generation,
        });
    const refused = await dispatch(requestId);
    expect(refused).toEqual({
        kind: "refused",
        code: "history_cursor_invalid",
    });
    expect(
        await f.t.mutation(internal.execution.operations.recordResult, {
            requestId,
            expectedGeneration: f.generation,
            outcome: refused,
        }),
    ).toEqual(refused);
    expect(
        (await f.t.run((ctx) => ctx.db.get(f.missionId)))?.progressKeys,
    ).toEqual([]);
    const validId = await enqueue();
    const success = await dispatch(validId);
    assert(success.kind === "success");
    const retained = await f.t.run((ctx) => ctx.db.get(validId));
    assert(retained?.historyRead);
    const count = (await f.t.run((ctx) => ctx.db.get(f.missionId)))
        ?.progressKeys.length;
    expect(await dispatch(validId)).toEqual(success);
    expect(
        (await f.t.run((ctx) => ctx.db.get(f.missionId)))?.progressKeys,
    ).toHaveLength(count ?? -1);
    const domainOperation = Object.values(binding.operations).find(
        (operation) =>
            operation !== commonOperations.consult_mission_state &&
            operation !== commonOperations.consult_conversation &&
            operation !== commonOperations.consult_run_state,
    );
    assert(domainOperation);
    expect(() =>
        validateOperationExecutionResult(
            domainOperation,
            { outcome: success, historyRead: retained.historyRead },
            "domain_operation",
        ),
    ).toThrow("operation_contract_invalid");
    await f.t.run((ctx) =>
        ctx.db.patch(f.missionId, {
            progressKeys: Array.from(
                { length: 256 },
                (_, i) => `existing:${i}`,
            ),
        }),
    );
    const capacityId = await enqueue();
    expect((await dispatch(capacityId)).kind).toBe("success");
    expect(await f.t.run((ctx) => ctx.db.get(capacityId))).toMatchObject({
        adoptionRefusalCode: "context_capacity",
    });
    await f.t.run(async (ctx) => {
        await ctx.db.patch(f.missionId, {
            status: "ready",
            blockCode: undefined,
        });
        await ctx.db.patch(f.visitorId, { status: "revoked" });
    });
    expect(await dispatch(validId)).toEqual({
        kind: "refused",
        code: "not_authorized",
    });
});

test("registration rejects a definition overriding common operations", () => {
    const definition = registeredAgentDefinitions()[0];
    assert(definition);
    expect(() =>
        bindAgentDefinition({
            ...definition,
            operations: {
                consult_run_state: commonOperations.consult_run_state,
            },
        }),
    ).toThrow("operation_definition_conflict");
});

test("all current bindings install one autonomous recovery method and one rendering contract", () => {
    for (const definition of registeredAgentDefinitions()) {
        expect(
            definition.instructions.split(agentMethodInstructions),
        ).toHaveLength(2);
        expect(
            definition.instructions.split(separatedContextInstructions),
        ).toHaveLength(definition.contextRendering === "separated_v1" ? 2 : 1);
        expect(definition.compactionInstructions).toContain(
            "exact observation references",
        );
        expect(
            definition.operations.consult_mission_state?.inputValidator,
        ).toHaveProperty("fields.reference");
    }
});
