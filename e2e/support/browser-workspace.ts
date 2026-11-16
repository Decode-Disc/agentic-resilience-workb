import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { type Page, test as base } from "@playwright/test";
import { runConvexJson } from "./convex-admin";

export const BROWSER_TEST_SLOT = "analyst-4";
const contexts = new WeakMap<Page, string>();

type WorkerSlotEntry = {
    analystSlotKey: string;
    analystCode: string;
    adminSlotKey: string;
    adminCode: string;
};

type WorkerSlotsManifest = {
    workers: Record<string, WorkerSlotEntry>;
};

type BaseInvitationMaterial = {
    invitations: Array<{ slotKey: string; role: string; code: string }>;
};

export function workerSlotsFilePath(): string | null {
    const worktreeId = process.env.LOCAL_RUNTIME_WORKTREE_ID?.trim();
    if (!worktreeId) return null;
    return resolve(
        process.cwd(),
        join(".local-runtime", "playwright", worktreeId, "worker-slots.json"),
    );
}

function readWorkerSlotEntry(): WorkerSlotEntry | null {
    const index = process.env.TEST_PARALLEL_INDEX?.trim();
    if (!index || index === "0") return null;
    const path = workerSlotsFilePath();
    if (!path || !existsSync(path)) return null;
    const manifest = JSON.parse(
        readFileSync(path, "utf8"),
    ) as WorkerSlotsManifest;
    return manifest.workers?.[index] ?? null;
}

/** Returns the Playwright worker's assigned analyst slot (`analyst-4` for worker 0). */
export function browserTestSlot(): string {
    return readWorkerSlotEntry()?.analystSlotKey ?? BROWSER_TEST_SLOT;
}

/** Returns the Playwright worker's assigned admin slot (`admin` for worker 0). */
export function adminTestSlot(): string {
    return readWorkerSlotEntry()?.adminSlotKey ?? "admin";
}

/** Resolves the slotKey and 4-digit access code assigned to the current Playwright worker. */
export function workerSlotAccessCode(role: "analyst" | "admin"): {
    slotKey: string;
    code: string;
} {
    const workerEntry = readWorkerSlotEntry();
    if (workerEntry) {
        return role === "admin"
            ? {
                  slotKey: workerEntry.adminSlotKey,
                  code: workerEntry.adminCode,
              }
            : {
                  slotKey: workerEntry.analystSlotKey,
                  code: workerEntry.analystCode,
              };
    }
    const targetSlotKey = role === "admin" ? "admin" : BROWSER_TEST_SLOT;
    const material = JSON.parse(
        readFileSync(
            resolve(process.cwd(), "invitation-otp-codes.local"),
            "utf8",
        ),
    ) as BaseInvitationMaterial;
    const invitation = material.invitations.find(
        (entry) => entry.slotKey === targetSlotKey,
    );
    if (!invitation) throw new Error("Local invitation is not configured");
    return { slotKey: invitation.slotKey, code: invitation.code };
}

/** Explicitly binds the already-admitted anonymous principal, including after sign-in again. */
export async function bindBrowserTestContext(page: Page) {
    const contextKey = contexts.get(page) ?? `browser-${randomUUID()}`;
    await runConvexJson("runWorkspace:openBrowserTestContext", {
        slotKey: browserTestSlot(),
        contextKey,
        durationMs: Math.min(2 * 60 * 60 * 1000, base.info().timeout + 60_000),
    });
    contexts.set(page, contextKey);
}

export async function closeBrowserTestContext(page: Page) {
    const contextKey = contexts.get(page);
    if (!contextKey) return;
    await runConvexJson("runWorkspace:closeBrowserTestContext", {
        slotKey: browserTestSlot(),
        contextKey,
    });
    contexts.delete(page);
}

/** Cleanup runs after test hooks; server expiry remains the fallback for a killed runner. */
export const test = base.extend<{ browserWorkspace: void }>({
    browserWorkspace: [
        async ({ page }, use) => {
            try {
                await use();
            } finally {
                await closeBrowserTestContext(page);
            }
        },
        { auto: true },
    ],
});
