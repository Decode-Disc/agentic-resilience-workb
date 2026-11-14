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
const supportedUse = (
    <>
        <Badge tone="ink">
            <WorkbenchIcon name="check" size={11} />
            Supported
        </Badge>{" "}
        <span style={{ color: "var(--muted-foreground)" }}>
            within the examined scope
        </span>
    </>
);
const useForReview = (
    <Badge tone="review">
        <span
            aria-hidden="true"
            className="size-[7px] rounded-full bg-review"
        />
        Illustrative appraisal · for review
    </Badge>
);
export const matrixRows: (MatrixRow & { changedAt: number })[] = [
    {
        id: "A-014",
        changedAt: Date.parse("2026-10-25T10:00:00Z"),
        text: "CCC reports insurer-configurable workflows connecting insurers and repairers.",
        kind: "fact",
        meta: "10-K p. 8",
        sourceStatus: "verified",
        uses: { Q1: "supports", Q2: "supports", Q3: "context" },
        passage: {
            text: "Insurers can configure workflows that route estimates and photos between their own teams and repair facilities.",
            meta: "Form 10-K · FY2025 · p. 8 ¶3 · illustrative excerpt",
            kind: "fact",
        },
        useDetails: {
            Q1: {
                rationale:
                    "Shows one workflow spanning insurers and repair facilities, which is the coordination Q1 tests.",
                control: supportedUse,
                limitation:
                    "Says nothing about who sets the routing rules. A-031 opposes Q1 on that point.",
                judgment: (
                    <Badge tone="review">
                        <span
                            aria-hidden="true"
                            className="size-[7px] rounded-full bg-review"
                        />
                        In Q1 appraisal v1 · for review
                    </Badge>
                ),
            },
            Q2: {
                rationale:
                    "Shared interfaces connect participants inside the same operational workflow.",
                control: supportedUse,
                limitation:
                    "Connectivity alone does not establish whether these integrations outlast the contract.",
                judgment: useForReview,
            },
            Q3: {
                rationale:
                    "Defines the workflow connections a substitute would need to reproduce.",
                control: supportedUse,
                limitation:
                    "Does not establish an exclusive or durable data position.",
                judgment: useForReview,
            },
        },
    },
    {
        id: "A-031",
        changedAt: Date.parse("2026-10-27T10:00:00Z"),
        text: "Workflow execution alone does not establish authority over insurer decisions.",
        kind: "counter",
        meta: "10-K p. 8",
        sourceStatus: "disputed",
        uses: { Q1: "opposes", Q3: "context" },
        passage: {
            text: "Assignment decisions follow rules each insurer sets within the platform.",
            meta: "Form 10-K · FY2025 · p. 8 ¶4 · illustrative excerpt",
            kind: "fact",
        },
        useDetails: {
            Q1: {
                rationale:
                    "Insurer-owned rules limit the claim that running the workflow establishes decision authority.",
                control: <Badge tone="counter">Contested</Badge>,
                limitation:
                    "The boundary between insurer decisions and platform execution still needs reconciliation.",
                judgment: useForReview,
            },
            Q3: {
                rationale:
                    "Locates a decision boundary that matters when interpreting the platform's data position.",
                control: <Badge tone="counter">Contested</Badge>,
                limitation:
                    "Ownership of routing rules does not determine ownership of all operational data.",
                judgment: useForReview,
            },
        },
    },
    {
        id: "A-027",
        changedAt: Date.parse("2026-10-26T10:00:00Z"),
        text: "Participants depend on the shared workflow to exchange estimate data.",
        kind: "inference",
        meta: "from A-014",
        sourceStatus: "verified",
        uses: { Q1: "context", Q2: "supports" },
        passage: {
            text: "The shared workflow exchanges estimate information between insurers and repair facilities.",
            meta: "Illustrative passage underlying A-014",
            kind: "fact",
        },
        useDetails: {
            Q1: {
                rationale:
                    "Explains why participants operate within one workflow without establishing who controls it.",
                control: supportedUse,
                limitation:
                    "Participation is distinct from authority over decisions.",
                judgment: useForReview,
            },
            Q2: {
                rationale:
                    "Operational exchanges explain why connected participants may depend on integrations.",
                control: supportedUse,
                limitation:
                    "The passage does not establish how long this dependency lasts.",
                judgment: useForReview,
            },
        },
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
        meta: "p. 8 ¶3",
        questions: ["Q1", "Q2", "Q3"],
        target: { pageId: "p8", passageId: "p3" },
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
        meta: "p. 8 ¶4",
        questions: ["Q1"],
        target: { pageId: "p8", passageId: "p4" },
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
        meta: "p. 8 ¶5",
        questions: ["Q2"],
        target: { pageId: "p8", passageId: "p5" },
        status: <Badge tone="ink">Restricted</Badge>,
        text: "Expected growth of network participation.",
        note: "A forecast, never used as an observed outcome.",
    },
];
