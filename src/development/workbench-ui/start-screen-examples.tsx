import {
    ArrowRight01Icon,
    ArrowUp01Icon,
    Plus,
} from "@hugeicons/core-free-icons";
import { type Ref, useState } from "react";
import { CompanyFaviconAvatar } from "@/components/company-favicon-avatar";
import Icon from "@/components/icon";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SmoothDropdwon } from "@/components/ui/smooth-dropdown";
import { WorkbenchShellSurface } from "@/components/workbench-shell/workbench-shell-surface";
import { WorkbenchIcon } from "@/components/workbench-ui/glyphs";
import { Handoff } from "@/components/workbench-ui/handoff";
import { WorkbenchUiRoot } from "@/components/workbench-ui/root";
import { SourcingLane } from "@/components/workbench-ui/sourcing-lane";
import { AddSourceDialog } from "@/components/workspace/add-source-dialog";
import {
    MoreOptionsButton,
    ToolbarIconButton,
} from "@/components/workspace/composer-toolbar-actions";
import {
    CompanyCandidateLabel,
    CompanyContextBadge,
    CompanyLookup,
    CompanyPickerTrigger,
    ResearchComposerToolbar,
    ResearchComposerView,
} from "@/components/workspace/start/research-composer-view";
import {
    CompanyMandatePanel,
    FramingProposal,
    StartAngleSuggestions,
    StartEntryScreen,
    StartFramingScreen,
    StartFramingSummary,
    StartRequestMessage,
    StartResearchScreen,
    StartShowcaseCard,
    StartSourceCounts,
    StartSourceStages,
    StartSourcesHeader,
} from "@/components/workspace/start/start-screens";
import { useQuickTextFill } from "@/hooks/use-quick-text-fill";
import { useResponsive } from "@/hooks/use-responsive";
import "./start-screen-preview.css";

export const startScreenNames = [
    "composer",
    "confirm",
    "framing",
    "launched",
    "handoff",
] as const;
export type StartScreenName = (typeof startScreenNames)[number];
const request =
    "Does CCC control the photo-led claim workflow, or supply modules an agent could replace?";
