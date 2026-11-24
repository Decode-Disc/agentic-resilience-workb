import { validateCoverImageUrl } from "@convex/domain/coverImageUrl";
import { describe, expect, test } from "vitest";

describe("validateCoverImageUrl", () => {
    test("canonicalizes a public HTTPS URL", () => {
        expect(
            validateCoverImageUrl("https://Example.com:443/report#section"),
        ).toBe("https://example.com/report");
    });

    test("adds a trailing slash to a bare host", () => {
        expect(validateCoverImageUrl("https://example.com")).toBe(
            "https://example.com/",
        );
    });

    test.each([
        ["not a url"],
        ["ftp://example.com"],
        ["http://example.com"],
        ["https://user:pass@example.com"],
        ["https://example.com:8443"],
        ["https://127.0.0.1"],
        ["https://10.0.0.4"],
        ["https://192.168.1.3"],
        ["https://169.254.169.254/latest/meta-data"],
        ["https://[::1]/"],
        ["https://localhost"],
        ["https://foo.localhost"],
        ["https://foo.local"],
        ["https://"],
    ])("rejects unsafe URL %s", (url) => {
        expect(validateCoverImageUrl(url)).toBeNull();
    });
});
