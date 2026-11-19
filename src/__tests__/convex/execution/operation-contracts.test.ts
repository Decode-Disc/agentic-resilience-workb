import { internal } from "@convex/_generated/api";
import {
    assertOperationContract,
    registeredAgentDefinitions,
} from "@convex/execution/agentCatalog";
import { commonOperations } from "@convex/execution/commonOperations";
import {
    type AgentOperationDefinition,
    validateOperationExecutionResult,
} from "@convex/execution/executionProtocol";
import { commonOperationSuccessValidator } from "@convex/execution/operationContracts";
import { validate } from "convex-helpers/validators";
import { afterEach, expect, expectTypeOf, test, vi } from "vitest";
import { seedHistoryMission } from "@/__tests__/setup/execution-history";

afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    vi.useRealTimers();
});

test("every_registered_binding_has_an_effect_contract", () => {
    const bindings = registeredAgentDefinitions();
    expect(bindings.length).toBeGreaterThanOrEqual(5);
    for (const binding of bindings) {
        for (const operation of Object.values(binding.operations)) {
            expect(operation).toHaveProperty("effectKind");
            expect([
                "read",
                "atomic_effect",
                "durable_effect",
                "delegation",
            ]).toContain(Reflect.get(operation, "effectKind"));
        }
    }
});

test("only_delegation_declares_a_child_mission", () => {
    for (const binding of registeredAgentDefinitions()) {
        for (const operation of Object.values(binding.operations)) {
            expect(typeof operation.childMission === "function").toBe(
                operation.effectKind === "delegation",
            );
        }
    }
    const read = commonOperations.consult_run_state;
    expect(() =>
        Reflect.apply(assertOperationContract, undefined, [
            "bad",
            { ...read, childMission: () => ({}) },
        ]),
    ).toThrow("operation_contract_invalid");
    const { effectKind: _effectKind, ...missing } = read;
    // @ts-expect-error Every operation must classify its actual effects.
    const unclassified: AgentOperationDefinition = missing;
    expect(() => assertOperationContract("bad", unclassified)).toThrow(
        "operation_contract_invalid",
    );
});

test("scheduled effects require one valid server-owned action target", () => {
    const scheduled = registeredAgentDefinitions().find(
        (binding) => binding.id === "sources_v1",
    )?.operations.submit_documentary_qualification;
    expect(scheduled?.scheduledAction).toBeDefined();
    for (const invalid of [
        { ...scheduled, scheduledAction: {} },
        { ...scheduled, execute: commonOperations.consult_run_state.execute },
        {
            ...commonOperations.consult_run_state,
            scheduledAction: scheduled?.scheduledAction,
        },
    ]) {
        expect(() =>
            Reflect.apply(assertOperationContract, undefined, [
                "invalid-target",
                invalid,
            ]),
        ).toThrow("operation_contract_invalid");
    }
});

test("read_cannot_wait_or_receive_mutation_capabilities", async () => {
    const operation = commonOperations.consult_run_state;
    type Read = typeof operation;
    expectTypeOf<Parameters<Read["execute"]>[0]>().not.toHaveProperty(
        "runMutation",
    );
    expectTypeOf<
        Extract<
            Awaited<ReturnType<Read["execute"]>>["outcome"],
            { kind: "waiting" }
        >
    >().toEqualTypeOf<never>();
    expect(() =>
        validateOperationExecutionResult(operation, {
            outcome: { kind: "waiting", reference: "fake" },
        }),
    ).toThrow("operation_contract_invalid");
    expect(() =>
        validateOperationExecutionResult(operation, {
            outcome: { kind: "success" },
        }),
    ).toThrow("operation_contract_invalid");
    const original = { ...operation };
    vi.spyOn(operation, "execute").mockImplementation((ctx, args) => {
        expect(Object.keys(ctx)).toEqual(["runQuery"]);
        return original.execute(ctx, args);
    });
    const f = await seedHistoryMission();
    const requestId = await f.t.mutation(
        internal.execution.operations.enqueue,
        {
            missionId: f.missionId,
            expectedGeneration: 1,
            cause: "capabilities",
            input: { kind: "consult_run_state" },
        },
    );
    expect(
        await f.t.action(internal.execution.operations.dispatch, {
            requestId,
            expectedGeneration: 1,
        }),
    ).toMatchObject({ kind: "success" });
});

test("common_success_does_not_depend_on_inspection_metadata", () => {
    expect(
        validate(commonOperationSuccessValidator, {
            kind: "success",
            valueJson: "{}",
        }),
    ).toBe(true);
    expect(
        validate(commonOperationSuccessValidator, {
            kind: "success",
            valueJson: "{}",
            captureId: "made-up",
        }),
    ).toBe(false);
});
