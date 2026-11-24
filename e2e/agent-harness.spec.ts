import { expect } from "@playwright/test";
import type { internal } from "@convex/_generated/api";
import type { FunctionReturnType } from "convex/server";
import { browserTestSlot, test } from "./support/browser-workspace";
import { runConvexJson } from "./support/convex-admin";
import { admitAnalyst } from "./support/source-review-fixture";

type Snapshot = FunctionReturnType<typeof internal.execution.fixtures.inspect>;
test("simulated saved-material continuation remains persisted after page reload", async ({
    page,
}) => {
    test.setTimeout(150_000);
    await page.setViewportSize({ width: 1440, height: 900 });
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => {
        if (message.type() === "error") errors.push(message.text());
    });
    await admitAnalyst(page);
    const key = "pi-agent-harness-desktop";
    const missionId = await runConvexJson<string>("execution/fixtures:start", {
        fixtureKey: key,
        slotKey: browserTestSlot(),
    });
    const inspect = () =>
        runConvexJson<Snapshot>("execution/fixtures:inspect", {
            missionId,
        });
    await expect
        .poll(inspect, { timeout: 90_000 })
        .toMatchObject({ status: "completed" });
    const snapshot = await inspect();
    expect(snapshot.provenance).toBe("simulation");
    expect(snapshot.generationBackends).toEqual(
        Array.from({ length: snapshot.invocationCount }, () => ({
            id: "pi-durable",
            version: 1,
        })),
    );
    expect(snapshot.operations).toEqual([
        "consult_mission_state",
        "search_available_material",
        "read_in_context",
    ]);
    expect(snapshot.outcomes).toEqual(["success", "success", "success"]);
    expect(snapshot.invocationCount).toBe(4);
    expect(snapshot.observedInvocationCount).toBe(4);
    expect(snapshot.contextIncludesReturnedQuotation).toBe(true);
    expect(snapshot.providerCallCount).toBe(0);
    expect(snapshot.completionCount).toBe(1);
    await test.info().attach("simulated-mission.json", {
        body: JSON.stringify(snapshot, null, 2),
        contentType: "application/json",
    });
    await page.reload();
    await expect(
        page.getByRole("heading", { name: "Dossiers", exact: true }),
    ).toBeVisible();
    await expect(page.getByLabel("Access code")).toHaveCount(0);
    expect(await inspect()).toEqual(snapshot);
    expect(errors).toEqual([]);
});
