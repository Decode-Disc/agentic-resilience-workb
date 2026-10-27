import { Badge } from "@/components/ui/badge";
import type {
    InventoryDockProps,
    MatrixQuestion,
    MatrixRow,
    ReaderContribution,
    ReaderPage,
} from "@/components/workbench-ui";
import { ClaimGlyph, WorkbenchIcon } from "@/components/workbench-ui/glyphs";
export const distribution: InventoryDockProps["distribution"] = [
    { kind: "fact", count: 64 },
    { kind: "inference", count: 31 },
    { kind: "hypothesis", count: 14 },
    { kind: "unknown", count: 9 },
    { kind: "counter", count: 8 },
];
export const matrixQuestions: MatrixQuestion[] = [
    { id: "Q1", label: "Q1", title: "Coordination control" },
    { id: "Q2", label: "Q2", title: "Integrations beyond contracts" },
    { id: "Q3", label: "Q3", title: "Data position" },
];
export const matrixRows: (MatrixRow & { changedAt: number })[] = [
    {
        id: "A-014",
        changedAt: Date.parse("2026-10-25T10:00:00Z"),
        text: "CCC reports insurer-configurable workflows connecting insurers and repairers.",
        kind: "fact",
        meta: "10-K p. 8",
        uses: { Q1: "supports", Q2: "supports", Q3: "context" },
    },
    {
        id: "A-031",
        changedAt: Date.parse("2026-10-27T10:00:00Z"),
        text: "Workflow execution alone does not establish authority over insurer decisions.",
        kind: "counter",
        meta: "10-K p. 8",
        uses: { Q1: "opposes", Q3: "context" },
    },
    {
        id: "A-027",
        changedAt: Date.parse("2026-10-26T10:00:00Z"),
        text: "Participants depend on the shared workflow to exchange estimate data.",
        kind: "inference",
        meta: "from A-014",
        uses: { Q1: "context", Q2: "supports" },
    },
];
export const readerPages: ReaderPage[] = [
    {
        id: "p7",
        label: "p. 7",
        section: "Item 1 · Business",
        passages: [
            {
                id: "previous",
                text: "[Illustrative excerpt] The company provides software to insurers and repair facilities.",
            },
        ],
    },
    {
        id: "p8",
        label: "p. 8",
        section: "Item 1 · Business",
        passages: [
            {
                id: "p3",
                kind: "fact",
                meta: "¶3 · Supported",
                highlight: "selected",
                text: "Insurers can configure workflows that route estimates and photos between their own teams and repair facilities.",
            },
            {
                id: "p4",
                kind: "counter",
                label: "Conflict",
                meta: "¶4 · vs Q2 call",
                highlight: "conflict",
                text: "Assignment decisions follow rules each insurer sets within the platform.",
            },
            {
                id: "p5",
                kind: "hypothesis",
                label: "Projection",
                meta: "¶5 · outlook",
                highlight: "projection",
                text: "The company expects participation in its network to continue to grow.",
            },
            {
                id: "other",
                quiet: true,
                text: "[Illustrative excerpt] The platform also supports parts procurement and payments.",
            },
        ],
    },
    {
        id: "p9",
        label: "p. 9",
        section: "Item 1 · Business",
        passages: [
            {
                id: "next",
                text: "[Illustrative excerpt] Additional business context.",
            },
        ],
    },
];
export const readerContributions: ReaderContribution[] = [
    {
        id: "a14",
        kind: "fact",
        meta: "p. 8 ¶3 · Q1 Q2 Q3",
        status: (
            <Badge tone="ink">
                <WorkbenchIcon name="check" size={11} strokeWidth={2.4} />
                Supported
            </Badge>
        ),
        text: "Insurers configure workflows connecting them to repair facilities.",
    },
    {
        id: "a31",
        kind: "fact",
        meta: "p. 8 ¶4 · Q1",
        status: (
            <Badge tone="counter">
                <ClaimGlyph kind="counter" />
                Conflict
            </Badge>
        ),
        text: "Insurers set assignment rules inside the platform.",
        note: "The Q2 call describes CCC-recommended routing. Periods match; definitions differ.",
    },
    {
        id: "projection",
        kind: "hypothesis",
        label: "Projection",
        meta: "p. 8 ¶5 · Q2",
        status: <Badge tone="ink">Restricted</Badge>,
        text: "Expected growth of network participation.",
        note: "A forecast, never used as an observed outcome.",
    },
];
