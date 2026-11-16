/// <reference types="node" />

import { expect, type Page, type Request } from "@playwright/test";
import type { internal } from "@convex/_generated/api";
import type { FunctionArgs, FunctionReturnType } from "convex/server";

import { openAdmitted } from "./admission";
import {
    bindBrowserTestContext,
    workerSlotAccessCode,
} from "./browser-workspace";
import { runConvexJson } from "./convex-admin";

export type SourceReviewSnapshot = FunctionReturnType<
    typeof internal.e2eFixtures.inspectSourceReviewScenario
>;

type SeededSourceReview = {
    runId: string;
    corpusRevisionId: string;
    proposalId: string;
    proposalVersion: number;
    sourceIds: Array<string>;
};

const externalImageFixtureRequests = new WeakSet<Request>();

/** Identifies exact requests fulfilled by this fixture, without allowing a host's real network traffic. */
export function isExternalImageFixtureRequest(request: Request) {
    return externalImageFixtureRequests.has(request);
}

/** Uses deterministic external image fixtures before real local authentication and admission. */
export async function admitAnalyst(page: Page): Promise<void> {
    // Dossier URL metadata stays inside the test browser instead of reaching the image proxy.
    await page.route("https://api.poly.io/og**", (route) => {
        externalImageFixtureRequests.add(route.request());
        return route.fulfill({
            headers: { "access-control-allow-origin": "*" },
            json: {
                ok: true,
                imageOk: true,
                imageUrl:
                    "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg'/%3E",
            },
        });
    });
    await page.route("https://www.google.com/s2/favicons**", (route) => {
        externalImageFixtureRequests.add(route.request());
        return route.fulfill({
            contentType: "image/svg+xml",
            body: '<svg xmlns="http://www.w3.org/2000/svg"/>',
        });
    });
    await openAdmitted(page, {
        code: workerSlotAccessCode("analyst").code,
        path: "/workspace/dossiers",
        admitted: page.getByRole("heading", { name: "Dossiers", exact: true }),
    });
    await expect(page).toHaveURL(/\/workspace\/dossiers$/);
    await bindBrowserTestContext(page);
}

export function seedSourceReview(
    fixtureKey: string,
    recoveryScenario = false,
    recordedScenario?: FunctionArgs<
        typeof internal.e2eFixtures.seedSourceReviewScenario
    >["recordedScenario"],
): Promise<SeededSourceReview> {
    return runConvexJson<SeededSourceReview>(
        "e2eFixtures:seedSourceReviewScenario",
        {
            slotKey: workerSlotAccessCode("analyst").slotKey,
            fixtureKey,
            ...(recoveryScenario ? { recoveryScenario: true } : {}),
            ...(recordedScenario ? { recordedScenario } : {}),
        },
    );
}

export function inspectSourceReview(
    runId: string,
    fixtureKey: string,
): Promise<SourceReviewSnapshot> {
    return runConvexJson<SourceReviewSnapshot>(
        "e2eFixtures:inspectSourceReviewScenario",
        { runId, fixtureKey },
    );
}
