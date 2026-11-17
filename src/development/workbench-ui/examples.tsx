import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DialogTrigger as LinearDialogTrigger } from "@/components/ui/linear-modal";
import {
    AppraisalBlock,
    BriefMarginNote,
    BriefReference,
    BriefSection,
    Chip,
    ControlConclusion,
    Cover,
    EvidenceLeaf,
    EvidenceMatrix,
    FramingControls,
    GlassPanel,
    Handoff,
    HypothesisNode,
    InventoryDock,
    MechanismDiagram,
    MechanismNode,
    MechanismRelations,
    OutcomeCard,
    ProgressTimeline,
    QuestionCard,
    RequestItem,
    SourceReader,
    SourcingLane,
    WorkCard,
} from "@/components/workbench-ui";
import { WorkbenchIcon } from "@/components/workbench-ui/glyphs";
import { cn } from "@/lib/utils";
import { AgentActivityExample } from "./agent-activity-example";
import { AgentActivityHistoryExample } from "./agent-activity-history-example";
import { ComposerExample } from "./composer-example";
import { DossierSwitcherExample } from "./dossier-switcher-example";
import {
    distribution,
    matrixQuestions,
    matrixRows,
    readerContributions,
    readerPages,
} from "./fixture-data";
import { IllustrativeInventorySheet } from "./inventory-sheet-fixture";
import { OverlayLayersExample } from "./overlay-layers-example";

function notify(message: string) {
    window.dispatchEvent(
        new CustomEvent("workbench-example-action", { detail: message }),
    );
}

import BadgeStyles from "./badge-example.module.css";
import ButtonStyles from "./button-example.module.css";
import MechanismNodeStyles from "./mechanism-example.module.css";

