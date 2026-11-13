import { api } from "@convex/_generated/api";
import schema from "@convex/schema";
import { convexTest } from "convex-test";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import rateLimiterTest from "../integrations/rate-limiter-test-register.js";

const modules = import.meta.glob("/convex/**/*.ts");

async function fixture() {
    const t = convexTest(schema, modules);
    rateLimiterTest.register(t);
    const ids = await t.run(async (ctx) => {
        const authUserId = await ctx.db.insert("users", { isAnonymous: true });
        const invitationId = await ctx.db.insert("invitations", {
            slotKey: "analyst-1",
            role: "analyst",
            codeDigest: "test-only",
            status: "claimed",
            createdAt: Date.now(),
        });
        const visitorId = await ctx.db.insert("visitors", {
            authUserId,
            invitationId,
            role: "analyst",
            status: "active",
            analysesReserved: 0,
            admittedAt: Date.now(),
        });
        await ctx.db.patch(invitationId, { claimedByVisitorId: visitorId });
        return { authUserId, invitationId, visitorId };
    });
    return { t, ...ids, owner: t.withIdentity({ subject: ids.authUserId }) };
}

beforeEach(() => {
    vi.stubEnv("PREVIEW_SERVICE_URL", "https://renderer.example");
    vi.stubEnv("PREVIEW_SERVICE_SECRET", "test-only");
    vi.stubGlobal(
        "fetch",
        vi.fn(
            async () =>
                new Response(new Uint8Array([137, 80, 78, 71]), {
                    headers: { "content-type": "image/png" },
                }),
        ),
    );
});

afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
});

test.each([
    "anonymous",
    "unadmitted",
    "visitor_revoked",
    "invitation_revoked",
    "unbound",
] as const)("refuses a decorative render before I/O for %s access", async (access) => {
    const { t, owner, visitorId, invitationId } = await fixture();
    if (access === "unadmitted") await t.run((ctx) => ctx.db.delete(visitorId));
    if (access === "visitor_revoked")
        await t.run((ctx) => ctx.db.patch(visitorId, { status: "revoked" }));
    if (access === "invitation_revoked")
        await t.run((ctx) => ctx.db.patch(invitationId, { status: "revoked" }));
    if (access === "unbound")
        await t.run((ctx) =>
            ctx.db.patch(invitationId, { claimedByVisitorId: undefined }),
        );
    const result = await (access === "anonymous" ? t : owner).action(
        api.companyCoverImage.renderCompanyPreview,
        { url: "https://example.com/" },
    );
    expect(result).toEqual({ status: "unavailable", error: "unauthorized" });
    expect(fetch).not.toHaveBeenCalled();
});

test("the reserved browser workspace cannot invoke the decorative renderer", async () => {
    const { t, owner, invitationId } = await fixture();
    await t.run((ctx) => ctx.db.patch(invitationId, { slotKey: "analyst-4" }));
    expect(
        await owner.action(api.companyCoverImage.renderCompanyPreview, {
            url: "https://example.com/",
        }),
    ).toEqual({ status: "unavailable", error: "test_data" });
    expect(fetch).not.toHaveBeenCalled();
});

test("an admitted visitor shares its render allowance across different URLs", async () => {
    const { owner } = await fixture();
    for (const path of ["one", "two"]) {
        expect(
            await owner.action(api.companyCoverImage.renderCompanyPreview, {
                url: `https://example.com/${path}`,
            }),
        ).toEqual({ status: "ok", dataUrl: "data:image/png;base64,iVBORw==" });
    }
    expect(
        await owner.action(api.companyCoverImage.renderCompanyPreview, {
            url: "https://example.com/three?different-bucket=no",
        }),
    ).toEqual({ status: "unavailable", error: "rate_limited" });
    expect(fetch).toHaveBeenCalledTimes(2);
});
