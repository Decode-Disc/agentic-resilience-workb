import { expect, test } from "vitest";

import {
    CONVEX_ADMIN_ERROR,
    type ConvexAdminExecutor,
    runConvexJson,
    setConvexEnvironment,
} from "../../../e2e/support/convex-admin";

const MARKER_SECRET = "pepper-7f3c9a1b-supersecret";

async function rejection(work: Promise<unknown>): Promise<Error> {
    try {
        await work;
    } catch (caught) {
        expect(caught).toBeInstanceOf(Error);
        return caught as Error;
    }
    throw new Error("expected the admin request to reject");
}

function expectSanitized(error: Error) {
    // The marker secret, the function path, arguments and any response must
    // never appear in the outer message, stack, or serialized form.
    expect(error.message).toBe(CONVEX_ADMIN_ERROR);
    expect(error.cause).toBeUndefined();
    const serialized = JSON.stringify({
        message: error.message,
        stack: error.stack ?? "",
    });
    expect(serialized).not.toContain(MARKER_SECRET);
    expect(serialized).not.toContain("e2eFixtures");
    expect(serialized).not.toContain("INVITATION_CODE_PEPPER");
}

test("a failed environment update with a secret in its error rejects with the constant sanitized error", async () => {
    const executor: ConvexAdminExecutor = async () => {
        throw new Error(`invalid INVITATION_CODE_PEPPER=${MARKER_SECRET}`);
    };

    expectSanitized(
        await rejection(
            setConvexEnvironment(
                { INVITATION_CODE_PEPPER: MARKER_SECRET },
                executor,
            ),
        ),
    );
});

test("a failed function call carries no path, arguments or secret into the outer error", async () => {
    const executor: ConvexAdminExecutor = async (request) => {
        throw new Error(`function failed: ${JSON.stringify(request)}`);
    };

    expectSanitized(
        await rejection(
            runConvexJson(
                "e2eFixtures:inspectEvidenceMatrixScenario",
                { runId: "j3x", fixtureKey: `secret=${MARKER_SECRET}` },
                executor,
            ),
        ),
    );
});

test("successful requests return the function value and forward environment changes", async () => {
    const requests: Array<Parameters<ConvexAdminExecutor>[0]> = [];
    const executor: ConvexAdminExecutor = async (request) => {
        requests.push(request);
        return request.kind === "function"
            ? { runId: "run-abc", sourceIds: [] }
            : null;
    };

    await setConvexEnvironment(
        { E2E_FIXTURES_ENABLED: "true", STALE: null },
        executor,
    );
    expect(
        await runConvexJson<{ runId: string; sourceIds: Array<string> }>(
            "e2eFixtures:seedEvidenceMatrixScenario",
            { slotKey: "analyst-1", fixtureKey: "ok" },
            executor,
        ),
    ).toEqual({ runId: "run-abc", sourceIds: [] });
    expect(requests).toEqual([
        {
            kind: "environment",
            changes: [
                { name: "E2E_FIXTURES_ENABLED", value: "true" },
                { name: "STALE", value: null },
            ],
        },
        {
            kind: "function",
            path: "e2eFixtures:seedEvidenceMatrixScenario",
            args: { slotKey: "analyst-1", fixtureKey: "ok" },
        },
    ]);
});
