export function configurableCampaign() {
    return {
        version: 2,
        key: "configurable-campaign",
        objective:
            "Compare declared model configurations through independently configured Sources scenarios",
        capability: "sources",
        mode: "live",
        configurations: ["first", "second"].map((id) => ({
            id,
            purpose: "quality",
            models: {
                workbench: {
                    model: `fixture/${id}-workbench`,
                    reasoning: "recommended",
                },
                sources: {
                    model: `fixture/${id}-sources`,
                    reasoning: "recommended",
                },
            },
        })),
        scenarios: ["claims", "creative", "platform"].map((id, index) => ({
            id,
            company: {
                cik: String(1000000 + index),
                name: `Simulation company ${index}`,
                ticker: `FIX${index}`,
                websiteUrl: "https://example.com",
            },
            framing: {
                scope: `Simulation documentary workflow ${index}`,
                questions: [
                    {
                        id: "position",
                        text: "Which participants control this workflow?",
                        shortLabel: "Control",
                        rationale:
                            "Inspect documentary evidence before drawing conclusions.",
                    },
                ],
            },
            steps: [
                { id: "frame", action: "save_framing" },
                { id: "start", action: "start_research" },
                {
                    id: "handoff",
                    action: "wait_for",
                    state: "sources_prepared",
                },
            ],
        })),
        expectations: ["claims", "creative", "platform"].map((id) => ({
            id,
            checks: ["documentary-handoff"],
        })),
        correctionPaths: ["convex", "scripts/evaluations/workbench-browser"],
        maximumLots: 4,
        repetitionsPerCandidate: 2,
        expiresAt: Date.now() + 3600000,
        perLot: { model: 60, search: 6, acquisition: 18, costUsd: 3 },
        total: { model: 120, search: 12, acquisition: 36, costUsd: 6 },
    };
}
