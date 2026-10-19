// Deterministic protected browser gate for the Phase 5 evidence matrix.
//
// Drives the real local Convex + Vite stack on 127.0.0.1 through anonymous
// auth and a normal analyst-1 invitation admission. Server state is polled
// through the internal e2eFixtures:inspectEvidenceMatrixScenario query and
// then verified reactively in the browser; there are no fixed sleeps, no
// client timers, no localStorage injection, and no --identity impersonation.
//
// Network baseline: the workbench shell renders a google favicon avatar for
// each analyzed company (src/components/favicon-avatar.tsx). That documented
// external host is intercepted below and its requests are aborted so no real
// socket opens and no fake response content is ever injected; the attempted
// host stays recorded. Every other non-127.0.0.1/localhost host fails the test.
import { expect, test, type Page, type Request } from "@playwright/test";

import { admitAnalyst } from "./support/source-review-fixture";
import {
    startSanitizedTrace,
    stopSanitizedTrace,
    stopSanitizedTraceIfActive,
} from "./support/sanitized-trace";
import {
    analystAccessCode,
    inspectEvidenceMatrix,
    seedEvidenceMatrix,
    type EvidenceMatrixScenarioKind,
    type EvidenceMatrixSnapshot,
} from "./support/evidence-matrix-fixture";

const EXHIBIT_PASSAGES = {
    factOne:
        "CCC connects approximately 30,000 repair facilities and 300+ insurance carriers across its workflow network.",
    factTwo:
        "The company processes over 28 million auto physical damage claims annually.",
    counter:
        "OEM direct vehicle telematics could bypass traditional estimating network intermediaries.",
    unknown:
        "Adoption velocity of third-party multi-modal foundation models versus proprietary estimating logic remains undetermined.",
} as const;

type EvidenceGate = {
    issues: Array<string>;
    hosts: Set<string>;
    /** Exact Request objects this gate chose to abort. */
    abortedRequests: WeakSet<Request>;
    initiatedAbortCount: number;
    /** requestfailed events correlated with the exact aborted Requests. */
    matchedAbortFailureCount: number;
    /** Generic console ERR_FAILED noise, counted but never directly discarded. */
    genericResourceFailureCount: number;
};

function fixtureKey(name: string): string {
    return `${name}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

// Documented external baseline only: the google favicon avatar endpoint used by
// the shared FaviconAvatar (source: src/components/favicon-avatar.tsx). All
// requests to that host are aborted, so no external socket opens and no fake
// image response is injected; the attempted host remains explicitly recorded
// in the gate below. Any other external host fails the test.
const ALLOWED_EXTERNAL_HOST = "www.google.com";

// Chromium logs one resource-load failure console error per network request
// that failed (which is exactly what an intentionally aborted favicon is).
const ABORTED_RESOURCE_FAILURE = "Failed to load resource: net::ERR_FAILED";

function attachEvidenceGate(page: Page): EvidenceGate {
    const gate: EvidenceGate = {
        issues: [],
        hosts: new Set<string>(),
        abortedRequests: new WeakSet<Request>(),
        initiatedAbortCount: 0,
        matchedAbortFailureCount: 0,
        genericResourceFailureCount: 0,
    };

    // Abort the documented external baseline instead of fulfilling it so no
    // external socket opens and no fake content is served. The exact Request
    // object is recorded BEFORE the abort so the requestfailed listener can
    // correlate the failure to this specific request and nothing else.
    page.route(`https://${ALLOWED_EXTERNAL_HOST}/**`, async (route) => {
        gate.initiatedAbortCount += 1;
        gate.abortedRequests.add(route.request());
        await route.abort();
    });

    page.on("request", (request) => {
        try {
            // Compare hostnames only: URL.host includes the port (:3000/:3210),
            // which would make exact 127.0.0.1/localhost matching fail.
            gate.hosts.add(new URL(request.url()).hostname);
        } catch {
            gate.hosts.add("unparseable");
        }
    });
    // Only the exact aborted baseline Requests may fail. Every other request
    // failure becomes an explicit issue instead of being swallowed by the
    // generic console allowance.
    page.on("requestfailed", (request) => {
        if (gate.abortedRequests.has(request)) {
            gate.matchedAbortFailureCount += 1;
            return;
        }
        gate.issues.push(`requestfailed: ${request.url()}`);
    });
    page.on("pageerror", (error) => {
        gate.issues.push(`pageerror: ${String(error)}`);
    });
    page.on("console", (message) => {
        try {
            if (message.type() !== "error") {
                return;
            }
            // Generic aborted-resource console noise is counted separately and
            // never directly discarded: the final assertion bounds it against
            // the exact aborted failures it is tracking. Any other console
            // error still fails the gate.
            if (message.text() === ABORTED_RESOURCE_FAILURE) {
                gate.genericResourceFailureCount += 1;
                return;
            }
            gate.issues.push(`console: ${message.text()}`);
        } catch {
            gate.issues.push("console: unreadable");
        }
    });
    return gate;
}

