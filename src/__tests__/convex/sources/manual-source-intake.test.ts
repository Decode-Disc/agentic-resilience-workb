import {
    classifyManualSourceIntakeError,
    ManualSourceIntakeError,
    manualSourceIntakeError,
} from "@convex/domain/manualSourceIntake";
import { ConvexError } from "convex/values";
import { describe, expect, test } from "vitest";

describe("manual source intake errors", () => {
    test.each([
        ["invalid_url", false],
        ["https_required", false],
        ["non_public_destination", false],
        ["access_blocked", false],
        ["duplicate_source", false],
        ["candidate_limit", false],
        ["dossier_not_accepting_sources", false],
        ["request_timeout", true],
        ["connection_failed", true],
        ["upstream_rate_limited", true],
        ["upstream_unavailable", true],
    ] as const)("preserves %s and its retry policy", (code, retryable) => {
        const error = manualSourceIntakeError(code, { field: "url" });

        expect(error).toBeInstanceOf(ManualSourceIntakeError);
        expect(classifyManualSourceIntakeError(error).data).toMatchObject({
            code,
            retryable,
            field: "url",
        });
    });

    test("classifies aborted requests as retryable timeouts", () => {
        const error = new DOMException("aborted", "AbortError");

        expect(classifyManualSourceIntakeError(error).data).toMatchObject({
            code: "request_timeout",
            retryable: true,
        });
    });

    test("classifies unknown network type errors as retryable connection failures", () => {
        expect(
            classifyManualSourceIntakeError(
                new TypeError("getaddrinfo ENOTFOUND internal detail"),
            ).data,
        ).toMatchObject({
            code: "connection_failed",
            retryable: true,
        });
    });

    test("classifies unrecognized exceptions as unexpected without leaking their message", () => {
        const classified = classifyManualSourceIntakeError(
            new Error("secret backend detail"),
        );

        expect(classified.data).toMatchObject({
            code: "unexpected",
            retryable: false,
        });
        expect(classified.message).not.toContain("secret backend detail");
    });

    test("preserves structured intake data crossing a Convex function boundary", () => {
        const error = new ConvexError({
            area: "manual_source_intake" as const,
            code: "duplicate_source" as const,
            retryable: false,
            field: "url" as const,
        });

        expect(classifyManualSourceIntakeError(error).data).toEqual(error.data);
    });
});
