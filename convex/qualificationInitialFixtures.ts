export const initialFixtureIds = [
    "sources_correction",
    "sources_completed_partial",
    "sources_interrupted_partial",
] as const;

export const simulatedSourceText =
    "Simulation only. This fixture describes a documentary workflow. A researcher discovers a candidate, captures its text, reads an exact passage, and submits the passage for documentary control. It establishes no fact about any company and supports no economic conclusion.";

export const initialDocumentaryMaterial = {
    version: 1,
    title: "Retained illustrative documentary fixture — not live evidence",
    url: "https://example.org/workbench/fixtures/documentary-workflow",
    text: simulatedSourceText,
    statement:
        "The illustrative fixture describes a researcher capturing and reading documentary material.",
    gap: `${"The retained illustrative material describes documentary preparation. ".repeat(8)}It does not establish customer-level switching costs, operational dependency or independent corroboration for the selected company.`,
    unfinished:
        "The customer comparison remains technically unfinished; this is not a finding that supporting evidence is absent.",
} as const;

/** These exact fixture bytes are frozen by both the CLI and the local fixture owner. */
export function initialFixtureContent(id: (typeof initialFixtureIds)[number]) {
    return JSON.stringify({ id, ...initialDocumentaryMaterial });
}
