/** Move an exclusive UTF-16 boundary left when it cuts a surrogate pair. */
export function completeCharacterBoundary(text: string, offset: number) {
    const before = text.charCodeAt(offset - 1);
    const after = text.charCodeAt(offset);
    return before >= 0xd800 &&
        before <= 0xdbff &&
        after >= 0xdc00 &&
        after <= 0xdfff
        ? offset - 1
        : offset;
}

const SHA256_K = new Uint32Array([
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1,
    0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
    0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786,
    0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147,
    0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
    0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b,
    0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a,
    0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
    0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

// SHA-256 initial hash values (8 words).
const SHA256_H0 = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c,
    0x1f83d9ab, 0x5be0cd19,
]);

function rotateRight(value: number, bits: number): number {
    return (value >>> bits) | (value << (32 - bits));
}

/**
 * Reads a 32-bit word at an always-in-bounds index of a typed array. The
 * nullish default is only a TypeScript narrowing step (indexed access adds
 * `| undefined` to the type); these reads are all provably populated.
 */
function wordAt(words: Uint32Array, index: number): number {
    return words[index] ?? 0;
}

/**
 * Deterministic synchronous pure TypeScript SHA-256 over raw bytes (FIPS 180-4),
 * returning the digest as a lowercase 64-character hex string.
 * Kept dependency-free so Convex V8 mutation/query bundling can inline this module
 * without a node:crypto import. Matches the node:crypto "sha256"/"hex" output exactly.
 */
export type Sha256Checkpoint = {
    words: number[];
    tail: number[];
    sizeBytes: number;
};

/** Serializable SHA-256 state lets bounded transactions verify one immutable byte stream. */
export function advanceSha256(
    checkpoint: Sha256Checkpoint | undefined,
    input: Uint8Array,
    final = false,
): Sha256Checkpoint {
    const tail = checkpoint?.tail ?? [];
    const message = new Uint8Array(tail.length + input.length);
    message.set(tail);
    message.set(input, tail.length);
    const sizeBytes = (checkpoint?.sizeBytes ?? 0) + input.length;
    const paddedLength = final
        ? Math.ceil((message.length + 9) / 64) * 64
        : Math.floor(message.length / 64) * 64;
    const padded = new Uint8Array(final ? paddedLength : message.length);
    padded.set(message);
    const view = new DataView(padded.buffer);
    if (final) {
        padded[message.length] = 0x80;
        view.setUint32(
            paddedLength - 8,
            Math.floor((sizeBytes * 8) / 0x100000000) >>> 0,
        );
        view.setUint32(paddedLength - 4, (sizeBytes * 8) >>> 0);
    }
    const initial = new Uint32Array(checkpoint?.words ?? SHA256_H0);
    let h0 = wordAt(initial, 0),
        h1 = wordAt(initial, 1),
        h2 = wordAt(initial, 2),
        h3 = wordAt(initial, 3);
    let h4 = wordAt(initial, 4),
        h5 = wordAt(initial, 5),
        h6 = wordAt(initial, 6),
        h7 = wordAt(initial, 7);
    const schedule = new Uint32Array(64);

    for (let block = 0; block < paddedLength; block += 64) {
        // Load the next 16 big-endian message words.
        for (let i = 0; i < 16; i++) {
            schedule[i] = view.getUint32(block + i * 4);
        }
        // Expand the message schedule (16..63).
        for (let i = 16; i < 64; i++) {
            const sigma0 =
                rotateRight(wordAt(schedule, i - 15), 7) ^
                rotateRight(wordAt(schedule, i - 15), 18) ^
                (wordAt(schedule, i - 15) >>> 3);
            const sigma1 =
                rotateRight(wordAt(schedule, i - 2), 17) ^
                rotateRight(wordAt(schedule, i - 2), 19) ^
                (wordAt(schedule, i - 2) >>> 10);
            schedule[i] =
                (wordAt(schedule, i - 16) +
                    sigma0 +
                    wordAt(schedule, i - 7) +
                    sigma1) >>>
                0;
        }

        let a = h0,
            b = h1,
            c = h2,
            d = h3;
        let e = h4,
            f = h5,
            g = h6,
            hh = h7;

        // 64 compression rounds.
        for (let i = 0; i < 64; i++) {
            const sigma1 =
                rotateRight(e, 6) ^ rotateRight(e, 11) ^ rotateRight(e, 25);
            const choose = (e & f) ^ (~e & g);
            const temp1 =
                (hh +
                    sigma1 +
                    choose +
                    wordAt(SHA256_K, i) +
                    wordAt(schedule, i)) >>>
                0;
            const sigma0 =
                rotateRight(a, 2) ^ rotateRight(a, 13) ^ rotateRight(a, 22);
            const majority = (a & b) ^ (a & c) ^ (b & c);
            const temp2 = (sigma0 + majority) >>> 0;

            hh = g;
            g = f;
            f = e;
            e = (d + temp1) >>> 0;
            d = c;
            c = b;
            b = a;
            a = (temp1 + temp2) >>> 0;
        }

        h0 = (h0 + a) >>> 0;
        h1 = (h1 + b) >>> 0;
        h2 = (h2 + c) >>> 0;
        h3 = (h3 + d) >>> 0;
        h4 = (h4 + e) >>> 0;
        h5 = (h5 + f) >>> 0;
        h6 = (h6 + g) >>> 0;
        h7 = (h7 + hh) >>> 0;
    }

    return {
        words: [h0, h1, h2, h3, h4, h5, h6, h7],
        tail: final ? [] : Array.from(message.subarray(paddedLength)),
        sizeBytes,
    };
}

export function sha256CheckpointHex(checkpoint: Sha256Checkpoint): string {
    return advanceSha256(checkpoint, new Uint8Array(), true)
        .words.map((word) => word.toString(16).padStart(8, "0"))
        .join("");
}

/**
 * Lowercase 64-char SHA-256 hex digest of UTF-8 bytes (string) or raw bytes
 * (Uint8Array), computed with a dependency-free deterministic implementation.
 */
export function sha256Hex(content: string | Uint8Array): string {
    const bytes =
        typeof content === "string"
            ? new TextEncoder().encode(content)
            : content;
    return sha256CheckpointHex(advanceSha256(undefined, bytes));
}

/**
 * Deterministic JSON serialization that sorts object keys recursively so the
 * same logical value hashes identically regardless of key insertion order
 * (Convex re-serializes stored objects with sorted keys).
 */
export function stableStringify(value: unknown): string {
    if (value === null || typeof value !== "object") {
        return JSON.stringify(value);
    }
    if (Array.isArray(value)) {
        return `[${value.map(stableStringify).join(",")}]`;
    }
    const entries = Object.entries(value as Record<string, unknown>)
        .filter(([, v]) => v !== undefined)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`);
    return `{${entries.join(",")}}`;
}
