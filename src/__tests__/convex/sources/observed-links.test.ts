import { internal } from "@convex/_generated/api";
import * as normalization from "@convex/integrations/evidenceNormalization";
import { getDocumentSize } from "convex/values";
import { assert, expect, test } from "vitest";
import { seedCapturedSources } from "@/__tests__/setup/sources-mission";

test("capture finalization refuses oversized destination metadata and preserves exact bounded destinations", async () => {
    const f = await seedCapturedSources();
    const capture = await f.t.run((ctx) => ctx.db.get(f.captureId));
    assert(
        capture?.contentHash &&
            capture.byteCount &&
            capture.resolvedUrl &&
            capture.retrievalVersion &&
            capture.readingCompleteness &&
            capture.retrievedAt !== undefined,
    );
    await f.t.run((ctx) => ctx.db.patch(f.captureId, { status: "uploaded" }));
    const urls = Array.from(
        { length: 64 },
        (_, i) => `https://example.com/${i}/${"a".repeat(1990)}`,
    );
    const links = normalization.extractObservedDestinations(
        urls
            .map((url) => `<a href="${" ".repeat(2200)}${url}">Guide</a>`)
            .join("\n"),
        "https://example.com",
    );
    const args = {
        preparationId: f.preparationId,
        captureId: f.captureId,
        contentHash: capture.contentHash,
        byteCount: capture.byteCount,
        resolvedUrl: capture.resolvedUrl,
        retrievalVersion: capture.retrievalVersion,
        normalizerVersion: capture.normalizerVersion,
        retrievedAt: capture.retrievedAt,
        readingCompleteness: capture.readingCompleteness,
        omittedPassageCount: capture.omittedPassageCount ?? 0,
    };
    await expect(
        f.t.mutation(internal.sourceCaptures.finalize, {
            ...args,
            observedDestinations: links.map((link) => ({
                ...link,
                originText: " ".repeat(4096),
            })),
        }),
    ).rejects.toThrow("capture_invalid");
    expect((await f.t.run((ctx) => ctx.db.get(f.captureId)))?.status).toBe(
        "uploaded",
    );
    await f.t.mutation(internal.sourceCaptures.finalize, {
        ...args,
        observedDestinations: links,
    });
    const retained = await f.t.run((ctx) => ctx.db.get(f.captureId));
    expect(retained?.status).toBe("committed");
    expect(retained?.observedDestinations?.map((link) => link.url)).toEqual(
        urls,
    );
});

test.each([
    { label: "padded ASCII", path: "a".repeat(1990), padding: 2200 },
    { label: "Unicode", path: "🦉".repeat(150), padding: 0 },
])("maximum observed destinations retain exact URLs and bounded literal origins: $label", ({
    path,
    padding,
}) => {
    const rawUrls = Array.from(
        { length: 64 },
        (_, i) => `https://example.com/${i}/${path}`,
    );
    const urls = rawUrls.map((url) => new URL(url).href);
    const raw = rawUrls
        .map((url) => `<a href="${" ".repeat(padding)}${url}">Guide</a>`)
        .join("\n");
    const links = normalization.extractObservedDestinations(
        raw,
        "https://example.com",
    );
    expect(links.map((link) => link.url)).toEqual(urls);
    expect(
        getDocumentSize({ observedDestinations: links }),
    ).toBeLessThanOrEqual(192 * 1024);
    for (const link of links) {
        expect(
            raw.slice(
                link.startOffset,
                link.startOffset + link.originText.length,
            ),
        ).toBe(link.originText);
        expect(link.originText).not.toContain("\uFFFD");
        expect(
            new TextEncoder().encode(link.originText).length,
        ).toBeLessThanOrEqual(512);
    }
});

test("observed destinations preserve their actual origin and never invent the URL of an index label", () => {
    expect(normalization).toHaveProperty("extractObservedDestinations");
    const raw = '<a href="/guide?x=1&amp;y=2">Guide</a> Other guide label';
    const links = normalization.extractObservedDestinations(
        raw,
        "https://example.com/index",
    );
    expect(links).toHaveLength(1);
    expect(links[0]).toMatchObject({
        url: "https://example.com/guide?x=1&y=2",
        originText: 'href="/guide?x=1&amp;y=2"',
    });
    expect(
        normalization.extractObservedDestinations(
            "Product guide",
            "https://example.com/index",
        ),
    ).toEqual([]);
});
