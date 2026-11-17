import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
    configuredPositiveInteger,
    CONVEX_NODE_ACTION_TIMEOUT_MS,
    MODEL_SETTLEMENT_GRACE_MS,
    nodeActionGenerationDeadline,
    resolveGenerationAuthority,
    RESOURCE_POLICY_VERSION,
    resolvePreparationModelLimits,
    resolvePreviewCacheTtlMs,
    resolveSourceRecommendedTarget,
} from "@convex/resourcePolicy";
import { syncResourcePolicy } from "@scripts/sync-resource-policy";
import { expect, test } from "vitest";

test("standalone preview policy is generated and stale copies fail read-only parity checks", () => {
    const root = mkdtempSync(join(tmpdir(), "resource-policy-parity-"));
    try {
        expect(() => syncResourcePolicy(root, true)).toThrow("stale");
        syncResourcePolicy(root);
        expect(() => syncResourcePolicy(root, true)).not.toThrow();
        const path = join(
            root,
            "services/playwright-browser/src/resource-policy.generated.json",
        );
        const content = readFileSync(path, "utf8");
        expect(JSON.parse(content)).toMatchObject({
            maxConcurrentRenders: 3,
            renderTimeoutMs: 30000,
            maxTransferredBytes: 33554432,
        });
        writeFileSync(path, "{}\n");
        expect(() => syncResourcePolicy(root, true)).toThrow("stale");
        expect(readFileSync(path, "utf8")).toBe("{}\n");
        syncResourcePolicy(root);
        expect(readFileSync(path, "utf8")).toBe(content);
    } finally {
        rmSync(root, { recursive: true, force: true });
    }
});

test("Node runtime capacity tightens dispatch without renewing its immutable grant", () => {
    const start = 1000;
    const hostDeadline = nodeActionGenerationDeadline(start);
    expect(hostDeadline + MODEL_SETTLEMENT_GRACE_MS).toBe(
        start + CONVEX_NODE_ACTION_TIMEOUT_MS,
    );
    const granted = {
        resourcePolicy: RESOURCE_POLICY_VERSION,
        deadlineAt: hostDeadline + 100_000,
    };
    expect(
        resolveGenerationAuthority(granted, start + 50_000, hostDeadline),
    ).toEqual({
        kind: "ready",
        deadlineAt: hostDeadline,
        timeoutMs: hostDeadline - start - 50_000,
    });
    expect(
        resolveGenerationAuthority(granted, hostDeadline, hostDeadline),
    ).toEqual({ kind: "blocked", code: "node_action_deadline" });
    expect(resolveGenerationAuthority(granted, start, Infinity)).toEqual({
        kind: "blocked",
        code: "node_action_deadline",
    });
    expect(
        resolveGenerationAuthority(
            { ...granted, deadlineAt: start + 10 },
            start,
            hostDeadline,
        ),
    ).toEqual({ kind: "ready", deadlineAt: start + 10, timeoutMs: 10 });
    expect(
        resolveGenerationAuthority(
            { ...granted, deadlineAt: start },
            start,
            hostDeadline,
        ),
    ).toEqual({ kind: "blocked", code: "execution_deadline" });
    expect(granted).toEqual({
        resourcePolicy: RESOURCE_POLICY_VERSION,
        deadlineAt: hostDeadline + 100_000,
    });
});

test("pure configuration resolves the same defaults without a Convex environment", () => {
    expect(resolvePreviewCacheTtlMs(undefined)).toBe(3_600_000);
    expect(resolvePreparationModelLimits()).toEqual({
        work: 120,
        incidents: 40,
    });
    expect(configuredPositiveInteger(undefined, 48, "Candidates")).toBe(48);
});

test("explicit configuration remains scoped to its unit and consumer", () => {
    expect(resolvePreviewCacheTtlMs("2500")).toBe(2500);
    expect(resolvePreparationModelLimits("23", "7")).toEqual({
        work: 23,
        incidents: 7,
    });
    expect(configuredPositiveInteger("17", 48, "Candidates")).toBe(17);
    expect(() => resolvePreviewCacheTtlMs("999")).toThrow("integer >= 1000");
    expect(() => configuredPositiveInteger("201", 48, "Candidates")).toThrow(
        "between 1 and 200",
    );
});

test("preparation recommendation capacity is distinct from initial discovery", () => {
    expect(resolveSourceRecommendedTarget(49, undefined)).toBe(25);
    expect(resolveSourceRecommendedTarget(60, undefined, true)).toBe(24);
    expect(resolveSourceRecommendedTarget(60, "19", true)).toBe(19);
    expect(() => resolveSourceRecommendedTarget(10, "11")).toThrow(
        "must not exceed source candidate limit",
    );
});
