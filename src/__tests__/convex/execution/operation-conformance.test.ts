import { internal } from "@convex/_generated/api";
import { savedMaterialBinding } from "@convex/domain/savedMaterialOperations";
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
import { readFramingCitationPolicy } from "@convex/framingCitationPolicy";
import { retainedMethodVersion } from "@convex/qualificationAgentMethods";
import { afterEach, assert, expect, test, vi } from "vitest";
import { seedHistoryMission } from "@/__tests__/setup/execution-history";
import { admitMethodComparison } from "@/__tests__/setup/qualification-method-comparison";
import { seedInspectedEvidence } from "@/__tests__/setup/source-preparation";
import { workbenchAdmissionInput } from "@/__tests__/setup/workbench";

afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    vi.useRealTimers();
});

/** Conformance starts from an active mission; seed its immutable owning campaign. */
async function comparisonAuthority(
    f:
        | Awaited<ReturnType<typeof seedHistoryMission>>
        | Awaited<ReturnType<typeof seedInspectedEvidence>>,
    binding: AgentDefinition,
) {
    if (
        (binding.id !== "workbench_v1" && binding.id !== "sources_v1") ||
        binding.version !== retainedMethodVersion(binding.id)
    )
        return;
    const lot = await admitMethodComparison(f.t, f.runId);
    await f.t.run((ctx) =>
        ctx.db.patch(lot.contextId, {
            simulatedScenarios: [{ id: lot.scenarioId, runId: f.runId }],
        }),
    );
}

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
        if (
            binding.id === "workbench_v1" &&
            savedMaterialBinding(binding.id, binding.version) === "referenced"
        )
            await f.t.run(async (ctx) => {
                const mission = await ctx.db.get(f.missionId);
                assert(mission?.conversationTurnId);
                await ctx.db.patch(mission.conversationTurnId, {
                    framingCitationPolicy: await readFramingCitationPolicy(ctx),
                });
            });
        await comparisonAuthority(f, binding);
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
    await comparisonAuthority(f, binding);
    const missionId = await f.t.mutation(internal.execution.missions.start, {
        runId: f.runId,
        expectedGeneration: 4,
        definitionId: binding.id,
        scope,
        requestKey: "conformance",
    });
    await f.t.run((ctx) =>
        ctx.db.patch(missionId, { definitionVersion: binding.version }),
    );
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
    const stateRequestId = await f.t.mutation(
        internal.execution.operations.enqueue,
        {
            missionId: f.missionId,
            expectedGeneration: f.generation,
            cause: "common-state-conformance",
            input: { kind: "consult_run_state" },
        },
    );
    const stateResult = await f.t.action(
        internal.execution.operations.dispatch,
        { requestId: stateRequestId, expectedGeneration: f.generation },
    );
    assert(stateResult.kind === "success");
    const state = JSON.parse(stateResult.valueJson);
    expect(state.research).toMatchObject({
        executionGeneration: expect.any(Number),
        actions: {
            resume: { applicable: expect.any(Boolean) },
            usePrepared: { applicable: expect.any(Boolean) },
        },
        approvals: { pending: expect.any(Array), grants: expect.any(Array) },
    });
    expect(state.research).not.toHaveProperty("passages");
    expect(stateResult.valueJson).not.toMatch(
        /protectedDiagnostic|providerException|hiddenReasoning|passageBody/,
    );
    const enqueue = (cursor?: string) =>
        f.t.mutation(internal.execution.operations.enqueue, {
            missionId: f.missionId,
            expectedGeneration: f.generation,
            cause: "conformance",
            input: { kind: "consult_mission_state", cursor },
        });
    const initialProgress = (await f.t.run((ctx) => ctx.db.get(f.missionId)))
        ?.progressKeys;
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
    ).toEqual(initialProgress);
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

