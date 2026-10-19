import type { Id } from "@convex/_generated/dataModel";
import { sha256Hex } from "@convex/domain/sourcePassages";
import {
    MAX_POLICY_RULE_ID_CHARS,
    MAX_VERIFIER_EVIDENCE_REFERENCES,
    MAX_VERIFIER_INPUT_HASH_CHARS,
    MAX_VERIFIER_REFERENCE_IDENTITY_CHARS,
    MAX_VERIFIER_STATEMENT_CHARS,
    assertWithinLength,
} from "@convex/domain/evidenceLimits";

export const VERIFIER_SCHEMA_VERSION = "semantic-verification-v1";
export const VERIFIER_ADAPTER_VERSION = "showcase-verifier-v1";

export type VerifierLabel = "entailed" | "contradicted" | "mixed";
export type VerifierEvidenceReference = {
    sourcePassageId: Id<"sourcePassages">;
    passageKey: string;
};
export type VerifierInput = {
    schemaVersion: typeof VERIFIER_SCHEMA_VERSION;
    adapterVersion: typeof VERIFIER_ADAPTER_VERSION;
    claimId: Id<"claims">;
    ruleId: string;
    statement: string;
    evidenceReferences: VerifierEvidenceReference[];
};
export type VerifierOutput = {
    label: VerifierLabel;
    evidenceReferences: VerifierEvidenceReference[];
};
export type VerifierRegistryEntry = {
    schemaVersion: typeof VERIFIER_SCHEMA_VERSION;
    adapterVersion: typeof VERIFIER_ADAPTER_VERSION;
    inputHash: string;
    output: VerifierOutput;
};
export type VerifierResult =
    | { status: "success"; output: VerifierOutput; inputHash: string }
    | { status: "unavailable"; reason: "no_registered_verifier_output" };

const verifierRegistry = new Map<string, Readonly<VerifierRegistryEntry>>();

function stableStringify(value: unknown): string {
    if (value === null || typeof value !== "object") {
        return JSON.stringify(value);
    }
    if (Array.isArray(value)) {
        return `[${value.map(stableStringify).join(",")}]`;
    }
    return `{${Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`)
        .join(",")}}`;
}

function deepFreeze<T>(value: T): T {
    if (
        value !== null &&
        typeof value === "object" &&
        !Object.isFrozen(value)
    ) {
        for (const child of Object.values(value)) {
            deepFreeze(child);
        }
        Object.freeze(value);
    }
    return value;
}

export function computeVerifierInputHash(input: VerifierInput): string {
    return sha256Hex(
        stableStringify({
            schemaVersion: input.schemaVersion,
            adapterVersion: input.adapterVersion,
            claimId: input.claimId,
            ruleId: input.ruleId,
            statement: input.statement,
            evidenceReferences: [...input.evidenceReferences].sort((a, b) =>
                `${a.sourcePassageId}:${a.passageKey}`.localeCompare(
                    `${b.sourcePassageId}:${b.passageKey}`,
                ),
            ),
        }),
    );
}

function assertReferenceBounds(reference: VerifierEvidenceReference): void {
    assertWithinLength(
        reference.sourcePassageId,
        MAX_VERIFIER_REFERENCE_IDENTITY_CHARS,
        "verifier source passage identity",
    );
    assertWithinLength(
        reference.passageKey,
        MAX_VERIFIER_REFERENCE_IDENTITY_CHARS,
        "verifier passage key",
    );
}

function validateOutput(
    output: VerifierOutput,
    allowedReferences: VerifierEvidenceReference[],
): void {
    for (const reference of output.evidenceReferences) {
        assertReferenceBounds(reference);
    }
    if (
        output.evidenceReferences.length === 0 ||
        output.evidenceReferences.length > MAX_VERIFIER_EVIDENCE_REFERENCES
    ) {
        throw new Error("Verifier evidence references exceed bounds");
    }
    const allowed = new Set(
        allowedReferences.map(
            (reference) =>
                `${reference.sourcePassageId}:${reference.passageKey}`,
        ),
    );
    for (const reference of output.evidenceReferences) {
        if (
            !allowed.has(`${reference.sourcePassageId}:${reference.passageKey}`)
        ) {
            throw new Error(
                "Verifier output references evidence outside its input",
            );
        }
    }
}

function deepEqual(left: unknown, right: unknown): boolean {
    if (left === right) return true;
    if (
        typeof left !== "object" ||
        typeof right !== "object" ||
        left === null ||
        right === null
    ) {
        return false;
    }
    if (Array.isArray(left) || Array.isArray(right)) {
        if (!Array.isArray(left) || !Array.isArray(right)) return false;
        return (
            left.length === right.length &&
            left.every((item, index) => deepEqual(item, right[index]))
        );
    }
    const leftRecord = left as Record<string, unknown>;
    const rightRecord = right as Record<string, unknown>;
    const leftEntries = Object.entries(leftRecord);
    if (leftEntries.length !== Object.keys(rightRecord).length) return false;
    return leftEntries.every(([key, value]) =>
        deepEqual(value, rightRecord[key]),
    );
}

export function registerShowcaseVerifier(
    entry: VerifierRegistryEntry,
): Readonly<VerifierRegistryEntry> {
    if (
        entry.schemaVersion !== VERIFIER_SCHEMA_VERSION ||
        entry.adapterVersion !== VERIFIER_ADAPTER_VERSION
    ) {
        throw new Error("Verifier registry version mismatch");
    }
    // Registration is a real boundary: refuse oversized identity payloads
    // before they can ever be persisted or replayed.
    assertWithinLength(
        entry.inputHash,
        MAX_VERIFIER_INPUT_HASH_CHARS,
        "verifier input hash",
    );
    for (const reference of entry.output.evidenceReferences) {
        assertReferenceBounds(reference);
    }
    const frozen = deepFreeze(structuredClone(entry));
    const existing = verifierRegistry.get(entry.inputHash);
    if (existing && !deepEqual(existing.output, frozen.output)) {
        throw new Error(
            "Verifier registry replay mismatch: same hash cannot change output",
        );
    }
    verifierRegistry.set(entry.inputHash, frozen);
    return frozen;
}

export function clearShowcaseVerifiers(): void {
    verifierRegistry.clear();
}

/** Exact deterministic replay. Registry metadata and output are untrusted. */
export function executeShowcaseVerifier(input: VerifierInput): VerifierResult {
    if (input.evidenceReferences.length > MAX_VERIFIER_EVIDENCE_REFERENCES) {
        throw new Error("Verifier input evidence references exceed bounds");
    }
    assertWithinLength(
        input.statement,
        MAX_VERIFIER_STATEMENT_CHARS,
        "verifier statement",
    );
    assertWithinLength(
        input.ruleId,
        MAX_POLICY_RULE_ID_CHARS,
        "verifier rule id",
    );
    for (const reference of input.evidenceReferences) {
        assertReferenceBounds(reference);
    }
    const inputHash = computeVerifierInputHash(input);
    const entry = verifierRegistry.get(inputHash);
    if (!entry) {
        return {
            status: "unavailable",
            reason: "no_registered_verifier_output",
        };
    }
    if (
        entry.schemaVersion !== input.schemaVersion ||
        entry.adapterVersion !== input.adapterVersion ||
        entry.inputHash !== inputHash
    ) {
        throw new Error("Verifier registry identity mismatch");
    }
    validateOutput(entry.output, input.evidenceReferences);
    return {
        status: "success",
        inputHash,
        output: structuredClone(entry.output),
    };
}
