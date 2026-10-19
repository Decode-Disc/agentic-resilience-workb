import { sha256Hex } from "@convex/domain/sourcePassages";
import { createHash } from "node:crypto";
import { describe, expect, test } from "vitest";

// Reference digest produced by the platform crypto implementation (node:crypto,
// sha256 + hex). The Convex-safe pure TypeScript replacement must match it
// exactly for the same UTF-8/byte input, or stored quotation/source hashes and
// passage keys would change.
function referenceSha256Hex(content: string | Uint8Array): string {
    return createHash("sha256").update(content).digest("hex");
}

describe("sha256Hex (dependency-free pure implementation)", () => {
    test("empty input matches the NIST empty-message vector", () => {
        const expected =
            "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
        expect(sha256Hex("")).toBe(expected);
        expect(sha256Hex(new Uint8Array(0))).toBe(expected);
    });

    test('"abc" matches the NIST single-block vector', () => {
        const expected =
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad";
        expect(sha256Hex("abc")).toBe(expected);
        expect(referenceSha256Hex("abc")).toBe(expected);
    });

    test("long two-block vector matches the NIST test vector", () => {
        const input =
            "abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq";
        const expected =
            "248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1";
        expect(sha256Hex(input)).toBe(expected);
    });

    test("million-a vector matches the NIST long-input vector", () => {
        const input = "a".repeat(1_000_000);
        const expected =
            "cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0";
        expect(sha256Hex(input)).toBe(expected);
        expect(referenceSha256Hex(input)).toBe(expected);
    });

    test("Unicode UTF-8 strings hash identically to node:crypto", () => {
        const inputs = [
            "€",
            "héllo ☃ world",
            "résilience – preuve",
            "😀 multi-byte astral",
            "I will not buy this record, it is scratched.",
        ];
        for (const text of inputs) {
            expect(sha256Hex(text)).toBe(referenceSha256Hex(text));
            // Explicit: hashing must agree with the UTF-8 byte digest, not a
            // UTF-16 code-unit digest.
            const bytes = new TextEncoder().encode(text);
            expect(sha256Hex(text)).toBe(referenceSha256Hex(bytes));
        }
    });

    test("binary byte buffers hash identically to node:crypto", () => {
        const cases: Uint8Array[] = [
            Uint8Array.from([0x00, 0x01, 0x02, 0xfe, 0xff]),
            Uint8Array.from({ length: 300 }, (_, i) => (i * 7 + 3) & 0xff),
            new TextEncoder().encode("mixed \u0000\u0080 payload"),
        ];
        for (const bytes of cases) {
            expect(sha256Hex(bytes)).toBe(referenceSha256Hex(bytes));
        }
    });

    test("output shape is a lowercase 64-character hex digest", () => {
        for (const input of ["", "abc", "a".repeat(65), "☃".repeat(40)]) {
            const digest = sha256Hex(input);
            expect(digest).toMatch(/^[0-9a-f]{64}$/);
        }
    });

    test("existing showcase-fixture passage and artifact hashes are reproducible", () => {
        // Representative corpus strings used by the CCC fixture / normalizers.
        // The pure sha256Hex must reproduce node:crypto's digest so persisted
        // sourceVersionHash / quotationHash / passage-key values stay stable.
        const corpusStrings = [
            "CCC Intelligent Solutions Inc. provides SaaS solutions for the property and casualty insurance economy.",
            "Our hyperscale multi-tenant architecture spans multiple cloud regions with zero-trust network boundaries.",
            "CCC processes over 28 million claims annually, capturing the majority of US auto physical damage claim volumes.",
        ];
        for (const text of corpusStrings) {
            expect(sha256Hex(text)).toBe(referenceSha256Hex(text));
            const encoded = new TextEncoder().encode(text);
            expect(sha256Hex(encoded)).toBe(referenceSha256Hex(encoded));
        }
    });
});
