import { describe, expect, it } from "vitest";

import { parseClientEnv } from "@/config/env-schema";

describe("parseClientEnv", () => {
    it("accepts the local Convex URL written by the development CLI", () => {
        expect(
            parseClientEnv({
                VITE_CONVEX_URL: "http://127.0.0.1:3210",
            }),
        ).toEqual({
            VITE_CONVEX_URL: "http://127.0.0.1:3210",
        });
    });

    it("rejects a malformed Convex URL", () => {
        expect(() =>
            parseClientEnv({
                VITE_CONVEX_URL: "not-a-url",
            }),
        ).toThrow();
    });

    it("rejects a well-formed URL with an unsupported protocol", () => {
        expect(() =>
            parseClientEnv({ VITE_CONVEX_URL: "ftp://convex.example/" }),
        ).toThrow("VITE_CONVEX_URL must use http or https");
    });

    it("rejects a missing Convex URL", () => {
        expect(() => parseClientEnv({})).toThrow();
    });
});
