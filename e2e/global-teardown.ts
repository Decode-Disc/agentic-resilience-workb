import { rmSync } from "node:fs";
import type { FullConfig } from "@playwright/test";

import { workerSlotsFilePath } from "./support/browser-workspace";
import { runConvexJson, setConvexEnvironment } from "./support/convex-admin";

export default async function globalTeardown(_config: FullConfig) {
    await runConvexJson("invitations:syncE2EWorkerSlots", { slots: [] });
    const slotsPath = workerSlotsFilePath();
    if (slotsPath) rmSync(slotsPath, { force: true });
    await setConvexEnvironment({
        E2E_FIXTURES_ENABLED: null,
        E2E_MODEL_METADATA_FIXTURE: null,
    });
}
