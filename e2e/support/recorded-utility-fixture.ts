import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { internal } from "@convex/_generated/api";
import type { TestInfo } from "@playwright/test";
import type { FunctionReturnType } from "convex/server";

type UtilityDefinition = {
    id: string;
    companyId: string;
    kind: string;
    researchAngle: string;
    suppliedDocumentId: string | null;
    mobile: boolean;
};
export type UtilityScenario = UtilityDefinition & {
    viewport: "desktop" | "mobile";
};
export type RecordedUtilityScenario = UtilityScenario &
    FunctionReturnType<typeof internal.e2eFixtures.seedRecordedSourceReview> & {
        companyName: string;
        fixtureKey: string;
        snapshot: FunctionReturnType<
            typeof internal.e2eFixtures.inspectRecordedSourceReview
        >;
    };
const catalog = JSON.parse(
    readFileSync(
        "scripts/evaluations/source-selection/fixtures/cross-company-20261020/utility-scenarios-v2.json",
        "utf8",
    ),
) as { basis: string; historicalModel: string; scenarios: UtilityDefinition[] };

/** Historical manifests select scenario definitions only; stored database IDs never cross into a new context. */
export function recordedUtilityScenarios(): UtilityScenario[] {
    if (!process.env.UTILITY_SEEDED_FILE)
        return catalog.scenarios.flatMap((scenario) =>
            (scenario.mobile
                ? (["desktop", "mobile"] as const)
                : (["desktop"] as const)
            ).map((viewport) => ({ ...scenario, viewport })),
        );
    const archived = JSON.parse(
        readFileSync(process.env.UTILITY_SEEDED_FILE, "utf8"),
    ) as Array<Record<string, unknown>>;
    return archived.map((record) => {
        const definition = catalog.scenarios.find(
            (scenario) => scenario.id === record.id,
        );
        if (
            !definition ||
            (record.viewport !== "desktop" && record.viewport !== "mobile")
        )
            throw new Error("Unknown recorded utility scenario or viewport");
        return {
            ...definition,
            researchAngle:
                typeof record.researchAngle === "string"
                    ? record.researchAngle
                    : definition.researchAngle,
            viewport: record.viewport,
        };
    });
}

/** Replays exact archived inputs through the guarded producer after real admission, into this test's output directory. */
export function seedRecordedUtilityScenario(
    scenario: UtilityScenario,
    info: TestInfo,
): RecordedUtilityScenario {
    const output = info.outputPath("recorded-scenario");
    const definitions = info.outputPath("utility-definition.json");
    writeFileSync(
        definitions,
        JSON.stringify({ ...catalog, scenarios: [scenario] }),
        { flag: "wx" },
    );
    const result = spawnSync(
        process.execPath,
        [
            "--experimental-strip-types",
            "scripts/evaluations/source-selection/source-utility.ts",
            "--phase",
            "seed",
            "--out-dir",
            output,
            "--scenarios",
            definitions,
            "--scenario",
            scenario.id,
            "--viewport",
            scenario.viewport,
        ],
        {
            encoding: "utf8",
            stdio: ["ignore", "pipe", "pipe"],
            timeout: 60_000,
        },
    );
    if (result.error || result.status !== 0)
        throw new Error("Recorded utility fixture preparation failed");
    const seeded = JSON.parse(
        readFileSync(join(output, "seeded.json"), "utf8"),
    ) as RecordedUtilityScenario[];
    const current = seeded[0];
    if (
        seeded.length !== 1 ||
        current?.id !== scenario.id ||
        current.viewport !== scenario.viewport ||
        current.snapshot.providerCalls !== 0
    )
        throw new Error(
            "Recorded utility fixture result does not match the requested scenario",
        );
    return current;
}
