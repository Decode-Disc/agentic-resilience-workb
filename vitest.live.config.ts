import { configDefaults, defineConfig } from "vitest/config";
import base from "./vitest.config";

if (process.env.RUN_LIVE_PROVIDER_TESTS !== "1") {
    throw new Error(
        "Live provider checks were not run. RUN_LIVE_PROVIDER_TESTS=1 requires explicit authorization for the selected checks and their external costs.",
    );
}

export default defineConfig({
    ...base,
    test: {
        ...base.test,
        include: ["src/__tests__/live/**/*.contract.test.ts"],
        exclude: [...configDefaults.exclude],
    },
});
