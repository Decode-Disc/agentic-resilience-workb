/// <reference types="node" />
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
    expect,
    type Locator,
    type Page,
} from "@playwright/test";

/**
 * Locates the admission field by its stable id instead of its visible label, so
 * renaming the label cannot turn an absence assertion into a vacuous pass.
 */
export function accessCodeField(page: Page): Locator {
    return page.locator("#invitation-code");
}

/** Admits the visitor through the real drawer without depending on its copy. */
export async function submitAccessCode(
    page: Page,
    code: string,
): Promise<void> {
    await accessCodeField(page).fill(code);
    await page.locator("form:has(#invitation-code) button[type=submit]").click();
}

/** Proves the admission surface is not rendered for the current session. */
export async function expectAdmissionClosed(page: Page): Promise<void> {
    await expect(accessCodeField(page)).toHaveCount(0);
}

type InvitationMaterial = {
    invitations: Array<{ slotKey: string; role: string; code: string }>;
};

import { browserTestSlot, workerSlotAccessCode } from "./browser-workspace";

/** The local access code for a role or a specific invitation slot. */
export function localAccessCode(
    match: { role: "admin" } | { slotKey: string },
): string {
    if ("role" in match) return workerSlotAccessCode("admin").code;
    if (match.slotKey === browserTestSlot())
        return workerSlotAccessCode("analyst").code;
    const material = JSON.parse(
        readFileSync(resolve(process.cwd(), "invitation-otp-codes.local"), "utf8"),
    ) as InvitationMaterial;
    const invitation = material.invitations.find(
        (entry) => entry.slotKey === match.slotKey,
    );
    if (!invitation) throw new Error("Local invitation is not configured");
    return invitation.code;
}

type AuthEntries = Array<[string, string]>;
const AUTH_KEY_PREFIX = "__convexAuth";
const RESTORED = "e2e-admitted-session-restored";
const RECORD = "__e2eRecordAuthSession";
const admittedSessions = new Map<string, AuthEntries>();
const pageCodes = new WeakMap<Page, string>();

/**
 * Opens a protected path as the visitor holding `code`, reusing that visitor's latest session.
 * Each code signs in through the real drawer once per worker; later tests restore the saved session
 * before their first navigation. The client rotates its refresh token after every load, so the page
 * reports each auth write and the saved session follows the newest one. A session that no longer
 * admits, because a later sign-in or a revocation rebound the slot, falls back to the drawer. Tests
 * about admission or reconnection sign in with {@link submitAccessCode} directly.
 */
export async function openAdmitted(
    page: Page,
    { code, path, admitted }: { code: string; path: string; admitted: Locator },
): Promise<void> {
    if (!pageCodes.has(page))
        await page.exposeFunction(RECORD, (entries: AuthEntries) => {
            const owner = pageCodes.get(page);
            if (!owner) return;
            if (entries.length === 0) admittedSessions.delete(owner);
            else admittedSessions.set(owner, entries);
        });
    pageCodes.set(page, code);
    await page.addInitScript(
        ({ entries, marker, prefix, record }) => {
            // Only the first document in this context restores; sessionStorage survives logout localStorage clears.
            if (entries && !sessionStorage.getItem(marker)) {
                for (const [name, value] of entries)
                    localStorage.setItem(name, value);
                sessionStorage.setItem(marker, "1");
            }
            const report = () =>
                (
                    window as unknown as Record<
                        string,
                        ((entries: Array<[string, string]>) => void) | undefined
                    >
                )[record]?.(
                    Object.entries(localStorage).filter(([key]) =>
                        key.startsWith(prefix),
                    ),
                );
            const setItem = Storage.prototype.setItem;
            Storage.prototype.setItem = function (name, value) {
                setItem.call(this, name, value);
                if (this === localStorage && name.startsWith(prefix)) report();
            };
            const removeItem = Storage.prototype.removeItem;
            Storage.prototype.removeItem = function (name) {
                removeItem.call(this, name);
                if (this === localStorage && name.startsWith(prefix)) report();
            };
            const clear = Storage.prototype.clear;
            Storage.prototype.clear = function () {
                clear.call(this);
                if (this === localStorage) report();
            };
        },
        {
            entries: admittedSessions.get(code) ?? null,
            marker: RESTORED,
            prefix: AUTH_KEY_PREFIX,
            record: RECORD,
        },
    );
    await page.goto(path);
    const field = accessCodeField(page);
    await expect(field.or(admitted)).toBeVisible({ timeout: 60_000 });
    if (await field.isVisible()) {
        await submitAccessCode(page, code);
        await expectAdmissionClosed(page);
        await expect(admitted).toBeVisible({ timeout: 30_000 });
    }
}

/** Opens administration as the local administrator. */
export async function admitAdministrator(
    page: Page,
    path = "/workspace/admin",
): Promise<void> {
    await openAdmitted(page, {
        code: localAccessCode({ role: "admin" }),
        path,
        admitted: page.getByRole("heading", {
            name: "Administration",
            exact: true,
        }),
    });
}