test("Phase 4 defaults activate native_tool versions while retaining historical definitions and documentary bindings", async () => {
    const { getAgentDefinition } = await import(
        "@convex/execution/agentCatalog"
    );
    const { SUBMIT_COMPLETION_TOOL, agentToolSchemas } = await import(
        "@convex/execution/agentDefinition"
    );
    // Latest defaults use native_tool completion; Workbench remains textCompletion v12.
    expect(getAgentDefinition("sources_v1")).toMatchObject({
        version: 8,
        completionTransport: "native_tool",
    });
    expect(getAgentDefinition("saved_material_inspection_v1")).toMatchObject({
        version: 4,
        completionTransport: "native_tool",
    });
    expect(getAgentDefinition("conversation_validation_v1")).toMatchObject({
        version: 3,
        completionTransport: "native_tool",
    });
    expect(getAgentDefinition("execution_validation_v1")).toMatchObject({
        version: 3,
        completionTransport: "native_tool",
    });
    const workbench = getAgentDefinition("workbench_v1");
    expect(workbench.version).toBe(12);
    expect(workbench.completionTransport).toBeUndefined();
    expect(typeof workbench.textCompletion).toBe("function");

    // Historical versions remain explicitly resolvable without native_tool completion.
    for (const [id, version] of [
        ["sources_v1", 7],
        ["saved_material_inspection_v1", 3],
        ["conversation_validation_v1", 2],
        ["execution_validation_v1", 2],
    ] as const) {
        const historical = getAgentDefinition(id, version);
        expect(historical.version).toBe(version);
        expect(historical.completionTransport).toBeUndefined();
        expect(agentToolSchemas(historical)).not.toHaveProperty(
            SUBMIT_COMPLETION_TOOL,
        );
    }

    // Documentary bindings grant referenced operations to new versions without broadening historical legacy versions.
    expect(savedMaterialBinding("sources_v1", 8)).toBe("referenced");
    expect(savedMaterialBinding("sources_v1", 7)).toBe("referenced");
    expect(savedMaterialBinding("sources_v1", 5)).toBe("legacy");
    expect(savedMaterialBinding("saved_material_inspection_v1", 4)).toBe(
        "referenced",
    );
    expect(savedMaterialBinding("saved_material_inspection_v1", 3)).toBe(
        "referenced",
    );
    expect(savedMaterialBinding("saved_material_inspection_v1", 2)).toBe(
        "legacy",
    );

    // Reserved name collisions and contradictory capabilities are rejected without any allowlist bypass.
    const latestInspection = getAgentDefinition("saved_material_inspection_v1");
    expect(agentToolSchemas(latestInspection)).toHaveProperty(
        SUBMIT_COMPLETION_TOOL,
    );
    expect(() =>
        bindAgentDefinition({
            ...workbench,
            completionTransport: "native_tool",
        }),
    ).toThrow("definition_contract_invalid");
    expect(() =>
        bindAgentDefinition({
            ...latestInspection,
            operations: {
                [SUBMIT_COMPLETION_TOOL]: commonOperations.consult_run_state,
            },
        }),
    ).toThrow("operation_definition_conflict");
});

test("native completion cannot be bound to a native conversation", async () => {
    const { getAgentDefinition } = await import(
        "@convex/execution/agentCatalog"
    );
    expect(() =>
        bindAgentDefinition({
            ...getAgentDefinition("saved_material_inspection_v1"),
            executionScope: "conversation",
            conversationReply: () => "",
            nativeConversation: true,
        }),
    ).toThrow("definition_contract_invalid");
});

test("non-Pi backends resolve retained inspection definitions", async () => {
    const { defaultDefinitionVersionForBackend } = await import(
        "@convex/execution/agentCatalog"
    );
    const {
        HISTORICAL_AGENT_BACKEND,
        LEGACY_AGENT_BACKEND,
        DEFAULT_AGENT_BACKEND,
    } = await import("@convex/execution/executionProtocol");
    for (const backend of [HISTORICAL_AGENT_BACKEND, LEGACY_AGENT_BACKEND]) {
        expect(
            defaultDefinitionVersionForBackend(
                "saved_material_inspection_v1",
                backend,
            ),
        ).toBe(3);
        const f = await seedInspectedEvidence();
        const missionId = await f.t.mutation(
            internal.execution.missions.start,
            {
                runId: f.args.runId,
                corpusRevisionId: f.args.corpusRevisionId,
                definitionId: "saved_material_inspection_v1",
                expectedGeneration: 4,
                requestKey: `retained:${backend.id}`,
                generationBackend: backend,
            },
        );
        expect(
            (await f.t.run((ctx) => ctx.db.get(missionId)))?.definitionVersion,
        ).toBe(3);
    }
    expect(
        defaultDefinitionVersionForBackend(
            "saved_material_inspection_v1",
            DEFAULT_AGENT_BACKEND,
        ),
    ).toBe(4);
});

test("an explicitly pinned native-tool conversation refuses a historical backend", async () => {
    const { seedConversation } = await import(
        "@/__tests__/setup/agent-harness"
    );
    const { HISTORICAL_AGENT_BACKEND } = await import(
        "@convex/execution/executionProtocol"
    );
    const f = await seedConversation(true);
    await f.client.mutation(
        (await import("@convex/_generated/api")).api.execution.conversations
            .submit,
        {
            runId: f.runId,
            requestKey: "pinned-native",
            text: "Inspect the current request",
            delivery: "queue",
        },
    );
    const turnId = await f.t.mutation(
        internal.execution.conversations.claimTurn,
        { runId: f.runId },
    );
    assert(turnId);
    await f.t.run(async (ctx) => {
        const turn = await ctx.db.get(turnId);
        assert(turn);
        await ctx.db.patch(turn.conversationId, {
            definitionId: "conversation_validation_v1",
            definitionVersion: 3,
        });
    });
    await expect(
        f.t.mutation(internal.execution.missions.start, {
            runId: f.runId,
            conversationTurnId: turnId,
            definitionId: "conversation_validation_v1",
            scope: { kind: "conversation_validation_v1" },
            requestKey: "pinned-native-historical",
            expectedGeneration: 1,
            generationBackend: HISTORICAL_AGENT_BACKEND,
        }),
    ).rejects.toThrow("definition_contract_invalid");
});
