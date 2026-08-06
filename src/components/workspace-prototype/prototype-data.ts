export type PrototypeVariant = "a" | "b" | "c";

export type PrototypeClaim = {
    id: string;
    classification: "Fact" | "Inference" | "Unknown";
    statement: string;
    dimension: string;
    evidence: string;
    locator: string;
    counterEvidence: string;
    status: "Approved" | "Needs review" | "Unresolved";
};

export const prototypeClaims = [
    {
        id: "claim-01",
        classification: "Fact",
        statement:
            "CCC connects insurers, repair facilities, parts suppliers, and other participants through a shared cloud platform.",
        dimension: "Workflow control",
        evidence: "CCC Intelligent Solutions 2025 Form 10-K",
        locator: "Business overview, p. 8, paragraph 2",
        counterEvidence:
            "The filing does not quantify exclusive workflow share.",
        status: "Approved",
    },
    {
        id: "claim-02",
        classification: "Inference",
        statement:
            "Embedded repair and claims workflows may make replacement more disruptive than replacing a point solution.",
        dimension: "Context ownership",
        evidence: "CCC Intelligent Solutions 2025 Form 10-K",
        locator: "Platform and network discussion, p. 12, paragraphs 1–3",
        counterEvidence:
            "Public evidence does not isolate switching costs from contract duration or implementation effort.",
        status: "Needs review",
    },
    {
        id: "claim-03",
        classification: "Unknown",
        statement:
            "The durability of CCC's orchestration advantage under agent-native insurance workflows is not established publicly.",
        dimension: "Agentic exposure",
        evidence: "Cross-source evidence review",
        locator: "Coverage gap AR-07",
        counterEvidence:
            "Recent product announcements describe AI functionality but do not establish durable economic control.",
        status: "Unresolved",
    },
] as const satisfies readonly PrototypeClaim[];

export const prototypeDimensions = [
    {
        name: "Context ownership",
        position: "Defensible",
        confidence: "Medium",
        direction: "Stable",
    },
    {
        name: "Workflow control",
        position: "Strong",
        confidence: "High",
        direction: "Strengthening",
    },
    {
        name: "Distribution leverage",
        position: "Mixed or unclear",
        confidence: "Low",
        direction: "Unclear",
    },
    {
        name: "Agentic exposure",
        position: "Mixed or unclear",
        confidence: "Low",
        direction: "Weakening",
    },
] as const;

export const prototypeSources = [
    { name: "2025 Form 10-K", type: "SEC filing", decision: "Accepted" },
    { name: "Q1 2026 earnings call", type: "Transcript", decision: "Accepted" },
    {
        name: "Repairer integration review",
        type: "Independent",
        decision: "Accepted",
    },
    {
        name: "Vendor-sponsored AI survey",
        type: "Industry survey",
        decision: "Rejected",
    },
] as const;

export const prototypeVariantLabels: Record<PrototypeVariant, string> = {
    a: "Navigation rail",
    b: "Master–detail",
    c: "Long-form dossier",
};