function ChipExample() {
    return (
        <div className="grid gap-[14px]">
            <div className="flex flex-wrap items-center gap-[10px]">
                {[
                    "// 01 · States",
                    "// Investigation · review",
                    "// Examine the evidence",
                ].map((t) => (
                    <Chip key={t}>{t}</Chip>
                ))}
            </div>
            <div className="flex flex-wrap items-center gap-[10px]">
                <Chip kind="curated">Curated</Chip>
                <Chip kind="illustrative">Illustrative</Chip>
                <Chip>Showcase</Chip>
                <Chip kind="live">Live</Chip>
                <Chip kind="not-live">Not live</Chip>
            </div>
        </div>
    );
}
function GlassPanelExample() {
    return (
        <div className="grid grid-cols-4 gap-[14px]">
            <GlassPanel emphasis="ordinary">
                <span className="wb-label">Sources</span>
                <span className="text-[15px] font-semibold">Glass panel</span>
                <span className="text-[13px] leading-[19px] text-muted-foreground">
                    Ordinary working surface. Rows inside are split by divider
                    hairlines.
                </span>
                <span
                    className="wb-meta wb-divider"
                    style={{ marginTop: "auto", paddingTop: 10 }}>
                    surface-glass · shadow-glass
                </span>
            </GlassPanel>
            <GlassPanel emphasis="focal">
                <span
                    className="wb-label"
                    style={{ color: "var(--accent-foreground)" }}>
                    Investigation
                </span>
                <span className="text-[15px] font-semibold">Focal</span>
                <span className="text-[13px] leading-[19px] text-muted-foreground">
                    The one surface running now or awaiting a decision now.
                </span>
                <span
                    className="wb-meta wb-divider"
                    style={{ marginTop: "auto", paddingTop: 10 }}>
                    shadow-focal · one per screen
                </span>
            </GlassPanel>
            <GlassPanel emphasis="waiting">
                <span className="wb-label">Waits for you</span>
                <span className="text-[15px] font-semibold">
                    Pending judgment
                </span>
                <span className="text-[13px] leading-[19px] text-muted-foreground">
                    A targeted decision is open. Only dependent delivery waits.
                </span>
                <span
                    className="wb-meta wb-divider"
                    style={{ marginTop: "auto", paddingTop: 10 }}>
                    shadow-review
                </span>
            </GlassPanel>
            <GlassPanel emphasis="unfinished">
                <span className="wb-label">Execution</span>
                <span
                    className="text-[15px] font-semibold"
                    style={{ color: "var(--muted-foreground)" }}>
                    Unfinished work
                </span>
                <span className="text-[13px] leading-[19px] text-muted-foreground">
                    Assigned, not performed. Never relabelled as an unknown.
                </span>
                <span
                    className={cn("wb-meta", undefined)}
                    style={{ marginTop: "auto", paddingTop: 10 }}>
                    edge-dashed · 1.5px
                </span>
            </GlassPanel>
        </div>
    );
}
function CoverExample() {
    return (
        <Cover
            title="Agentic Resilience Workbench"
            subtitle="Question-led research where every claim says what it is, where it comes from and who judged it."
            section="// Evidence workbench"
            appraisalLabel="Q1 · Proposed appraisal"
            reading="CCC coordinates the claim; whether it decides remains unestablished."
            balance={[9, 4, 3]}
        />
    );
}
function FramingControlsExample() {
    const [selected, setSelected] = useState(["claim"]);
    return (
        <FramingControls
            angles={[
                {
                    id: "control",
                    label: "Who controls the workflow once agents handle the intake?",
                },
                {
                    id: "replace",
                    label: "Which integrations would an agent have to replace?",
                },
            ]}
            onAngle={notify}
            userTurn="Focus on whether CCC holds the claim workflow."
            options={[
                { id: "claim", label: "Claim workflow" },
                { id: "data", label: "Data position" },
                { id: "agent", label: "Agent substitution" },
            ]}
            selected={selected}
            onOption={(id) =>
                setSelected((current) =>
                    current.includes(id)
                        ? current.filter((x) => x !== id)
                        : [...current, id],
                )
            }
            replies={[
                { id: "narrow", label: "Narrow to auto claims" },
                { id: "add", label: "Add a question" },
            ]}
            onReply={notify}
            onStart={() => notify("Start research")}>
            Here is a proposed framing. Refine it, or start research as is.
        </FramingControls>
    );
}
function SourcingLaneExample() {
    return (
        <div className="grid max-w-[900px] grid-cols-3 gap-[14px]">
            <SourcingLane
                state="found"
                label="Found"
                count={6}
                documents={[
                    {
                        id: "press",
                        format: "PRESS",
                        title: "Repair networks and claims",
                        meta: "trade press · just found",
                        fresh: true,
                    },
                    {
                        id: "8k",
                        format: "8-K",
                        title: "Form 8-K · partnership",
                        meta: "sec.gov",
                    },
                ]}
                remainingLabel="+4 more"
            />
            <SourcingLane
                state="capturing"
                label="Capturing"
                count={2}
                documents={[
                    {
                        id: "call",
                        format: "CALL",
                        title: "Q2 2025 earnings call",
                        meta: "transcript · 62%",
                    },
                    {
                        id: "deck",
                        format: "DECK",
                        title: "Investor day 2025 deck",
                        meta: "slides · 30%",
                    },
                ]}
            />
            <SourcingLane
                state="captured"
                label="Captured"
                count={30}
                documents={[
                    {
                        id: "10k",
                        format: "10-K",
                        title: "Form 10-K · FY2025",
                        meta: "sec.gov · 142 pages",
                    },
                    {
                        id: "q1",
                        format: "CALL",
                        title: "Q1 2025 earnings call",
                        meta: "transcript",
                    },
                ]}
                remainingLabel="+28 more"
            />
        </div>
    );
}
function HandoffExample() {
    return (
        <Handoff
            summary="38 captured · 29 selected · 9 kept as context"
            gaps="2 gaps disclosed"
            onContinue={() => notify("Progress")}
            onStay={() => notify("Stayed")}
        />
    );
}
function ProgressTimelineExample() {
    return (
        <ProgressTimeline
            steps={[
                { id: "framing", label: "Framing", state: "done" },
                { id: "sources", label: "Sources", state: "done" },
                {
                    id: "investigation",
                    label: "Investigation",
                    state: "current",
                },
                { id: "review", label: "Review", state: "upcoming" },
                { id: "synthesis", label: "Synthesis", state: "upcoming" },
            ]}
            title="Common inquiry"
            status={
                <Badge tone="inference" showDot="running">
                    Running
                </Badge>
            }
            legend="supports · opposes · context"
            rows={[
                {
                    id: "Q1",
                    label: "Coordination control or substitutable modules",
                    balance: [9, 4, 3],
                    badge: (
                        <Badge tone="ink">
                            <WorkbenchIcon
                                name="check"
                                size={11}
                                strokeWidth={2.4}
                            />
                            Appraisal drafted
                        </Badge>
                    ),
                },
                {
                    id: "Q2",
                    label: "Integrations beyond contract terms",
                    current: true,
                    badge: (
                        <Badge tone="inference" showDot="running">
                            Testing
                        </Badge>
                    ),
                },
            ]}
        />
    );
}
function WorkCardExample() {
    return (
        <div className="grid grid-cols-[300px_300px] items-start gap-[16px]">
            <div className="flex flex-col gap-[16px]">
                <WorkCard
                    kind="sources"
                    documentLabel="10-K · FY2025"
                    documentCount={38}
                    onOpen={() => notify("Sources")}>
                    Filings, calls and investor material.{" "}
                    <b style={{ color: "var(--foreground)", fontWeight: 500 }}>
                        2 documentary gaps
                    </b>{" "}
                    disclosed.
                </WorkCard>
                <WorkCard
                    kind="investigation"
                    status="Q2 now"
                    footer="Persisted · resumes where it stopped"
                    onOpen={() => notify("Investigation")}>
                    {" "}
                    <span
                        className="flex items-start gap-[10px] text-[13px] leading-[18px] text-muted-foreground"
                        style={{ color: "var(--foreground)" }}>
                        <span
                            style={{
                                flexShrink: "0",
                                marginTop: "5px",
                                width: "7px",
                                height: "7px",
                                borderRadius: "50%",
                                background: "var(--brand-purple)",
                            }}></span>
                        Testing whether integrations hold beyond contract terms
                    </span>
                    <span className="flex items-start gap-[10px] text-[13px] leading-[18px] text-muted-foreground">
                        <span
                            style={{
                                marginTop: "1px",
                                color: "var(--evidence-inference)",
                            }}>
                            <svg
                                width="7"
                                height="7"
                                viewBox="0 0 10 10"
                                style={{ width: 7, height: 7 }}
                                aria-hidden="true">
                                <path
                                    d="M5 0L10 10H0Z"
                                    fill="currentColor"></path>
                            </svg>
                        </span>
                        A-027 admitted as inference
                    </span>
                    <span className="flex items-start gap-[10px] text-[13px] leading-[18px] text-muted-foreground">
                        <span style={{ color: "var(--counter-evidence)" }}>
                            <svg
                                width="7"
                                height="7"
                                viewBox="0 0 10 10"
                                style={{ width: 7, height: 7 }}
                                aria-hidden="true">
                                <rect
                                    y="3.5"
                                    width="10"
                                    height="3"
                                    rx="1"
                                    fill="currentColor"></rect>
                            </svg>
                        </span>
                        Conflict found · 10-K ↔ Q2 call
                    </span>
                </WorkCard>
            </div>
            <WorkCard kind="locked">
                Opens once you retain the appraisals.
            </WorkCard>
        </div>
    );
}
function InventoryDockExample() {
    return (
        <div className="flex flex-wrap items-end gap-[24px]">
            <InventoryDock
                expanded
                total={126}
                newCount={3}
                distribution={distribution}
                changes={[
                    {
                        id: "new",
                        status: <Badge tone="inference">New</Badge>,
                        text: "A-052 · participation beyond contracts",
                    },
                    {
                        id: "corrected",
                        status: <Badge tone="ink">Corrected</Badge>,
                        text: "A-019 · period narrowed",
                    },
                ]}
                onOpen={() => notify("Inventory")}
            />
            <InventoryDock
                total={126}
                newCount={3}
                distribution={distribution}
                onOpen={() => notify("Inventory")}
            />
        </div>
    );
}
function InventorySheetExample() {
    const [open, setOpen] = useState(false);
    return (
        <IllustrativeInventorySheet
            open={open}
            onOpenChange={setOpen}
            trigger={
                <LinearDialogTrigger render={<Button />}>
                    Open inventory
                </LinearDialogTrigger>
            }
        />
    );
}
function EvidenceMatrixExample() {
    const [q, setQ] = useState("Q1");
    const [assertion, setAssertion] = useState("A-014");
    return (
        <EvidenceMatrix
            questions={matrixQuestions}
            rows={matrixRows}
            selectedQuestion={q}
            selectedAssertion={assertion}
            onSelectQuestion={setQ}
            onSelectUse={(a, b) => {
                setAssertion(a);
                setQ(b);
                notify(`${a} · ${b}`);
            }}
            onChallengeUse={(a, q) =>
                notify(`Illustrative action: challenge ${a} for ${q}`)
            }
            onOpenPassage={(a) =>
                notify(`Illustrative action: open passage for ${a}`)
            }
            onOpenQuestionReasoning={(q) =>
                notify(`Illustrative action: inspect ${q} reasoning`)
            }
        />
    );
}
function SourceReaderExample() {
    return (
        <div style={{ height: 720 }}>
            <SourceReader
                title="Form 10-K · FY2025"
                meta="sec.gov · capture v1 · complete capture · 142 pages"
                pages={readerPages}
                contributionLabel="Company-authored · annual report"
                contributions={readerContributions}
            />
        </div>
    );
}
function QuestionCardExample() {
    return (
        <div className="grid max-w-[900px] grid-cols-2 gap-[16px]">
            <QuestionCard
                id="Q2"
                state="testing"
                question="Do integrations hold beyond contract terms?"
                reading="Participation looks durable, but only one source says why."
                balance={[6, 2, 3]}
                next="Next · test the renewal clauses"
                actionLabel="Open question"
                onOpen={() => notify("Q2")}
            />
            <QuestionCard
                id="Q4"
                state="waiting"
                question="Could an agent bypass it?"
                reading="No reading yet. The deciding fact is shared with Q1."
                request="Who holds decision rights over the routing rules?"
                next="Next · resumes when material returns"
                actionLabel="See request"
                onOpen={() => notify("Q4")}
            />
        </div>
    );
}
function HypothesisNodeExample() {
    return (
        <div className="grid gap-[18px]">
            <div className="flex flex-wrap items-stretch gap-[16px]">
                <HypothesisNode
                    state="holds"
                    detail="Best supported · confidence moderate">
                    CCC coordinates the claim without controlling it
                </HypothesisNode>
                <HypothesisNode
                    state="open"
                    detail="Cannot be settled with what was read">
                    CCC controls the decisions in the claim
                </HypothesisNode>
                <HypothesisNode
                    state="set-aside"
                    detail="Rests on an unsupported assumption">
                    CCC is a replaceable module
                </HypothesisNode>
            </div>
            <div className="flex flex-wrap items-stretch gap-[16px]">
                <EvidenceLeaf relation="for">
                    10-K: insurer-configurable workflows
                </EvidenceLeaf>
                <EvidenceLeaf relation="against">
                    Rules stay insurer-owned
                </EvidenceLeaf>
                <EvidenceLeaf relation="decides">
                    Who can change the routing rules?
                </EvidenceLeaf>
            </div>
        </div>
    );
}
function RequestItemExample() {
    return (
        <div className="wb-glass flex max-w-[620px] flex-col gap-[6px] rounded-2xl p-[10px]">
            <span className="flex items-center gap-[8px] p-[12px_8px_4px]">
                <span className="wb-label">Waits for you</span>
                <span className="wb-meta" style={{ marginLeft: "auto" }}>
                    1
                </span>
            </span>
            <RequestItem
                state="review"
                title="Q2 answer revised after a new premise"
                detail="Requested by Synthesis · v2 waits for your judgment, v1 stays retained."
                onOpen={() => notify("Review")}
            />
            <span className="flex items-center gap-[8px] p-[12px_8px_4px]">
                <span className="wb-label">Asked of Sources</span>
                <span className="wb-meta" style={{ marginLeft: "auto" }}>
                    3
                </span>
            </span>
            <RequestItem
                state="searching"
                title="Who holds decision rights over the routing rules?"
                detail="For Q1 and Q4 · searching filings and partner documentation"
                onOpen={() => notify("Request")}
            />
            <RequestItem
                state="unavailable"
                title="Renewal terms of the largest insurer contracts"
                detail="For Q2 · not public so far"
                onOpen={() => notify("Unavailable")}
            />
        </div>
    );
}
function AppraisalBlockExample() {
    return (
        <AppraisalBlock
            label="Q1 · Proposed appraisal · v1"
            interpretation={
                <>
                    CCC appears to <b>coordinate</b> the claim between insurers
                    and repairers. Whether it <b>decides</b> anything in that
                    flow remains unestablished.
                </>
            }
            confidence={{
                level: 2,
                label: "Moderate · limited by undocumented decision rights",
            }}
            support={{
                text: "CCC reports insurer-configurable workflows connecting insurers and repair facilities.",
                meta: "Company-reported · Annual Report, p. 8 · also used by Q3",
            }}
            objection={{
                text: "Workflow execution alone does not establish authority over insurer decisions.",
                meta: "Objection · insurer-configurable rules, p. 8",
            }}
            decisiveUnknown="Who can change routing and decision rules?"
            controlDetail="within examined scope"
            onCorrect={() => notify("Correct appraisal")}
            onRetain={() => notify("Retain appraisal")}
        />
    );
}
function ControlConclusionExample() {
    return (
        <div className="grid grid-cols-[minmax(0,3fr)_minmax(0,1fr)] gap-[14px]">
            <div
                className="wb-glass"
                style={{
                    borderRadius: "var(--radius-2xl)",
                    overflow: "hidden",
                    display: "flex",
                    flexDirection: "column",
                }}>
                <div className="flex items-center justify-between border-b border-divider p-[14px_24px]">
                    <span className="wb-label">
                        Conclusions about the material
                    </span>
                    <span className="wb-meta">3 outcomes</span>
                </div>
                <div
                    style={{
                        display: "grid",
                        gridTemplateColumns: "repeat(3,minmax(0,1fr))",
                    }}>
                    <ControlConclusion
                        kind="supported"
                        detail="within scope · 3 passages">
                        The examined passages support the proposition for its
                        stated use.
                    </ControlConclusion>
                    <div
                        style={{
                            borderLeft: "1px solid var(--divider)",
                            display: "flex",
                        }}>
                        <ControlConclusion
                            kind="conflict"
                            detail="10-K p. 8 ↔ transcript Q2">
                            Comparable elements oppose each other on an
                            identified point.
                        </ControlConclusion>
                    </div>
                    <div
                        style={{
                            borderLeft: "1px solid var(--divider)",
                            display: "flex",
                        }}>
                        <ControlConclusion
                            kind="unestablished"
                            detail="examined · 2 sources">
                            The examination does not establish it. Not a
                            refutation.
                        </ControlConclusion>
                    </div>
                </div>
            </div>
            <ControlConclusion
                kind="unfinished"
                detail="use blocked · retry named">
                Not a conclusion. The use it conditions stays blocked.
            </ControlConclusion>
        </div>
    );
}
function OutcomeCardExample() {
    return (
        <div className="grid grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)] gap-[14px] [@media(max-width:640px)]:grid-cols-1 [@media(max-width:640px)]:gap-[24px]">
            <div className="flex flex-col gap-[10px]">
                <span className="flex items-center gap-[10px]">
                    <span
                        style={{
                            width: "22px",
                            borderTop: "2px solid var(--foreground)",
                        }}></span>
                    <span
                        className="wb-label"
                        style={{ color: "var(--foreground)" }}>
                        Analytical results
                    </span>
                </span>
                <div className="grid grid-cols-2 gap-[10px] [@media(max-width:640px)]:grid-cols-1">
                    <OutcomeCard
                        kind="appraisal"
                        title="Reasoned appraisal"
                        next="→ goes to grouped review">
                        Answers the question with support, objections and the
                        decisive unknown.
                    </OutcomeCard>
                    <OutcomeCard
                        kind="insufficiency"
                        title="Justified insufficiency"
                        next="→ a finding, not a gap">
                        Investigated. The evidence cannot carry an answer; what
                        was examined is stated.
                    </OutcomeCard>
                    <OutcomeCard
                        kind="limited"
                        title="Limited synthesis"
                        next="→ scope shown on the diagram">
                        A coherent reading on an explicit, reduced scope.
                    </OutcomeCard>
                    <OutcomeCard
                        kind="non-establishment"
                        title="Non-establishment"
                        next="→ note without diagram">
                        No supported mechanism. Reasoned in prose, never a
                        forced diagram.
                    </OutcomeCard>
                </div>
            </div>
            <div className="flex flex-col gap-[10px]">
                <span className="flex items-center gap-[10px]">
                    <span
                        style={{
                            width: "10px",
                            height: "10px",
                            borderRadius: "50%",
                            background: "var(--review)",
                        }}></span>
                    <span
                        className="wb-label"
                        style={{ color: "var(--foreground)" }}>
                        Waits for you
                    </span>
                </span>
                <OutcomeCard
                    kind="pending"
                    title="Pending judgment"
                    next="→ decision in context">
                    A targeted decision is open. Only dependent delivery waits.
                </OutcomeCard>
                <OutcomeCard
                    kind="no-retained"
                    title="No retained appraisal"
                    next="→ not insufficiency">
                    Synthesis cannot start. Return to review.
                </OutcomeCard>
            </div>
            <div className="flex flex-col gap-[10px]">
                <span className="flex items-center gap-[10px]">
                    <span
                        style={{
                            width: "22px",
                            borderTop: "2px dashed var(--muted-foreground)",
                        }}></span>
                    <span className="wb-label">Work not done</span>
                </span>
                <OutcomeCard
                    kind="unfinished"
                    title="Unfinished work"
                    next="→ resume or release">
                    Assigned, not performed. Never relabelled as an unknown.
                </OutcomeCard>
                <OutcomeCard
                    kind="interruption"
                    title="Technical interruption"
                    next="→ retry from checkpoint">
                    Completed work kept. Recovery is named.
                </OutcomeCard>
            </div>
        </div>
    );
}
function MechanismNodeExample() {
    const styles = MechanismNodeStyles;
    return (
        <MechanismDiagram
            selection={
                <GlassPanel className={styles.selected}>
                    <span className={styles.label}>Selected · dependency</span>
                    <b className={styles.selectedTitle}>
                        Coordination depends on insurer-owned rules
                    </b>
                    <span className={styles.selectedDescription}>
                        Running the flow is not deciding it. Insurers keep the
                        rules.
                    </span>
                    <span className={styles.selectedFooter}>
                        <span className={styles.meta}>Q1 v1 · 4 passages</span>
                        <Button
                            variant="link"
                            className={styles.openPassages}
                            onClick={() => notify("Open passages · Q1 v1")}>
                            Open passages
                        </Button>
                    </span>
                </GlassPanel>
            }>
            <MechanismRelations
                width={936}
                height={768}
                relations={[
                    {
                        id: "depends-on",
                        path: "M99 4L4 4",
                        viewport: { x: 239, y: 380, width: 99, height: 8 },
                        filter: "drop-shadow(0 0 4px color-mix(in oklab,var(--brand-purple) 60%,transparent))",
                    },
                    {
                        id: "enables",
                        path: "M99 4L4 4",
                        viewport: { x: 599, y: 380, width: 99, height: 8 },
                        stroke: "var(--foreground)",
                        strokeDasharray: "6 6",
                    },
                    {
                        id: "unresolved",
                        path: "M4 0L4 176",
                        viewport: { x: 464, y: 152, width: 8, height: 176 },
                        stroke: "var(--muted-foreground)",
                        strokeWidth: 1.5,
                        strokeDasharray: "4 5",
                        arrow: false,
                    },
                    {
                        id: "could-bypass",
                        path: "M4 175L4 4",
                        viewport: { x: 464, y: 441, width: 8, height: 175 },
                        stroke: "var(--counter-evidence)",
                    },
                    {
                        id: "contested",
                        path: "M4 135L4 4",
                        viewport: { x: 794, y: 433, width: 8, height: 135 },
                        stroke: "var(--review-foreground)",
                        strokeDasharray: "0.5 6",
                    },
                    {
                        id: "selection",
                        path: "M4 0L4 66",
                        viewport: { x: 284, y: 288, width: 8, height: 66 },
                        strokeWidth: 1.2,
                        strokeDasharray: "2 4",
                        arrow: false,
                    },
                ]}
            />
            <MechanismNode
                kind="actor"
                label="Actor · insurers"
                className={styles.node}
                style={{ left: 38, top: 336 }}>
                Insurer-owned rules
            </MechanismNode>
            <MechanismNode
                kind="observed"
                label="Observed role · CCC"
                detail="Q1 · Q2 retained"
                className={styles.node}
                style={{ left: 338, top: 328 }}>
                Cross-party coordination
            </MechanismNode>
            <MechanismNode
                kind="participant"
                label="Actors · repairers"
                className={styles.node}
                style={{ left: 698, top: 336 }}>
                Network participation
            </MechanismNode>
            <MechanismNode
                kind="unknown"
                label="Decisive unknown"
                className={styles.node}
                style={{ left: 348, top: 72 }}>
                Who changes routing rules?
            </MechanismNode>
            <MechanismNode
                kind="threat"
                label="Possible threat"
                className={styles.node}
                style={{ left: 348, top: 616 }}>
                Insurer direct routing
            </MechanismNode>
            <MechanismNode
                kind="contested"
                label="Contested"
                className={styles.node}
                style={{ left: 698, top: 568 }}>
                Durable operational context
            </MechanismNode>
            <MechanismNode
                kind="outside"
                label="Outside this reading"
                className={styles.node}
                style={{ left: 38, top: 568 }}>
                Q4 · agent-led intake, left for follow-up
            </MechanismNode>
            <span
                className={styles.relation}
                style={{
                    left: 248,
                    top: 356,
                    width: 80,
                    color: "var(--accent-foreground)",
                }}>
                depends on
            </span>
            <span
                className={styles.relation}
                style={{ left: 616, top: 356, width: 64 }}>
                enables
            </span>
            <span
                className={styles.relation}
                style={{
                    left: 480,
                    top: 232,
                    width: 80,
                    textAlign: "left",
                    color: "var(--muted-foreground)",
                    fontWeight: 400,
                }}>
                unresolved
            </span>
            <span
                className={styles.relation}
                style={{
                    left: 480,
                    top: 520,
                    width: 92,
                    textAlign: "left",
                    color: "var(--counter-evidence)",
                }}>
                could bypass
            </span>
            <span
                className={styles.relation}
                style={{
                    left: 810,
                    top: 484,
                    width: 72,
                    textAlign: "left",
                    color: "var(--review-foreground)",
                }}>
                sustains
                <br />
                contested
            </span>
        </MechanismDiagram>
    );
}
function BriefReferenceExample() {
    return (
        <div className="grid max-w-[860px] grid-cols-[minmax(0,1fr)_240px] gap-[28px]">
            <BriefSection
                label="2 · The observed role"
                title="CCC coordinates the claim; it does not decide it">
                {"The examined filings describe "}
                <BriefReference
                    kind="mechanism"
                    active
                    onActivate={() => notify("Coordination")}>
                    Cross-party coordination
                </BriefReference>
                {" between insurers and repairers "}
                <BriefReference
                    kind="evidence"
                    onActivate={() => notify("A-014")}>
                    A-014
                </BriefReference>
                {". The rules that route a claim remain "}
                <BriefReference
                    kind="mechanism"
                    onActivate={() => notify("Rules")}>
                    Insurer-owned rules
                </BriefReference>{" "}
                <BriefReference
                    kind="evidence"
                    onActivate={() => notify("A-031")}>
                    A-031
                </BriefReference>
                {", and who may change them is not established."}
            </BriefSection>
            <BriefMarginNote
                label="Margin · scope"
                status={
                    <Badge tone="approved">
                        <WorkbenchIcon
                            name="check"
                            size={11}
                            strokeWidth={2.4}
                        />
                        Retained · v1
                    </Badge>
                }>
                Reading limited to Q1 and Q2. Q3 stays out of scope until its
                appraisal is retained.
            </BriefMarginNote>
        </div>
    );
}
function ButtonExample() {
    const styles = ButtonStyles;
    return (
        <>
            <div className={cn(styles.row)}>
                <Button variant="default">Open workbench</Button>
                <Button variant="outline">Add source link</Button>
                <Button variant="secondary">Inspect sources</Button>
                <Button variant="ghost">Show details</Button>
                <Button variant="destructive">Remove reference</Button>
                <Button variant="link">Open original</Button>
                <Button variant="default" disabled>
                    Disabled
                </Button>
            </div>
            <div className={cn(styles.row)} style={{ marginTop: "1.25rem" }}>
                <Button variant="launch">
                    Start research
                    <WorkbenchIcon name="chevron" size={16} strokeWidth={1.8} />
                </Button>
                <Button variant="round" aria-label="Continue">
                    <WorkbenchIcon name="chevron" size={18} strokeWidth={1.6} />
                </Button>
            </div>
        </>
    );
}
function BadgeExample() {
    const styles = BadgeStyles;
    return (
        <div className={cn(styles.wrap)}>
            <div className={cn(styles.row)}>
                <span className={cn("wb-label", styles.cap)}>Claim class</span>
                <Badge tone="fact">
                    <svg
                        width="8"
                        height="8"
                        viewBox="0 0 10 10"
                        style={{ width: 8, height: 8 }}
                        aria-hidden="true">
                        <rect
                            width="10"
                            height="10"
                            rx="2"
                            fill="currentColor"></rect>
                    </svg>
                    Fact
                </Badge>
                <Badge tone="inference">
                    <svg
                        width="9"
                        height="9"
                        viewBox="0 0 10 10"
                        style={{ width: 9, height: 9 }}
                        aria-hidden="true">
                        <path d="M5 0L10 10H0Z" fill="currentColor"></path>
                    </svg>
                    Inference
                </Badge>
                <Badge tone="hypothesis">
                    <svg
                        width="9"
                        height="9"
                        viewBox="0 0 10 10"
                        style={{ width: 9, height: 9 }}
                        aria-hidden="true">
                        <circle
                            cx="5"
                            cy="5"
                            r="4"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"></circle>
                    </svg>
                    Hypothesis
                </Badge>
                <Badge tone="unknown">
                    <svg
                        width="9"
                        height="9"
                        viewBox="0 0 10 10"
                        style={{ width: 9, height: 9 }}
                        aria-hidden="true">
                        <circle
                            cx="5"
                            cy="5"
                            r="4"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="1.5"
                            strokeDasharray="2 2"></circle>
                    </svg>
                    Unknown
                </Badge>
                <Badge tone="counter">
                    <svg
                        width="9"
                        height="9"
                        viewBox="0 0 10 10"
                        style={{ width: 9, height: 9 }}
                        aria-hidden="true">
                        <rect
                            y="3.5"
                            width="10"
                            height="3"
                            rx="1"
                            fill="currentColor"></rect>
                    </svg>
                    Counter-evidence
                </Badge>
            </div>
            <div className={cn(styles.row)}>
                <span className={cn("wb-label", styles.cap)}>Judgment</span>
                <Badge tone="review">
                    <svg
                        width="8"
                        height="8"
                        viewBox="0 0 10 10"
                        style={{ width: 8, height: 8 }}
                        aria-hidden="true">
                        <circle
                            cx="5"
                            cy="5"
                            r="5"
                            fill="var(--review)"></circle>
                    </svg>
                    Proposed · for review
                </Badge>
                <Badge tone="approved">
                    <WorkbenchIcon name="check" size={12} strokeWidth={2.4} />
                    Retained · v1
                </Badge>
                <Badge tone="ink">
                    <WorkbenchIcon name="edit" size={12} strokeWidth={2} />
                    Correction requested
                </Badge>
                <Badge tone="dashed">
                    <WorkbenchIcon name="defer" size={12} strokeWidth={2} />
                    Left for follow-up
                </Badge>
                <Badge
                    tone="review"
                    style={{
                        outline: "1px dashed var(--review-foreground)",
                        outlineOffset: "-1px",
                    }}>
                    v2 · pending judgment
                </Badge>
            </div>
            <div className={cn(styles.row)}>
                <span className={cn("wb-label", styles.cap)}>Status</span>
                <Badge tone="ink">
                    <WorkbenchIcon name="check" size={11} strokeWidth={2.4} />
                    Prepared
                </Badge>
                <Badge tone="inference">
                    <span
                        className="wb-live"
                        style={{
                            width: "7px",
                            height: "7px",
                            borderRadius: "50%",
                            background: "var(--brand-purple)",
                            display: "inline-block",
                        }}></span>
                    Running
                </Badge>
                <Badge tone="accent">
                    <svg
                        width="5"
                        height="5"
                        viewBox="0 0 10 10"
                        style={{ width: 5, height: 5 }}
                        aria-hidden="true">
                        <circle
                            cx="5"
                            cy="5"
                            r="5"
                            fill="var(--brand-purple)"></circle>
                    </svg>
                    3 new
                </Badge>
                <Badge tone="review">2 gaps disclosed</Badge>
            </div>
            <div className={cn(styles.row)}>
                <span className={cn("wb-label", styles.cap)}>Execution</span>
                <Badge tone="dashed">
                    <WorkbenchIcon
                        name="unfinished-check"
                        size={12}
                        strokeWidth={2}
                    />
                    Unfinished check
                </Badge>
                <Badge tone="dashed">
                    <WorkbenchIcon name="lock" size={11} strokeWidth={2} />
                    Locked
                </Badge>
            </div>
        </div>
    );
}
function WorkspaceNavigationExample() {
    const [active, setActive] = useState("Investigation");
    const [sub, setSub] = useState("Review");
    return (
        <div
            style={{
                display: "flex",
                gap: 16,
                justifyContent: "space-between",
                alignItems: "center",
                flexWrap: "wrap",
            }}>
            <nav className="segment-track" aria-label="Workspace">
                {["Research", "Sources", "Investigation", "Synthesis"].map(
                    (label) => (
                        <button
                            key={label}
                            type="button"
                            className="segment-item"
                            aria-current={active === label ? "page" : undefined}
                            aria-disabled={label === "Synthesis"}
                            onClick={() => {
                                if (label !== "Synthesis") setActive(label);
                            }}>
                            {active === label && (
                                <span className="wb-slash">{"//"}</span>
                            )}
                            {label}
                        </button>
                    ),
                )}
            </nav>
            <nav className="segment-track" aria-label="Investigation">
                {["Questions", "Hypotheses", "Requests", "Review"].map(
                    (label) => (
                        <button
                            key={label}
                            type="button"
                            className="segment-item"
                            aria-current={sub === label ? "page" : undefined}
                            onClick={() => setSub(label)}>
                            {label}
                            {label === "Review" && (
                                <Badge
                                    tone="review"
                                    style={{ padding: "0 6px" }}>
                                    1
                                </Badge>
                            )}
                        </button>
                    ),
                )}
            </nav>
        </div>
    );
}
export const examples = {
    DossierSwitcher: DossierSwitcherExample,
    Composer: ComposerExample,
    AgentActivity: AgentActivityExample,
    ActivityReader: AgentActivityHistoryExample,
    OverlayLayers: OverlayLayersExample,
    Chip: ChipExample,
    GlassPanel: GlassPanelExample,
    Cover: CoverExample,
    FramingControls: FramingControlsExample,
    SourcingLane: SourcingLaneExample,
    Handoff: HandoffExample,
    ProgressTimeline: ProgressTimelineExample,
    WorkCard: WorkCardExample,
    InventoryDock: InventoryDockExample,
    InventorySheet: InventorySheetExample,
    EvidenceMatrix: EvidenceMatrixExample,
    SourceReader: SourceReaderExample,
    QuestionCard: QuestionCardExample,
    HypothesisNode: HypothesisNodeExample,
    RequestItem: RequestItemExample,
    AppraisalBlock: AppraisalBlockExample,
    ControlConclusion: ControlConclusionExample,
    OutcomeCard: OutcomeCardExample,
    MechanismNode: MechanismNodeExample,
    BriefReference: BriefReferenceExample,
    Button: ButtonExample,
    Badge: BadgeExample,
    WorkspaceNavigation: WorkspaceNavigationExample,
};
