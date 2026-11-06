import assert from "node:assert/strict";
import type { Browser } from "@playwright/test";
import { ConvexHttpClient } from "convex/browser";
import type { FunctionReturnType } from "convex/server";
import { api } from "../../../convex/_generated/api.js";

/** Repairs only stale input profiles through their authenticated owner, preserving the selected model and revision. */
export async function prepareQualificationModel(
    client: Pick<ConvexHttpClient, "query" | "action">,
    agent: "workbench" | "sources" = "workbench",
) {
    const before = await client.query(api.modelConfiguration.list, {});
    const assignment = before.assignments.find((a) => a.agent === agent);
    const selected = before.models.find((m) => m._id === assignment?.catalogId);
    assert(
        selected?.enabled &&
            selected.status === "ready" &&
            selected.currentRevisionId,
        "Selected Workbench model is not available",
    );
    let pages = 0;
    let complete = selected.compatible;
    if (!selected.compatible) {
        let cursor: string | null = null;
        for (; pages < 20; ) {
            const refreshed: FunctionReturnType<
                typeof api.modelConfigurationActions.refreshProfiles
            > = await client.action(
                api.modelConfigurationActions.refreshProfiles,
                { catalogId: selected._id, cursor },
            );
            pages++;
            if (refreshed.isDone) {
                complete = true;
                break;
            }
            assert(
                refreshed.continueCursor && refreshed.continueCursor !== cursor,
                "Profile refresh did not advance",
            );
            cursor = refreshed.continueCursor;
        }
    }
    assert(complete, "Profile refresh continuation bound exceeded");
    const after = await client.query(api.modelConfiguration.list, {});
    const prepared = after.models.find((m) => m._id === selected._id);
    assert(prepared?.compatible, "Input profile refresh is incomplete");
    assert.equal(
        prepared.currentRevisionId,
        selected.currentRevisionId,
        "Selected model revision changed during preparation",
    );
    assert.equal(prepared.enabled, selected.enabled);
    assert.equal(prepared.workbenchSelectable, selected.workbenchSelectable);
    assert.deepEqual(
        after.assignments,
        before.assignments,
        "Agent assignments changed during preparation",
    );
    return {
        refreshed: pages > 0,
        pages,
        model: prepared.model,
        catalogId: prepared._id,
        revisionId: prepared.currentRevisionId,
        preparedSerializer: prepared.preparedSerializer,
        preparedProfileCatalog: prepared.preparedProfileCatalog,
    };
}

/** Opens a genuine local anonymous session; invitation authority is acquired only through the public claim action. */
export async function openQualificationSession(convex: string, code: string) {
    const origin = new URL(convex);
    assert(
        ["127.0.0.1", "localhost"].includes(origin.hostname),
        "Local qualification session required",
    );
    const boundedFetch: typeof fetch = (input, init) => {
        const url = new URL(
            input instanceof Request ? input.url : String(input),
        );
        assert.equal(
            url.origin,
            origin.origin,
            "Qualification request changed origin",
        );
        return fetch(input, {
            ...init,
            redirect: "error",
            signal: init?.signal
                ? AbortSignal.any([init.signal, AbortSignal.timeout(120000)])
                : AbortSignal.timeout(120000),
        });
    };
    const authentication = new ConvexHttpClient(convex, {
        logger: false,
        fetch: boundedFetch,
    });
    const initialTokens = (
        await authentication.action(api.auth.signIn, { provider: "anonymous" })
    ).tokens;
    assert(initialTokens, "Anonymous qualification authentication unavailable");
    let tokens = initialTokens;
    const expiresAt = () => {
        const payload: unknown = JSON.parse(
            Buffer.from(tokens.token.split(".")[1] ?? "", "base64url").toString(
                "utf8",
            ),
        );
        assert(
            payload &&
                typeof payload === "object" &&
                "exp" in payload &&
                typeof payload.exp === "number",
            "Authentication expiry unavailable",
        );
        return payload.exp * 1000;
    };
    let refreshing: Promise<void> | undefined;
    const client = new ConvexHttpClient(convex, {
        logger: false,
        fetch: async (input, init) => {
            if (expiresAt() - Date.now() < 30000) {
                refreshing ??= (async () => {
                    const renewed = await authentication.action(
                        api.auth.signIn,
                        { refreshToken: tokens.refreshToken },
                    );
                    assert(
                        renewed.tokens,
                        "Qualification session refresh failed",
                    );
                    tokens = renewed.tokens;
                })().finally(() => {
                    refreshing = undefined;
                });
                await refreshing;
            }
            const headers = new Headers(init?.headers);
            headers.set("Authorization", `Bearer ${tokens.token}`);
            return boundedFetch(input, { ...init, headers });
        },
    });
    const close = () => client.action(api.auth.signOut, {});
    try {
        await client.action(api.invitations.claim, { code });
        return { client, close };
    } catch (error) {
        await close();
        throw error;
    }
}

/** Uses real anonymous admission; authentication material stays in memory and the temporary context is always closed. */
export async function withQualificationAdministrator<T>(
    browser: Browser | null,
    origins: { web?: string; convex: string },
    code: string,
    use: (client: ConvexHttpClient) => Promise<T>,
) {
    if (!browser) {
        const session = await openQualificationSession(origins.convex, code);
        try {
            return await use(session.client);
        } finally {
            await session.close();
        }
    }
    assert(origins.web, "Browser admission requires a web origin");
    const context = await browser.newContext();
    try {
        const page = await context.newPage();
        page.setDefaultTimeout(30_000);
        await page.goto(`${origins.web}/workspace/admin`);
        await page.locator("#invitation-code").fill(code);
        await page
            .locator("form:has(#invitation-code) button[type=submit]")
            .click();
        await page.locator("#invitation-code").waitFor({ state: "hidden" });
        // Convex Auth's installed browser storage owner prefixes the JWT key with its deployment namespace.
        const token = await page.evaluate(() => {
            const keys = Object.keys(localStorage).filter((key) =>
                key.startsWith("__convexAuthJWT"),
            );
            if (keys.length !== 1) return null;
            return localStorage.getItem(keys[0] ?? "");
        });
        assert(token, "Admitted administrator authentication unavailable");
        const client = new ConvexHttpClient(origins.convex, { logger: false });
        client.setAuth(token);
        return await use(client);
    } finally {
        await context.close();
    }
}

/** Prepares the selected Workbench model through the admitted administrator. */
export async function prepareBrowserQualificationModel(
    browser: Browser,
    origins: { web: string; convex: string },
    code: string,
) {
    return withQualificationAdministrator(
        browser,
        origins,
        code,
        prepareQualificationModel,
    );
}
