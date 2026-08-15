import type { FullConfig } from "@playwright/test";

import { runConvexCli } from "./support/convex-cli";

export default async function globalTeardown(_config: FullConfig) {
    runConvexCli([
        "env",
        "remove",
        "E2E_FIXTURES_ENABLED",
        "--deployment",
        "local",
    ]);
}