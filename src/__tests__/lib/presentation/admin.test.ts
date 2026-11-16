import type { Id } from "@convex/_generated/dataModel";
import { expect, test } from "vitest";
import {
    type AdminAttentionFacts,
    adminAttention,
    adminModelStatus,
    adminRecentSpend,
} from "@/lib/presentation/admin";
import {
    adminSearch,
    adminSectionSearch,
} from "@/lib/workspace/admin-navigation";

const prepared = {
    _id: "glm" as Id<"modelCatalog">,
    label: "GLM-5.3-Flash",
    status: "ready" as const,
    enabled: true,
    compatible: true,
};

const facts = (
    patch: Partial<AdminAttentionFacts> = {},
): AdminAttentionFacts => ({
    paidWorkEnabled: true,
    models: [prepared],
    assignments: [
        { agent: "workbench", catalogId: "glm" as Id<"modelCatalog"> },
    ],
    agents: [
        { agent: "workbench", label: "Workbench", implemented: true },
        { agent: "synthesis", label: "Synthesis", implemented: false },
    ],
    restorableCount: 0,
    recentRuns: [],
    ...patch,
});

test("nothing needs attention on a healthy deployment", () => {
    expect(adminAttention(facts())).toEqual([]);
});

test("each accepted condition raises one item, in priority order", () => {
    const items = adminAttention(
        facts({
            paidWorkEnabled: false,
            models: [{ ...prepared, compatible: false }],
            restorableCount: 2,
            recentRuns: [
                {
                    runId: "run-1" as Id<"researchRuns">,
                    companyLegalName: "ServiceNow, Inc.",
                    executionStatus: "failed",
                    withdrawnAt: undefined,
                },
                {
                    runId: "run-2" as Id<"researchRuns">,
                    companyLegalName: "Adobe Inc.",
                    executionStatus: "running",
                    withdrawnAt: undefined,
                },
                {
                    runId: "run-3" as Id<"researchRuns">,
                    companyLegalName: "Withdrawn Co.",
                    executionStatus: "failed",
                    withdrawnAt: 1,
                },
            ],
        }),
    );
    expect(items.map((item) => item.kind)).toEqual([
        "paid_work",
        "model",
        "dossier",
        "reservations",
    ]);
    expect(items[1]).toMatchObject({
        title: "GLM-5.3-Flash needs an update",
        action: { kind: "refresh_model", catalogId: "glm" },
    });
    expect(items[1]?.detail).toContain("Workbench Agent");
    expect(items[2]).toMatchObject({
        title: "ServiceNow, Inc. stopped with a failure",
        action: { kind: "open_dossier", runId: "run-1" },
    });
    expect(items[3]?.title).toBe("2 unused reservations can be restored");
    for (const item of items)
        expect(`${item.title} ${item.detail}`).not.toMatch(/_|compatible/);
});

test("only models used by connected agents raise an item", () => {
    expect(
        adminAttention(
            facts({
                models: [
                    prepared,
                    {
                        ...prepared,
                        _id: "other" as Id<"modelCatalog">,
                        compatible: false,
                    },
                ],
                assignments: [
                    {
                        agent: "workbench",
                        catalogId: "glm" as Id<"modelCatalog">,
                    },
                    {
                        agent: "synthesis",
                        catalogId: "other" as Id<"modelCatalog">,
                    },
                ],
            }),
        ),
    ).toEqual([]);
    const [item] = adminAttention(
        facts({ models: [{ ...prepared, enabled: false }] }),
    );
    expect(item).toMatchObject({
        kind: "model",
        title: "GLM-5.3-Flash is turned off",
        action: { kind: "open_models" },
    });
});

test("model status has one label per state", () => {
    expect(adminModelStatus(prepared).label).toBe("Ready");
    expect(adminModelStatus({ ...prepared, compatible: false }).label).toBe(
        "Needs update",
    );
    expect(adminModelStatus({ ...prepared, enabled: false }).label).toBe(
        "Turned off",
    );
    expect(adminModelStatus({ ...prepared, status: "preparing" }).label).toBe(
        "Checking",
    );
    expect(adminModelStatus({ ...prepared, status: "failed" }).label).toBe(
        "Check failed",
    );
});

test("recent spend separates confirmed cost from unconfirmed and failed attempts", () => {
    expect(
        adminRecentSpend(
            [
                {
                    status: "succeeded",
                    reportedCost: 0.02,
                    billing: undefined,
                    createdAt: 1_000_000,
                },
                { status: "failed", reportedCost: 0.01, billing: undefined },
                {
                    status: "succeeded",
                    billing: { state: "checking" } as never,
                    reportedCost: undefined,
                },
                {
                    status: "succeeded",
                    reportedCost: undefined,
                    billing: undefined,
                    createdAt: 1_000_000 - 2 * 24 * 60 * 60 * 1000,
                },
            ],
            1_001_000,
        ),
    ).toEqual({
        attempts: 4,
        confirmedCost: 0.03,
        unconfirmed: 1,
        failed: 1,
        lastDay: 1,
    });
});

test("admin search falls back to the overview and keeps a dossier id", () => {
    expect(adminSearch({})).toEqual({});
    expect(adminSearch({ section: "overview" })).toEqual({});
    expect(adminSearch({ section: "unknown", dossier: 4 })).toEqual({});
    expect(adminSearch({ section: "dossiers", dossier: "run-1" })).toEqual({
        section: "dossiers",
        dossier: "run-1",
    });
});

test("admin search keeps a known view of its section and omits defaults", () => {
    expect(adminSearch({ section: "dossiers", view: "reviews" })).toEqual({
        section: "dossiers",
        view: "reviews",
    });
    expect(adminSearch({ section: "dossiers", view: "dossiers" })).toEqual({
        section: "dossiers",
    });
    expect(adminSearch({ section: "models", view: "reviews" })).toEqual({
        section: "models",
    });
    expect(adminSectionSearch("models", "catalogue")).toEqual({
        section: "models",
        view: "catalogue",
    });
    expect(adminSectionSearch("models", "agents")).toEqual({
        section: "models",
    });
});
