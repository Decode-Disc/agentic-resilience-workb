import { expect, test } from "vitest";

import {
    CONVEX_CLI_ERROR,
    type ConvexCliExecutor,
    runConvexCli,
    runConvexJson,
} from "../../../e2e/support/convex-cli";

const MARKER_SECRET = "pepper-7f3c9a1b-supersecret";

function thrownLeakage(error: unknown): { message: string; stack: string } {
    expect(error).toBeInstanceOf(Error);
    const typed = error as Error;
    return { message: typed.message, stack: typed.stack ?? "" };
}

function assertSecretFree(error: unknown) {
    const { message, stack } = thrownLeakage(error);
    // The marker secret, the command, argv, and any captured output must never
    // appear in the outer message, stack, or serialized form.
    expect(message).not.toContain(MARKER_SECRET);
    expect(message).not.toContain("pnpm");
    expect(message).not.toContain("convex");
    expect(stack).not.toContain(MARKER_SECRET);
    expect(JSON.stringify({ message, stack })).not.toContain(MARKER_SECRET);
}

test("nonzero CLI exit with a secret on stderr throws a constant sanitized error", () => {
    const executor: ConvexCliExecutor = () => ({
        status: 1,
        stdout: "partial output",
        stderr: `error: invalid ${MARKER_SECRET}`,
    });

    const error = (() => {
        try {
            runConvexCli(
                ["env", "set", "INVITATION_CODE_PEPPER", MARKER_SECRET],
                executor,
            );
            throw new Error("expected runConvexCli to throw");
        } catch (caught) {
            return caught;
        }
    })();

    expect((error as Error).message).toBe(CONVEX_CLI_ERROR);
    assertSecretFree(error);
});

test("spawn error carries no command, args, or secret into the outer error", () => {
    const executor: ConvexCliExecutor = () => ({
        status: null,
        stdout: null,
        stderr: null,
        error: new Error(
            `spawn pnpm ENOENT -- argv contained ${MARKER_SECRET}`,
        ),
    });

    const error = (() => {
        try {
            runConvexJson(
                "e2eFixtures:inspectEvidenceMatrixScenario",
                {
                    runId: "j3x",
                    fixtureKey: `secret=${MARKER_SECRET}`,
                },
                executor,
            );
            throw new Error("expected runConvexJson to throw");
        } catch (caught) {
            return caught;
        }
    })();

    expect((error as Error).message).toBe(CONVEX_CLI_ERROR);
    assertSecretFree(error);
});

test("missing stdout throws a constant sanitized error", () => {
    const executor: ConvexCliExecutor = () => ({
        status: 0,
        stdout: null,
        stderr: `secret leak line: ${MARKER_SECRET}`,
    });

    const error = (() => {
        try {
            runConvexCli(
                ["run", "some:function", "{}", "--deployment", "local"],
                executor,
            );
            throw new Error("expected runConvexCli to throw");
        } catch (caught) {
            return caught;
        }
    })();

    expect((error as Error).message).toBe(CONVEX_CLI_ERROR);
    assertSecretFree(error);
});

test("invalid JSON output is sanitized without stdout or original parse error", () => {
    const executor: ConvexCliExecutor = () => ({
        status: 0,
        stdout: `not json at all ${MARKER_SECRET}`,
        stderr: "",
    });

    const error = (() => {
        try {
            runConvexJson(
                "e2eFixtures:seedEvidenceMatrixScenario",
                {
                    slotKey: "analyst-1",
                    fixtureKey: `key=${MARKER_SECRET}`,
                    scenarioKind: "showcase",
                },
                executor,
            );
            throw new Error("expected runConvexJson to throw");
        } catch (caught) {
            return caught;
        }
    })();

    expect((error as Error).message).toBe(CONVEX_CLI_ERROR);
    assertSecretFree(error);
});

test("successful output behavior is preserved for both helpers", () => {
    const executor: ConvexCliExecutor = (args) => ({
        status: 0,
        stdout:
            args[0] === "run" ? '  {"runId":"run-abc","sourceIds":[]}  ' : "",
        stderr: "checked setting up",
    });

    expect(
        runConvexCli(["env", "set", "E2E_FIXTURES_ENABLED", "true"], executor),
    ).toBe("");
    expect(
        runConvexJson<{ runId: string; sourceIds: Array<string> }>(
            "e2eFixtures:seedEvidenceMatrixScenario",
            {
                slotKey: "analyst-1",
                fixtureKey: "ok",
                scenarioKind: "showcase",
            },
            executor,
        ),
    ).toEqual({ runId: "run-abc", sourceIds: [] });
});