const company = {
    legalName: "CCC Intelligent Solutions Holdings Inc.",
    ticker: "CCCS",
    exchange: "Nasdaq",
    cik: "1818201",
    websiteUrl: "https://www.cccis.com",
};
const angles = [
    "Who controls the workflow once agents handle the intake?",
    "Which integrations would an agent have to replace?",
    "Where could value move if agents coordinate the work?",
];
const activities = [
    { id: "claims", label: "Photo-led auto physical damage claims" },
    { id: "network", label: "Repair network management" },
    { id: "other", label: "Other…" },
];
const initialQuestions = [
    "Does CCC control coordination, or supply replaceable modules?",
    "Is its operational context durable beyond contracts?",
    "Could core claims platforms replace it for insurers?",
    "Could agent-led claim intake bypass it?",
].map((text, i) => ({ id: `q${i + 1}`, label: `Q${i + 1}`, text }));
function report(detail: string) {
    window.dispatchEvent(
        new CustomEvent("workbench-example-action", {
            detail: `Illustrative callback: ${detail}`,
        }),
    );
}
function ReferenceChip() {
    return (
        <span className="start-preview-reference">
            <WorkbenchIcon name="back" size={12} />
            Investor day 2025 deck
        </span>
    );
}
function EntryExample({ confirmed }: { confirmed: boolean }) {
    const [value, setValue] = useState(confirmed ? request : "");
    const { inputRef: composerRef, fill: fillComposer } =
        useQuickTextFill<HTMLTextAreaElement>(setValue);
    const [query, setQuery] = useState("");
    const [open, setOpen] = useState(false);
    const [selected, setSelected] = useState(confirmed);
    const [searchTerm, setSearchTerm] = useState("");
    const [hasSearched, setHasSearched] = useState(false);
    const [referencesOpen, setReferencesOpen] = useState(false);
    const [references, setReferences] = useState<string[]>([]);
    const { isMobile } = useResponsive();
    const companyLabel = `${company.legalName} ${company.ticker} ${company.exchange} CIK ${company.cik}`;
    const matches =
        !hasSearched ||
        companyLabel.toLowerCase().includes(searchTerm.toLowerCase());
    return (
        <>
            <StartEntryScreen
                composer={
                    <>
                        <ResearchComposerView
                            value={value}
                            onValueChange={setValue}
                            textareaRef={composerRef}
                            placeholder="Describe the resilience question to focus on for research. Or choose a company to start."
                            companyAdornment={
                                selected ? (
                                    <CompanyContextBadge
                                        company={company}
                                        onRemove={() => setSelected(false)}
                                    />
                                ) : undefined
                            }
                            toolbar={
                                <ResearchComposerToolbar
                                    tools={
                                        <>
                                            <SmoothDropdwon
                                                open={open}
                                                onOpenChange={setOpen}
                                                openWidth={isMobile ? 300 : 400}
                                                closedWidth={215}
                                                closedHeight={36}
                                                className={`min-w-0 max-w-[calc(100cqw-10.25rem)] [&:not([data-open])>div]:max-w-full ${open ? "z-10" : ""}`}
                                                itemsAriaLabel="Company search results"
                                                trigger={
                                                    <CompanyPickerTrigger
                                                        label={
                                                            selected
                                                                ? company.legalName
                                                                : "Company to investigate"
                                                        }
                                                        ticker={
                                                            selected
                                                                ? company.ticker
                                                                : undefined
                                                        }
                                                        highlighted={open}
                                                    />
                                                }
                                                header={
                                                    <CompanyLookup
                                                        companyQuery={query}
                                                        onCompanyQueryChange={(
                                                            next,
                                                        ) => {
                                                            setQuery(next);
                                                            setHasSearched(
                                                                false,
                                                            );
                                                        }}
                                                        isSearching={false}
                                                        lookupError={null}
                                                        hasResolution={selected}
                                                        hasSearched={
                                                            hasSearched
                                                        }
                                                        resultCount={
                                                            matches ? 1 : 0
                                                        }
                                                        onClear={() => {
                                                            setSelected(false);
                                                            setQuery("");
                                                            setHasSearched(
                                                                false,
                                                            );
                                                        }}
                                                        onSearch={() => {
                                                            setSearchTerm(
                                                                query.trim(),
                                                            );
                                                            setHasSearched(
                                                                true,
                                                            );
                                                        }}
                                                        sessionReady
                                                    />
                                                }
                                                items={
                                                    matches
                                                        ? [
                                                              {
                                                                  id: company.cik,
                                                                  label: companyLabel,
                                                                  onSelect:
                                                                      () => {
                                                                          setSelected(
                                                                              true,
                                                                          );
                                                                          setOpen(
                                                                              false,
                                                                          );
                                                                      },
                                                                  renderLabel:
                                                                      () => (
                                                                          <CompanyCandidateLabel
                                                                              company={
                                                                                  company
                                                                              }
                                                                              selecting={
                                                                                  false
                                                                              }
                                                                          />
                                                                      ),
                                                              },
                                                          ]
                                                        : []
                                                }
                                            />
                                            <ToolbarIconButton
                                                label="Add a public reference"
                                                icon={Plus}
                                                count={references.length}
                                                onClick={() =>
                                                    setReferencesOpen(true)
                                                }
                                            />
                                            <MoreOptionsButton />
                                        </>
                                    }
                                    action={
                                        <Button
                                            type="button"
                                            variant="round"
                                            className="size-10"
                                            aria-label={
                                                selected
                                                    ? "Continue"
                                                    : "Send request"
                                            }
                                            onClick={() =>
                                                selected
                                                    ? report("Continue")
                                                    : setOpen(true)
                                            }>
                                            <Icon
                                                iconNode={ArrowRight01Icon}
                                                size={18}
                                            />
                                        </Button>
                                    }
                                />
                            }
                        />
                        {confirmed && selected && (
                            <CompanyMandatePanel
                                company={{
                                    name: company.legalName,
                                    ticker: company.ticker,
                                    exchange: company.exchange,
                                    cik: "[from EDGAR]",
                                    website: "cccis.com",
                                    avatar: (
                                        <CompanyFaviconAvatar
                                            company={company}
                                            size="lg"
                                        />
                                    ),
                                }}
                                mandate={
                                    <>
                                        <p>
                                            Primary sources first: SEC filings
                                            and company material, then public
                                            third-party sources.
                                        </p>
                                        <p>
                                            Counter-evidence is always sought.
                                            Every claim stays traceable to a
                                            passage.
                                        </p>
                                        <p className="text-muted-foreground">
                                            Bounded effort. You are asked only
                                            for important exceptions.
                                        </p>
                                    </>
                                }
                                onConfirm={() =>
                                    report("Confirm and propose framing")
                                }
                                onChangeCompany={() => setOpen(true)}
                            />
                        )}
                    </>
                }
                suggestions={
                    !confirmed ? (
                        <StartAngleSuggestions
                            angles={angles.map((label) => ({
                                id: label,
                                label,
                            }))}
                            onSelect={fillComposer}
                        />
                    ) : undefined
                }
                showcase={
                    !confirmed ? (
                        <StartShowcaseCard
                            avatar={
                                <CompanyFaviconAvatar
                                    company={company}
                                    size="lg"
                                />
                            }
                            title="Who holds the photo-led claim workflow?"
                            description="CCC Intelligent Solutions · a prepared dossier, from sources to the mechanism"
                            metrics={[
                                { value: 4, label: "questions" },
                                { value: 38, label: "sources" },
                                { value: 126, label: "assertions" },
                                { value: 1, label: "mechanism" },
                            ]}
                            onOpen={() => report("Open showcase")}
                        />
                    ) : (
                        <p className="start-preview-identity-note">
                            Website details help recognition only. The legal
                            identity comes from the SEC registration.
                        </p>
                    )
                }
            />
            <AddSourceDialog
                open={referencesOpen}
                onOpenChange={setReferencesOpen}
                urls={references}
                onUrlsChange={setReferences}
            />
        </>
    );
}
function Refinement({
    label = "Refine the framing in your own words",
    compact = false,
    value,
    onValueChange,
    inputRef,
}: {
    label?: string;
    compact?: boolean;
    value?: string;
    onValueChange?: (value: string) => void;
    inputRef?: Ref<HTMLInputElement>;
}) {
    return (
        <div
            className={
                compact
                    ? "start-preview-refinement compact"
                    : "start-preview-refinement"
            }>
            <input
                ref={inputRef}
                aria-label={label}
                placeholder={label}
                value={value}
                onChange={
                    onValueChange
                        ? (event) => onValueChange(event.target.value)
                        : undefined
                }
            />
            <Button
                variant="round"
                className="size-10"
                aria-label="Send refinement"
                onClick={() => report(label)}>
                <Icon iconNode={ArrowUp01Icon} size={18} />
            </Button>
        </div>
    );
}
function FramingExample() {
    const [activity, setActivity] = useState("claims");
    const [otherActivity, setOtherActivity] = useState("");
    const [questions, setQuestions] = useState(initialQuestions);
    const [refinement, setRefinement] = useState("");
    const { inputRef: refinementRef, fill: fillRefinement } =
        useQuickTextFill<HTMLInputElement>(setRefinement);
    const [focusQuestionId, setFocusQuestionId] = useState<string>();
    return (
        <StartFramingScreen
            request={
                <StartRequestMessage
                    context={
                        <>
                            <Badge tone="ink">
                                <CompanyFaviconAvatar
                                    company={company}
                                    size="xs"
                                />
                                CCC Intelligent Solutions · CCCS
                            </Badge>
                            <ReferenceChip />
                        </>
                    }>
                    {request}
                </StartRequestMessage>
            }
            proposal={
                <FramingProposal
                    introduction="I suggest focusing on one workflow and four questions. Change anything you like, or start as it is."
                    activities={activities}
                    activity={activity}
                    onActivityChange={setActivity}
                    activityDetail={
                        activity === "other" ? (
                            <div className="space-y-2">
                                <Label htmlFor="start-preview-other-activity">
                                    Other activity
                                </Label>
                                <Input
                                    id="start-preview-other-activity"
                                    value={otherActivity}
                                    onChange={(event) =>
                                        setOtherActivity(event.target.value)
                                    }
                                />
                            </div>
                        ) : undefined
                    }
                    questions={questions}
                    onQuestionChange={(id, text) =>
                        setQuestions((list) =>
                            list.map((q) => (q.id === id ? { ...q, text } : q)),
                        )
                    }
                    focusQuestionId={focusQuestionId}
                    onAddQuestion={() => {
                        const number = questions.length + 1;
                        const id = `q${number}`;
                        setQuestions([
                            ...questions,
                            { id, label: `Q${number}`, text: "" },
                        ]);
                        setFocusQuestionId(id);
                    }}
                    onStart={() => report("Start research")}
                    optionalQuestion={
                        <div className="start-preview-optional">
                            <p>
                                Optional: which reading should I test hardest?
                            </p>
                            <div>
                                {[
                                    "Control of coordination",
                                    "Substitution by agents",
                                    "No preference",
                                ].map((label) => (
                                    <Button
                                        variant="outline"
                                        key={label}
                                        aria-pressed={refinement === label}
                                        onClick={() => fillRefinement(label)}>
                                        {label}
                                    </Button>
                                ))}
                            </div>
                        </div>
                    }
                />
            }
            refinement={
                <Refinement
                    value={refinement}
                    onValueChange={setRefinement}
                    inputRef={refinementRef}
                />
            }
        />
    );
}
const found = [
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
    {
        id: "web",
        format: "WEB",
        title: "Insurer integrations index",
        meta: "company site",
    },
    {
        id: "call1",
        format: "CALL",
        title: "Q1 2025 earnings call",
        meta: "investor relations",
    },
];
const capturing = [
    {
        id: "call2",
        format: "CALL",
        title: "Q2 2025 earnings call",
        meta: "transcript · 62%",
    },
    {
        id: "10q1",
        format: "10-Q",
        title: "Form 10-Q · Q1 2025",
        meta: "sec.gov · 30%",
    },
] as const;
const captured = [
    {
        id: "10k",
        format: "10-K",
        title: "Form 10-K · FY2025",
        meta: "sec.gov · 142 pages",
    },
    {
        id: "10q2",
        format: "10-Q",
        title: "Form 10-Q · Q2 2025",
        meta: "sec.gov",
    },
    {
        id: "deck",
        format: "DECK",
        title: "Investor day 2025 deck",
        meta: "your reference",
    },
    {
        id: "pr",
        format: "PR",
        title: "Q2 2025 results release",
        meta: "investor relations",
    },
] as const;
function ResearchExample({
    done,
    onViewFraming,
    onOpenProgress,
}: {
    done: boolean;
    onViewFraming: () => void;
    onOpenProgress: () => void;
}) {
    const [handoffVisible, setHandoffVisible] = useState(true);
    return (
        <StartResearchScreen
            conversation={
                <>
                    <span className="wb-label">Conversation</span>
                    <StartRequestMessage>{request}</StartRequestMessage>
                    <StartFramingSummary
                        scope={done ? undefined : "Photo-led claims"}
                        questionCount={done ? undefined : 4}
                        onInspect={done ? undefined : onViewFraming}
                    />
                    <p className="start-preview-reply">
                        <span>{"// "}</span>
                        {done
                            ? "The material is ready. Investigation is starting on the four questions."
                            : "Research started. I'll bring you to Progress when the material is ready."}
                    </p>
                </>
            }
            conversationComposer={
                !done ? (
                    <Refinement label="Ask about the sources" compact />
                ) : undefined
            }
            heading={
                <StartSourcesHeader
                    running={!done}
                    label={done ? "// Sources · done" : "// Sources · live"}
                    title={
                        done
                            ? "Documentary material ready"
                            : "Collecting the documentary material"
                    }
                    onOpenProgress={
                        !done || !handoffVisible ? onOpenProgress : undefined
                    }
                    detail={
                        done
                            ? "Ready when you are"
                            : "Opens on its own when Sources finishes"
                    }
                />
            }
            summary={
                <StartSourceCounts
                    counts={
                        done
                            ? [
                                  { value: 47, label: "found" },
                                  { value: 38, label: "captured" },
                                  { value: 29, label: "selected" },
                              ]
                            : [
                                  { value: 14, label: "found" },
                                  {
                                      value: 2,
                                      label: "capturing",
                                      highlight: true,
                                  },
                                  { value: 6, label: "captured" },
                              ]
                    }
                />
            }
            stages={
                <StartSourceStages
                    running={!done}
                    completedPercent={done ? 100 : 32}
                    activePercent={done ? 0 : 10}
                />
            }
            lanes={
                <>
                    <SourcingLane
                        state="found"
                        label="Found"
                        count={done ? 0 : 6}
                        documents={done ? [] : found}
                        remainingLabel={done ? undefined : "+2 more"}
                    />
                    <SourcingLane
                        state="capturing"
                        active={!done}
                        label="Capturing"
                        count={done ? 0 : 2}
                        documents={done ? [] : capturing}
                    />
                    <SourcingLane
                        state="captured"
                        label="Captured"
                        count={done ? 38 : 6}
                        documents={
                            done
                                ? [captured[0], capturing[0], captured[2]].map(
                                      (doc) => ({ ...doc, meta: "" }),
                                  )
                                : captured
                        }
                        remainingLabel={done ? "+35 more" : "+2 more"}
                    />
                </>
            }
            limitations={
                !done ? (
                    <div className="start-preview-limitations">
                        <span className="wb-label">Not available</span>
                        <span>
                            <WorkbenchIcon name="unestablished" size={12} />
                            Analyst coverage · searched, none found
                        </span>
                        <span>
                            <WorkbenchIcon name="clock" size={12} />
                            Patent register · search unavailable
                        </span>
                        <span>Kept as stated limits, never as irrelevance</span>
                    </div>
                ) : undefined
            }
            handoff={
                done && handoffVisible ? (
                    <Handoff
                        summary="38 captured · 29 selected · 9 kept as context"
                        gaps="2 gaps disclosed"
                        onContinue={onOpenProgress}
                        onStay={() => setHandoffVisible(false)}
                    />
                ) : undefined
            }
        />
    );
}
export function StartScreenPreview({
    name,
    theme,
    onNavigate,
    onOpenProgress,
}: {
    name: StartScreenName;
    theme: "light" | "dark";
    onNavigate: (screen: StartScreenName) => void;
    onOpenProgress: () => void;
}) {
    return (
        <WorkbenchUiRoot
            theme={theme}
            className="start-screen-preview"
            style={{ lineHeight: 1.5 }}
            data-start-screen={name}>
            <WorkbenchShellSurface>
                {name === "framing" ? (
                    <FramingExample />
                ) : name === "launched" || name === "handoff" ? (
                    <ResearchExample
                        done={name === "handoff"}
                        onViewFraming={() => onNavigate("framing")}
                        onOpenProgress={onOpenProgress}
                    />
                ) : (
                    <EntryExample confirmed={name === "confirm"} />
                )}
            </WorkbenchShellSurface>
        </WorkbenchUiRoot>
    );
}
