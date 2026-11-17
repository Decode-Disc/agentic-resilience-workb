export type RetrievalBenchmarkSource = {
    anchors: readonly [string, string, string];
    id: string;
    sourceClass: "first_party" | "third_party";
    title: string;
    url: string;
};

export const RETRIEVAL_BENCHMARK_CORPUS = [
    {
        anchors: ["auto physical damage", "claims", "CCC"],
        id: "ccc-auto-physical-damage",
        sourceClass: "first_party",
        title: "CCC Auto Physical Damage",
        url: "https://www.cccis.com/insurance-carriers/apd",
    },
    {
        anchors: ["CCC First Look", "AI", "total loss"],
        id: "ccc-first-look",
        sourceClass: "first_party",
        title: "CCC First Look",
        url: "https://www.cccis.com/insurance-carriers/claims-solutions/apd/ccc-first-look",
    },
    {
        anchors: ["claims processing", "workflow", "CCC"],
        id: "ccc-claims-processing",
        sourceClass: "first_party",
        title: "CCC Claims Processing",
        url: "https://www.cccis.com/insurance-carriers/apd/claims-processing",
    },
    {
        anchors: ["claims estimating", "estimate", "repair"],
        id: "ccc-claims-estimating",
        sourceClass: "first_party",
        title: "CCC Claims Estimating",
        url: "https://www.cccis.com/insurance-carriers/apd/claims-estimating",
    },
    {
        anchors: ["CCC IX Cloud", "cloud platform", "data"],
        id: "ccc-ix-cloud-platform",
        sourceClass: "first_party",
        title: "CCC IX Cloud Platform",
        url: "https://www.cccis.com/our-technology/ix-cloud-platform",
    },
    {
        anchors: ["CCC Secure Share", "data", "collision repair"],
        id: "ccc-secure-share",
        sourceClass: "first_party",
        title: "CCC Secure Share",
        url: "https://www.cccis.com/secure-share",
    },
    {
        anchors: [
            "Crash Course",
            "artificial intelligence",
            "collision claims",
        ],
        id: "repairer-driven-news-crash-course",
        sourceClass: "third_party",
        title: "CCC Crash Course report on AI and collision claims",
        url: "https://www.repairerdrivennews.com/2023/03/14/ccc-2023-crash-course-report-explores-ai-effects-on-collision-claims-processes/",
    },
    {
        anchors: [
            "totaled auto losses",
            "CCC Intelligent Solutions",
            "total loss",
        ],
        id: "insurance-journal-total-losses",
        sourceClass: "third_party",
        title: "Why Totaled Auto Losses Are Hard to Pin Down",
        url: "https://www.insurancejournal.com/magazines/mag-features/2024/03/04/762503.htm",
    },
    {
        anchors: ["NVIDIA DGX Cloud", "CCC", "auto repair estimates"],
        id: "nvidia-ccc-case-study",
        sourceClass: "third_party",
        title: "NVIDIA CCC AI-powered auto repair estimates case study",
        url: "https://www.nvidia.com/en-eu/case-studies/delivering-millions-of-ai-powered-auto-repair-estimates-for-better-claims-experiences/",
    },
    {
        anchors: ["CCC Intelligent Solutions", "Q1 2026", "earnings call"],
        id: "investing-ccc-q1-2026",
        sourceClass: "third_party",
        title: "CCC Intelligent Solutions Q1 2026 earnings call transcript",
        url: "https://www.investing.com/news/transcripts/earnings-call-transcript-ccc-intelligent-solutions-q1-2026-beats-forecasts-93CH-4654050",
    },
] as const satisfies readonly RetrievalBenchmarkSource[];
