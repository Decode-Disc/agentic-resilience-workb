import type { Id } from "@convex/_generated/dataModel";
import schema from "@convex/schema";
import { makeFunctionReference } from "convex/server";
import { convexTest } from "convex-test";
import { expect, test } from "vitest";

const modules = import.meta.glob("/convex/**/*.ts");

const persistPreparation = makeFunctionReference<
    "mutation",
    {
        collectionKey: string;
        requestKey: string;
        inputDigest: string;
        canonicalUrl: string;
        title: string;
        providerReference: string;
        expiresAt: number;
    },
    {
        preparationId: Id<"manualSourcePreparations">;
        canonicalUrl: string;
        title: string;
        expiresAt: number;
    }
>("sourceIntake:persistPreparation");
const findPreparation = makeFunctionReference<
    "query",
    {
        collectionKey: string;
        requestKey: string;
        inputDigest: string;
        now: number;
    },
    {
        preparationId: Id<"manualSourcePreparations">;
        canonicalUrl: string;
        title: string;
        expiresAt: number;
    } | null
>("sourceIntake:findPreparation");

test("persists one idempotent preparation for an anonymous auth session", async () => {
    const t = convexTest(schema, modules);
    const userId = await t.run((ctx) =>
        ctx.db.insert("users", { isAnonymous: true }),
    );
    const session = t.withIdentity({ subject: `${userId}|source-session` });
    const args = {
        collectionKey: "composer-1",
        requestKey: "request-1",
        inputDigest: "digest-1",
        canonicalUrl: "https://example.com/report",
        title: "Public report",
        providerReference: "url_metadata:report",
        expiresAt: Date.now() + 10 * 60_000,
    };

    const first = await session.mutation(persistPreparation, args);
    const replay = await session.mutation(persistPreparation, args);

    expect(replay).toEqual(first);
    await expect(
        t.run((ctx) => ctx.db.query("manualSourcePreparations").collect()),
    ).resolves.toEqual([
        expect.objectContaining({
            ownerAuthUserId: userId,
            collectionKey: "composer-1",
            requestKey: "request-1",
            canonicalUrl: "https://example.com/report",
        }),
    ]);
});

test("rejects preparation persistence without an authenticated session", async () => {
    const t = convexTest(schema, modules);

    await expect(
        t.mutation(persistPreparation, {
            collectionKey: "composer-1",
            requestKey: "request-1",
            inputDigest: "digest-1",
            canonicalUrl: "https://example.com/report",
            title: "Public report",
            providerReference: "url_metadata:report",
            expiresAt: Date.now() + 10 * 60_000,
        }),
    ).rejects.toThrow("Not authenticated");
});

test("rejects replay of an expired preparation request key", async () => {
    const t = convexTest(schema, modules);
    const userId = await t.run((ctx) =>
        ctx.db.insert("users", { isAnonymous: true }),
    );
    const session = t.withIdentity({ subject: `${userId}|expired-session` });
    await t.run((ctx) =>
        ctx.db.insert("manualSourcePreparations", {
            ownerAuthUserId: userId,
            collectionKey: "composer-1",
            requestKey: "expired-request",
            inputDigest: "expired-digest",
            canonicalUrl: "https://example.com/expired-report",
            title: "Expired report",
            providerReference: "url_metadata:expired-report",
            expiresAt: 99,
            createdAt: 1,
        }),
    );

    await expect(
        session.query(findPreparation, {
            collectionKey: "composer-1",
            requestKey: "expired-request",
            inputDigest: "expired-digest",
            now: 100,
        }),
    ).rejects.toMatchObject({
        data: {
            code: "preparation_expired",
            retryable: false,
        },
    });
});
