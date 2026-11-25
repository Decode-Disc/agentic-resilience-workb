import { httpAction } from "@convex/_generated/server";
import schema from "@convex/schema";
import { httpRouter } from "convex/server";
import { convexTest } from "convex-test";
import { afterEach, expect, test, vi } from "vitest";
import { deferred } from "@/__tests__/setup/deferred";

afterEach(() => vi.restoreAllMocks());

test.each([
    "action",
    "http",
] as const)("a concurrent %s upload commits independently while blob reads overlap", async (transport) => {
    const firstBlob = new Blob(["first"]);
    const secondBlob = new Blob(["second"]);
    const firstReading = deferred<void>();
    const firstReadable = deferred<void>();
    const secondStarted = deferred<void>();
    const secondReadable = deferred<void>();
    const httpUploaded = deferred<Id<"_storage">>();
    const router = httpRouter();
    router.route({
        path: "/upload",
        method: "POST",
        handler: httpAction(async (ctx) => {
            secondStarted.resolve();
            httpUploaded.resolve(await ctx.storage.store(secondBlob));
            return new Response("Stored");
        }),
    });
    const t = convexTest(schema, {
        ...import.meta.glob("/convex/**/*.ts"),
        "/convex/http.ts": async () => ({ default: router }),
    });
    vi.spyOn(firstBlob, "arrayBuffer").mockImplementation(async () => {
        firstReading.resolve();
        await firstReadable.promise;
        return new Blob(["first"]).arrayBuffer();
    });
    vi.spyOn(secondBlob, "arrayBuffer").mockImplementation(async () => {
        await secondReadable.promise;
        return new Blob(["second"]).arrayBuffer();
    });

    const first = t
        .action((ctx) => ctx.storage.store(firstBlob))
        .then((id) => {
            secondReadable.resolve();
            return id;
        });
    await firstReading.promise;
    const second =
        transport === "action"
            ? t.action((ctx) => {
                  secondStarted.resolve();
                  return ctx.storage.store(secondBlob);
              })
            : t.fetch("/upload", { method: "POST" }).then((response) => {
                  expect(response.status).toBe(200);
                  return httpUploaded.promise;
              });
    const uploads = Promise.all([first, second]);
    await secondStarted.promise;
    firstReadable.resolve();
    const [firstId, secondId] = await uploads;
    expect(firstId).not.toBe(secondId);
    const stored = await t.run(async (ctx) => ({
        first: await (await ctx.storage.get(firstId))?.text(),
        second: await (await ctx.storage.get(secondId))?.text(),
        rows: await ctx.db.system.query("_storage").collect(),
    }));
    expect(stored.first).toBe("first");
    expect(stored.second).toBe("second");
    expect(stored.rows.map((row) => row.size)).toEqual([5, 6]);
});

import type { Id } from "@convex/_generated/dataModel";

test("storage deletion stays within its caller's rollback", async () => {
    const t = convexTest(schema, import.meta.glob("/convex/**/*.ts"));
    const id = await t.action((ctx) => ctx.storage.store(new Blob(["Keep"])));
    await expect(
        t.run(async (ctx) => {
            await ctx.storage.delete(id);
            expect(await ctx.storage.get(id)).toBeNull();
            throw new Error("Abort deletion");
        }),
    ).rejects.toThrow("Abort deletion");
    expect(
        await t.action(async (ctx) => (await ctx.storage.get(id))?.text()),
    ).toBe("Keep");
});
