/** Compaction retains native output separately from its application disposition. */
export function successfulAuxiliaryResponse() {
    return { kind: "operations" as const, requests: [] };
}