function assertCleanEvidenceGate(gate: EvidenceGate) {
    expect(gate.issues).toEqual([]);
    // Every initiated abort must be accounted for by an exact-Request
    // requestfailed match; unrelated failures cannot be consumed quietly.
    expect(gate.matchedAbortFailureCount).toBe(gate.initiatedAbortCount);
    // Generic aborted-resource console noise can never exceed the number of
    // exact aborted failures it maps to.
    expect(gate.genericResourceFailureCount).toBeLessThanOrEqual(
        gate.matchedAbortFailureCount,
    );
    const unexpected = [...gate.hosts].filter(
        (host) =>
            host !== "127.0.0.1" &&
            host !== "localhost" &&
            host !== ALLOWED_EXTERNAL_HOST,
    );
    expect(unexpected).toEqual([]);
}

// Every test drives the same protected local stack, so the console/network
// gate is attached per page before each test and asserted after it completes.
// Pages are browser-scoped per test, so the WeakMap never leaks state across
// tests, workers, or runs.
const gatesByPage = new WeakMap<Page, EvidenceGate>();

test.beforeEach(async ({ page }) => {
    gatesByPage.set(page, attachEvidenceGate(page));
});

test.afterEach(async ({ page }) => {
    // Stop any credential-safe trace before asserting the network gate so a
    // still-active trace cannot capture admission code from a later failure.
    await stopSanitizedTraceIfActive(page);
    const gate = gatesByPage.get(page);
    if (gate) {
        assertCleanEvidenceGate(gate);
    }
});

/**
 * Polls the server inspector until the scenario reaches its terminal tuple.
 * Showcase reaches evidence_ready + idle; unavailable pauses at
 * claim_generation_unavailable. Both must be zero-provider-call and clear the
 * active workflow handle.
 */
async function waitForEvidenceScenario(
    runId: string,
    fixtureKey: string,
    kind: EvidenceMatrixScenarioKind,
): Promise<EvidenceMatrixSnapshot> {
    const snapshot = kind === "showcase"
        ? {
              lifecycleState: "evidence_ready",
              executionStatus: "idle",
              showcase: true,
              providerCallCount: 0,
              workflowIdPresent: false,
              sourceCount: 1,
              passageCount: 4,
              claimCount: 4,
              policyEvaluationCount: 4,
          }
        : {
              lifecycleState: "extracting_evidence",
              executionStatus: "paused",
              pauseReason: "claim_generation_unavailable",
              showcase: false,
              providerCallCount: 0,
              workflowIdPresent: false,
              sourceCount: 1,
              passageCount: 4,
              claimCount: 0,
              claimStatements: [],
              policyEvaluationCount: 0,
          };
    await expect
        .poll(() => inspectEvidenceMatrix(runId, fixtureKey), {
            // Must stay under the suite's 60s test timeout: the seeded workflow
            // only advances through already-terminal source statuses, so the
            // terminal tuple lands in a few seconds in practice.
            timeout: 45_000,
        })
        .toMatchObject(snapshot);
    return inspectEvidenceMatrix(runId, fixtureKey);
}

/** Seats the real declared analyst admission, then seeds + verifies a scenario. */
async function openEvidence(
    page: Page,
    seedName: string,
    kind: EvidenceMatrixScenarioKind,
): Promise<{ fixtureKey: string; runId: string }> {
    await admitAnalyst(page);
    const key = fixtureKey(seedName);
    const seeded = seedEvidenceMatrix(key, kind);
    const snapshot = await waitForEvidenceScenario(
        seeded.runId,
        key,
        kind,
    );
    await page.goto(`/workspace/${seeded.runId}?section=evidence`);
    if (kind === "showcase") {
        await expect(
            page.getByRole("heading", { name: /CCC Intelligent Solutions/i }),
        ).toBeVisible();
        await expect(page.getByText("Evidence is ready for review")).toBeVisible();
    } else {
        await expect(
            page.getByText("Evidence is temporarily unavailable"),
        ).toBeVisible();
    }
    // The seeded run document is fully loaded (page.goto creates a new
    // document, so no hidden pre-navigation admission state remains) and the
    // initial evidence state is asserted. Credential-bearing admission is
    // long over; only now may sanitized diagnostics run, so the analyst
    // access code can never be captured on traces, videos, or screenshots.
    await startSanitizedTrace(page);
    return { fixtureKey: key, runId: snapshot.runId };
}

test.describe("evidence matrix deterministic browser gate", () => {
    test("showcase reaches persisted evidence_ready and renders the reactive matrix on desktop", async ({
        page,
    }) => {
        await page.setViewportSize({ width: 1440, height: 1000 });
        await openEvidence(page, "showcase-desktop", "showcase");

        // Coverage summary seats after the transition and shows the disclosure.
        await expect(page.getByText("Showcase evidence")).toBeVisible();
        await expect(page.getByText("Claims available")).toBeVisible();
        await expect(page.getByText("Questions covered")).toBeVisible();
        await expect(page.getByText("Sources reviewed")).toBeVisible();

        // Desktop master/detail with a resizable separator.
        await expect(
            page.getByRole("article", { name: /^Claim detail:/ }),
        ).toBeVisible();
        const separator = page.locator('[data-slot="resizable-handle"]');
        await expect(separator).toBeVisible();
        // Resize through the focused separator handle and confirm the layout
        // keeps both master and detail functional.
        await separator.focus();
        await page.keyboard.press("ArrowRight");
        await expect(separator).toBeVisible();
        await expect(
            page.getByRole("article", { name: /^Claim detail:/ }),
        ).toBeVisible();
        await expect(page.getByRole("button", { name: /^Open / })).toHaveCount(4);
    });

    test("classification filter and counter-evidence provenance resolve against seeded claims", async ({
        page,
    }) => {
        await page.setViewportSize({ width: 1440, height: 1000 });
        const { fixtureKey } = await openEvidence(
            page,
            "showcase-filter",
            "showcase",
        );
        void fixtureKey;

        await expect(page.getByText("4 of 4 claims shown")).toBeVisible();

        // Fact filter narrows to the two seeded Fact claims.
        await page.getByRole("button", { name: "Fact", exact: true }).click();
        await expect(page.getByText("2 of 4 claims shown")).toBeVisible();
        await expect(
            page.getByRole("button", { name: /^Open Fact claim:/ }),
        ).toHaveCount(2);

        // Hypothesis filter isolates the deterministic counter-evidence claim.
        await page
            .getByRole("button", { name: "Hypothesis", exact: true })
            .click();
        const counterRow = page.getByRole("button", {
            name: /^Open Hypothesis claim:/,
        });
        await expect(counterRow).toHaveCount(1);
        await counterRow.click();

        const detail = page.getByRole("article", { name: /^Claim detail:/ });
        await expect(detail).toBeVisible();
        await expect(
            detail.getByText(
                "Counter-evidence is visible above alongside supporting passages.",
            ),
        ).toBeVisible();
        await expect(detail.getByText("Counters this claim")).toBeVisible();
        await expect(detail.getByText("Web page")).toBeVisible();
        await expect(detail.getByText("Added by analyst")).toBeVisible();

        // Exact quoted passage plus source provenance from the committed corpus.
        await expect(
            detail.getByText(`“${EXHIBIT_PASSAGES.counter}”`),
        ).toBeVisible();
        await expect(detail.getByText("CCC 10-K Annual Report")).toBeVisible();
        await expect(
            detail.getByText(
                `https://fixture.example/${fixtureKey}/ccc-10k`,
            ),
        ).toBeVisible();

        // Reset to the full seeded matrix. The workspace navigation rail
        // expands on hover and would intercept a pointer click over the
        // filter row, so the reset goes through the keyboard: focus the All
        // button and press Enter.
        const allButton = page.getByRole("button", { name: "All", exact: true });
        await allButton.focus();
        await page.keyboard.press("Enter");
        await expect(page.getByText("4 of 4 claims shown")).toBeVisible();
    });

    test("unavailable scenario preserves sources with analyst-safe copy and zero claims", async ({
        page,
    }) => {
        await page.setViewportSize({ width: 1440, height: 1000 });
        await openEvidence(page, "unavailable-domain", "unavailable");

        await expect(
            page.getByText(/claim generation is not available for this dossier yet/i),
        ).toBeVisible();
        await expect(
            page.getByText(/Your approved sources are preserved and will be reused/i),
        ).toBeVisible();
        // Zero claims produced: no claim list header or rows are rendered.
        await expect(page.getByText(/claims shown/i)).not.toBeVisible();
        await expect(page.getByRole("button", { name: /^Open / })).toHaveCount(0);

        // Assessment stays locked behind the evidence review gate; no claims
        // and no provider work are produced for the unavailable scenario.
        await expect(
            page.getByText("Wait for claim extraction to finish building the evidence set."),
        ).toBeVisible();
        await expect(
            page.getByText("Review and approve the evidence first."),
        ).toBeVisible();
    });

    test("tablet drawer supports keyboard row selection, focus containment, Escape close, and focus restoration", async ({
        page,
    }) => {
        await page.setViewportSize({ width: 900, height: 900 });
        void (await openEvidence(page, "tablet-drawer", "showcase"));
        const claimDrawerHeading = page.getByRole("heading", {
            name: "Claim detail",
        });
        await expect(claimDrawerHeading).not.toBeVisible();

        const row = page
            .getByRole("button", { name: /^Open Fact claim:/ })
            .first();
        await row.focus();
        await page.keyboard.press("Enter");

        // The drawer seats the selected claim detail after keyboard selection.
        await expect(claimDrawerHeading).toBeVisible();
        await expect(
            page.getByRole("article", { name: /^Claim detail:/ }),
        ).toBeVisible();

        // Focus is contained inside the modal drawer while it is open.
        await expect
            .poll(() =>
                page.evaluate(() => {
                    const el = document.activeElement;
                    return Boolean(
                        el &&
                            el.closest(
                                '[data-slot="drawer-popup"], [data-slot="drawer-content"]',
                            ),
                    );
                }),
            )
            .toBe(true);

        // Escape closes the drawer and restores focus to the selected row.
        await page.keyboard.press("Escape");
        await expect(claimDrawerHeading).not.toBeVisible();
        await expect(row).toBeFocused();
    });

    test("mobile drawer closes with Escape and restores focus to the selected row", async ({
        page,
    }) => {
        await page.setViewportSize({ width: 390, height: 844 });
        void (await openEvidence(page, "mobile-drawer", "showcase"));
        const claimDrawerHeading = page.getByRole("heading", {
            name: "Claim detail",
        });
        await expect(claimDrawerHeading).not.toBeVisible();

        const row = page
            .getByRole("button", { name: /^Open Fact claim:/ })
            .first();
        await row.focus();
        await page.keyboard.press("Enter");
        await expect(claimDrawerHeading).toBeVisible();

        await page.keyboard.press("Escape");
        await expect(claimDrawerHeading).not.toBeVisible();
        await expect(row).toBeFocused();
    });

    test("reduced motion keeps the matrix functional through the classification filter", async ({
        page,
    }) => {
        await page.setViewportSize({ width: 1440, height: 1000 });
        // Emulate the reduced-motion media context for this browser session so
        // functional transitions survive while ornamental animation is removed.
        await page.emulateMedia({ reducedMotion: "reduce" });
        await openEvidence(page, "reduced-motion", "showcase");

        await expect(page.getByText("Evidence is ready for review")).toBeVisible();
        await page
            .getByRole("button", { name: "Unknown", exact: true })
            .click();
        await expect(page.getByText("1 of 4 claims shown")).toBeVisible();
        await expect(
            page.getByRole("button", { name: /^Open Unknown claim:/ }),
        ).toHaveCount(1);
    });

    test("logout revokes a private route, and a fresh anonymous session reuses the code to recover the dossier", async ({
        page,
    }) => {
        await page.setViewportSize({ width: 1440, height: 1000 });
        const { runId } = await openEvidence(
            page,
            "logout-recovery",
            "showcase",
        );

        // Logout through the real workspace session menu.
        await page.getByRole("button", { name: "Workspace menu" }).click();
        await page.getByRole("button", { name: "Logout" }).click();
        // Logout immediately reopens the Protected access / Access code
        // admission drawer over the protected shell; the Start heading is
        // hidden behind the modal, so the gate asserts the drawer itself.
        await expect(page.getByText(/Protected access/i)).toBeVisible();
        await expect(page.getByLabel("Access code")).toBeVisible();

        // The protected dossiers route no longer serves the admitted session;
        // it reopens admission instead of rendering private content.
        await page.goto("/workspace/dossiers");
        await expect(page.getByText(/Protected access/i)).toBeVisible();
        await expect(page.getByLabel("Access code")).toBeVisible();

        // Stop sanitized tracing before the reusable code re-enters so no
        // credential value can reach retry traces or failure attachments.
        await stopSanitizedTrace(page);
        // A fresh anonymous session reuses the same analyst code through the
        // normal admission drawer; wait for the drawer to close before
        // navigating back to the persisted dossier.
        await page.getByLabel("Access code").fill(analystAccessCode());
        await page.getByRole("button", { name: "Continue" }).click();
        await expect(page.getByLabel("Access code")).not.toBeVisible({
            timeout: 20_000,
        });
        await page.goto(`/workspace/${runId}?section=evidence`);
        await expect(page.getByText("Evidence is ready for review")).toBeVisible();
        // Only after the recovered dossier document is fully loaded and its
        // initial ready state is asserted does credential-safe tracing resume.
        await startSanitizedTrace(page);
    });
});