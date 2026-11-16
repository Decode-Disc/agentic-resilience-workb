import { ArrowRight01Icon, Attachment01Icon } from "@hugeicons/core-free-icons";
import type { ComponentProps } from "react";
import {
    type ReactNode,
    useEffect,
    useLayoutEffect,
    useRef,
    useState,
} from "react";
import { createPortal } from "react-dom";
import type { ConversationAgents } from "@/components/chat/conversation-agent";
import { ConversationHistory } from "@/components/chat/conversation-history";
import type { ConversationMissionSnapshot } from "@/components/chat/conversation-mission";
import { CompanyFaviconAvatar } from "@/components/company-favicon-avatar";
import { ComposerToolbar } from "@/components/composer/composer";
import { ComposerToolsMenu } from "@/components/composer/tools-menu";
import Icon from "@/components/icon";
import {
    Popover,
    PopoverContent,
    PopoverTitle,
    PopoverTrigger,
} from "@/components/ui/popover";
import { usePreviewModelSelector } from "./preview-model-selector";
import "./preview-controls.css";
import {
    ConversationComposer,
    ConversationContext,
    ConversationReference,
    type ConversationWorkItem,
} from "@/components/chat/workbench-conversation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
    Collapsible,
    CollapsibleContent,
    CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { SmoothDropdwon } from "@/components/ui/smooth-dropdown";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { WorkbenchShellSurface } from "@/components/workbench-shell/workbench-shell-surface";
import { WorkbenchIcon } from "@/components/workbench-ui/glyphs";
import { OutcomeCard } from "@/components/workbench-ui/outcome-card";
import { WorkbenchUiRoot } from "@/components/workbench-ui/root";
import { SourcingLane } from "@/components/workbench-ui/sourcing-lane";
import { AddSourceDialog } from "@/components/workspace/add-source-dialog";
import {
    type CoveragePreset,
    CoveragePresetPicker,
} from "@/components/workspace/coverage-preset-picker";
import {
    CompanyCandidateLabel,
    CompanyContextBadge,
    CompanyLookup,
    CompanyPickerTrigger,
    ResearchComposerView,
} from "@/components/workspace/start/research-composer-view";
import { StartDossierHeading } from "@/components/workspace/start/start-dossier-heading";
import {
    CompanyMandatePanel,
    FramingClarification,
    FramingProposal,
    type StartFramingQuestion,
    StartAngleSuggestions,
    StartEntryScreen,
    StartFramingScreen,
    StartResearchScreen,
    StartShowcaseCard,
    StartSourceCounts,
    StartSourceStages,
    StartSourcesHeader,
} from "@/components/workspace/start/start-screens";
import { useQuickTextFill } from "@/hooks/use-quick-text-fill";
import { useResponsive } from "@/hooks/use-responsive";
import {
    activityClarification,
    guidedExamples,
    preparationQuestionExample,
    report,
    type StartConversationPreview,
    sourcePreparation,
    useStartConversationPreview,
} from "./start-conversation-preview";
import "./start-screen-preview.css";

export const startScreenNames = [
    "composer",
    "confirm",
    "framing",
    "launched",
    "handoff",
] as const;
export type StartScreenName = (typeof startScreenNames)[number];
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
function PreviewControls({ children }: { children: ReactNode }) {
    const controls = (
        <section
            className="start-preview-scenarios"
            aria-label="Illustrative framing scenarios">
            {children}
        </section>
    );
    const [toolbar, setToolbar] = useState<HTMLElement | null>(null);
    useLayoutEffect(() => {
        setToolbar(document.getElementById("start-preview-controls"));
    }, []);
    return toolbar ? createPortal(controls, toolbar) : controls;
}
/** Keeps gallery diagnostics available without taking space from the conversation. */
function PreviewTools({ children }: { children: ReactNode }) {
    return (
        <Popover>
            <PopoverTrigger render={<Button variant="outline" size="sm" />}>
                Preview tools
            </PopoverTrigger>
            <PopoverContent align="end" className="preview-tools-panel">
                <PopoverTitle>Preview tools</PopoverTitle>
                {children}
            </PopoverContent>
        </Popover>
    );
}
function ReferenceChip() {
    return (
        <ConversationReference
            title="Investor day 2025 deck"
            description="Presentation · CCC Intelligent Solutions · 2025">
            <dl className="chat-reference-facts">
                <div>
                    <dt>Context</dt>
                    <dd>Provided with your request</dd>
                </div>
                <div>
                    <dt>Reading</dt>
                    <dd>Not retrieved</dd>
                </div>
            </dl>
            <p className="chat-reference-limit">
                This reference is a research input. Its contents are not
                available in this illustrative preview.
            </p>
        </ConversationReference>
    );
}
function PreviewResearchContext({
    activities,
    missions,
    agents,
    scope,
    questions,
    launched,
    hasReference,
    scopePending = false,
    onChangeScope,
    open,
    onOpenChange,
    onInspectFraming,
}: {
    activities: readonly ConversationWorkItem[];
    missions: readonly ConversationMissionSnapshot[];
    agents: ConversationAgents;
    scope: string;
    questions: readonly StartFramingQuestion[];
    launched: boolean;
    hasReference: boolean;
    scopePending?: boolean;
    onChangeScope?: () => void;
    open?: boolean;
    onOpenChange?: (open: boolean) => void;
    onInspectFraming?: () => void;
}) {
    const { isMobile } = useResponsive();
    return (
        <ConversationContext
            defaultOpen={!launched && !isMobile}
            open={open}
            onOpenChange={onOpenChange}
            title={`${company.ticker} · Research`}
            activities={activities}
            missions={missions}
            agents={agents}
            onChangeScope={onChangeScope}
            planSummary={scopePending ? "Scope being clarified" : scope}
            questionCount={questions.length}
            plan={
                <FramingProposal
                    title="Research program"
                    questions={questions}
                />
            }
            planAction={
                onInspectFraming && (
                    <Button
                        variant="ghost"
                        size="xs"
                        onClick={onInspectFraming}>
                        View framing
                    </Button>
                )
            }
            sourcesSummary={
                hasReference
                    ? "One supplied reference"
                    : "No references supplied"
            }
            sources={
                hasReference ? (
                    <ReferenceChip />
                ) : (
                    <p className="chat-context-empty">
                        No references supplied.
                    </p>
                )
            }
        />
    );
}
function EntryExample({
    modelControls,
}: {
    modelControls: ReturnType<typeof usePreviewModelSelector>;
}) {
    const [value, setValue] = useState("");
    const { inputRef: composerRef, fill: fillComposer } =
        useQuickTextFill<HTMLTextAreaElement>(setValue);
    const [query, setQuery] = useState("");
    const [open, setOpen] = useState(false);
    const [selected, setSelected] = useState(false);
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
                            <ComposerToolbar
                                context={
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
                                                    setHasSearched(false);
                                                }}
                                                isSearching={false}
                                                lookupError={null}
                                                hasResolution={selected}
                                                hasSearched={hasSearched}
                                                resultCount={matches ? 1 : 0}
                                                onClear={() => {
                                                    setSelected(false);
                                                    setQuery("");
                                                    setHasSearched(false);
                                                }}
                                                onSearch={() => {
                                                    setSearchTerm(query.trim());
                                                    setHasSearched(true);
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
                                                          onSelect: () => {
                                                              setSelected(true);
                                                              setOpen(false);
                                                          },
                                                          renderLabel: () => (
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
                                }
                                tools={
                                    <>
                                        <ComposerToolsMenu
                                            count={references.length}
                                            items={[
                                                {
                                                    label: "Attach references",
                                                    icon: Attachment01Icon,
                                                    description:
                                                        "Add public HTTPS links as research inputs",
                                                    onSelect: () =>
                                                        setReferencesOpen(true),
                                                },
                                            ]}
                                        />
                                        {modelControls.modelSelector}
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
                }
                suggestions={
                    <StartAngleSuggestions
                        angles={angles.map((label) => ({
                            id: label,
                            label,
                        }))}
                        onSelect={fillComposer}
                    />
                }
                showcase={
                    <StartShowcaseCard
                        avatar={
                            <CompanyFaviconAvatar company={company} size="lg" />
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
function FramingExample({
    trialControls,
    controller,
    composerControls,
    history,
    onLaunch,
}: {
    controller: StartConversationPreview;
    history: ReactNode;
    onLaunch: () => void;
    composerControls: Pick<
        ComponentProps<typeof ConversationComposer>,
        | "modelSelector"
        | "controlsOpen"
        | "onOpenModels"
        | "onCommand"
        | "availableCommands"
    >;
    trialControls: ReactNode;
}) {
    const {
        state,
        update,
        conversation,
        setExample,
        setFailNext,
        setQuestionAction,
        setRefinement,
        selectScenario,
        requestScopeChange,
        scopeAnswer,
        contextChoice,
        proposedScopeValue,
    } = controller;
    const { isMobile } = useResponsive();
    const questionAction = state.questionAction ?? null;
    const selectedQuestionId = state.selectedQuestionId;
    const { scenario, needsContext, scope, questions, suppliedContext } = state;
    const actionTrigger = useRef<HTMLElement | null>(null);
    const previousAction = useRef(false);
    useEffect(() => {
        if (previousAction.current && !questionAction)
            actionTrigger.current?.focus();
        previousAction.current = !!questionAction;
    }, [questionAction]);
    const { inputRef: refinementRef, fill } =
        useQuickTextFill<HTMLTextAreaElement>(setRefinement);
    const actionOpen = questionAction !== null;
    useEffect(() => {
        if (actionOpen) refinementRef.current?.focus();
    }, [actionOpen, refinementRef]);
    function submitScope() {
        if (scopeAnswer) void conversation.submit(scopeAnswer);
    }
    const composer = (
        <ConversationComposer
            {...composerControls}
            inputRef={refinementRef}
            onResumeQueue={controller.resumeQueue}
            placeholder={
                questionAction && !questionAction.id
                    ? "What would you like to investigate?"
                    : !state.launched && isMobile && !questionAction
                      ? needsContext
                          ? "Describe another scope…"
                          : "Refine the framing…"
                      : undefined
            }
            label={
                state.launched
                    ? "Ask about the sources"
                    : needsContext
                      ? "Or describe a different scope…"
                      : questionAction
                        ? questionAction.id
                            ? "Edit research question"
                            : "Add research question"
                        : "Refine the framing in your own words"
            }
            actionLabel={
                needsContext
                    ? "Continue"
                    : questionAction
                      ? questionAction.id
                          ? "Save changes"
                          : "Add question"
                      : undefined
            }
            onCancel={
                questionAction ? () => setQuestionAction(null) : undefined
            }
            pending={conversation.sending}
            failed={conversation.failed}
            submission={
                needsContext
                    ? { disabled: !scopeAnswer, onSubmit: submitScope }
                    : undefined
            }
        />
    );

    return (
        <>
            <PreviewControls>
                <ToggleGroup
                    className="preview-control-group"
                    aria-label="Request scenario"
                    value={[scenario]}
                    onValueChange={(values) => {
                        const next = values[0];
                        if (next === "specific" || next === "company")
                            selectScenario(next);
                    }}>
                    <ToggleGroupItem value="specific">
                        Specific request
                    </ToggleGroupItem>
                    <ToggleGroupItem value="company">
                        Company only
                    </ToggleGroupItem>
                </ToggleGroup>
                <PreviewTools>
                    <div className="preview-tool-actions">
                        <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => selectScenario("specific")}>
                            Reset preview
                        </Button>
                        <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setFailNext(true)}>
                            Fail next send
                        </Button>
                        {trialControls}
                    </div>
                    {!state.launched && (
                        <section
                            aria-label="Example refinements"
                            className="start-guided-examples">
                            <p>Example refinements</p>
                            {guidedExamples.map((item) => (
                                <Button
                                    key={item.id}
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => {
                                        setExample(item.id);
                                        fill(item.text);
                                    }}>
                                    {item.label}
                                </Button>
                            ))}
                        </section>
                    )}
                </PreviewTools>
            </PreviewControls>
            <StartFramingScreen
                context={
                    <PreviewResearchContext
                        missions={state.missions}
                        agents={state.agents}
                        activities={
                            state.turns?.flatMap((turn) =>
                                turn.entries.flatMap((entry) =>
                                    entry.kind === "operation"
                                        ? [entry.operation]
                                        : [],
                                ),
                            ) ?? []
                        }
                        scope={scope}
                        scopePending={needsContext}
                        onChangeScope={
                            !state.launched && !needsContext && !questionAction
                                ? requestScopeChange
                                : undefined
                        }
                        questions={questions}
                        launched={state.launched}
                        hasReference={scenario === "specific"}
                    />
                }
                runtime={conversation.runtime}
                conversation={history}
                suggestions={
                    !state.launched &&
                    !needsContext && (
                        <section
                            data-slot="framing-suggestions"
                            aria-label="Optional reading preference">
                            <p>
                                Optional: which reading should I test hardest?
                            </p>
                            <div>
                                {[
                                    {
                                        label: "Control of coordination",
                                        text: "Test control of coordination most closely.",
                                    },
                                    {
                                        label: "Substitution by agents",
                                        text: "Test substitution by agents most closely.",
                                    },
                                    {
                                        label: "No preference",
                                        text: "Use the proposed framing without a preferred reading.",
                                    },
                                ].map((item) => (
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        key={item.label}
                                        onClick={() => {
                                            setExample(null);
                                            fill(item.text);
                                        }}>
                                        {item.label}
                                    </Button>
                                ))}
                            </div>
                        </section>
                    )
                }
                identity={
                    <Badge tone="ink">
                        <CompanyFaviconAvatar company={company} size="xs" />
                        CCC Intelligent Solutions · CCCS
                    </Badge>
                }
                action={
                    state.launched ? (
                        <FramingProposal
                            collapsible
                            title="Accepted research program"
                            composer={composer}
                            questions={questions}
                            selectedQuestionId={selectedQuestionId}
                        />
                    ) : (
                        <FramingProposal
                            collapsible
                            composer={composer}
                            clarification={
                                needsContext ? (
                                    <FramingClarification
                                        selection={{
                                            value: state.contextDraft?.trim()
                                                ? ""
                                                : contextChoice,
                                            onChange: (value) =>
                                                update({
                                                    contextChoice: value,
                                                    contextDraft: "",
                                                }),
                                        }}
                                        pending={conversation.sending}
                                        question={{
                                            ...activityClarification,
                                            reason:
                                                scenario === "company" &&
                                                !suppliedContext
                                                    ? activityClarification.reason
                                                    : "Adjust the activity or boundary if the proposed scope does not match your intention.",
                                            proposedValue: proposedScopeValue,
                                        }}
                                        onAnswer={submitScope}
                                    />
                                ) : undefined
                            }
                            questions={questions}
                            actionActive={questionAction !== null}
                            selectedQuestionId={selectedQuestionId}
                            onEditRequest={(q) => {
                                actionTrigger.current =
                                    document.activeElement as HTMLElement;
                                setQuestionAction({ id: q.id, text: q.text });
                            }}
                            onAddRequest={() => {
                                actionTrigger.current =
                                    document.activeElement as HTMLElement;
                                setQuestionAction({ text: "" });
                            }}
                            onStart={state.launched ? undefined : onLaunch}
                        />
                    )
                }
                actionLabel={
                    state.launched ? "Research program" : "Pending action"
                }
            />
        </>
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
    trialControls,
    controller,
    composerControls,
    history,
    onOpenProgress,
    onInspectFraming,
}: {
    controller: StartConversationPreview;
    composerControls: ComponentProps<typeof FramingExample>["composerControls"];
    history: ReactNode;
    onOpenProgress: () => void;
    onInspectFraming: () => void;
    trialControls: ReactNode;
}) {
    const { state, conversation } = controller;
    const { inputRef, fill } = useQuickTextFill<HTMLTextAreaElement>(
        controller.setRefinement,
    );
    const [contextOpen, setContextOpen] = useState(false);
    const preparation = sourcePreparation(state);
    const done = preparation.state === "completed";
    const workState = preparation.state;
    const interrupted = workState === "interrupted";
    const step = preparation.step;
    const activities =
        state.turns?.flatMap((turn) =>
            turn.entries.flatMap((entry) =>
                entry.kind === "operation" ? [entry.operation] : [],
            ),
        ) ?? [];
    return (
        <StartResearchScreen
            context={
                <PreviewResearchContext
                    missions={state.missions}
                    agents={state.agents}
                    activities={activities}
                    scope={state.scope}
                    questions={state.questions}
                    launched
                    onInspectFraming={onInspectFraming}
                    open={contextOpen}
                    onOpenChange={setContextOpen}
                    hasReference={state.scenario === "specific"}
                />
            }
            runtime={conversation.runtime}
            conversation={
                <>
                    <PreviewControls>
                        <PreviewTools>
                            {trialControls}
                            <Button
                                variant="ghost"
                                size="sm"
                                disabled={!controller.canAskDuringPreparation}
                                onClick={() => {
                                    controller.setExample(
                                        preparationQuestionExample.id,
                                    );
                                    fill(preparationQuestionExample.text);
                                }}>
                                {preparationQuestionExample.label}
                            </Button>
                            {
                                <>
                                    <Button
                                        variant="ghost"
                                        size="sm"
                                        disabled={
                                            step > 0 || workState !== "running"
                                        }
                                        onClick={controller.advancePreparation}>
                                        Advance illustrative work
                                    </Button>
                                    <Button
                                        variant="ghost"
                                        size="sm"
                                        disabled={workState !== "running"}
                                        onClick={controller.finishPreparation}>
                                        Finish illustrative work
                                    </Button>
                                    <Button
                                        variant="ghost"
                                        size="sm"
                                        disabled={workState !== "running"}
                                        onClick={
                                            controller.interruptPreparation
                                        }>
                                        Interrupt illustrative work
                                    </Button>
                                    {done && (
                                        <Button
                                            variant="ghost"
                                            size="sm"
                                            onClick={
                                                controller.restartPreparation
                                            }>
                                            Restart illustrative work
                                        </Button>
                                    )}
                                </>
                            }
                        </PreviewTools>
                    </PreviewControls>
                    {history}
                </>
            }
            conversationComposer={
                <ConversationComposer
                    {...composerControls}
                    label="Ask about the sources"
                    inputRef={inputRef}
                    onResumeQueue={controller.resumeQueue}
                    compact
                    pending={conversation.sending}
                    failed={conversation.failed}
                />
            }
            heading={
                <StartSourcesHeader
                    running={workState === "running"}
                    label={
                        done
                            ? "Complete"
                            : interrupted
                              ? "Interrupted"
                              : "Working"
                    }
                    title={
                        done
                            ? "Documentary material ready"
                            : interrupted
                              ? "Documentary preparation stopped"
                              : "Collecting the documentary material"
                    }
                    onOpenProgress={onOpenProgress}
                    detail={
                        done
                            ? "Ready when you are"
                            : interrupted
                              ? "Recorded inputs remain available"
                              : "Ready when you are"
                    }
                />
            }
            notice={
                interrupted && (
                    <div
                        role="status"
                        aria-label="Source preparation interrupted">
                        <OutcomeCard
                            kind="interruption"
                            title="Illustrative work interrupted"
                            next={
                                <Button
                                    variant="secondary"
                                    size="sm"
                                    onClick={controller.restartPreparation}>
                                    Restart illustrative work
                                </Button>
                            }>
                            Listed documents and your conversation are
                            preserved. This simulation stops on page reload and
                            can be restarted here.
                        </OutcomeCard>
                    </div>
                )
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
                                      label: interrupted
                                          ? "waiting"
                                          : "capturing",
                                      highlight: !interrupted,
                                  },
                                  { value: 6, label: "captured" },
                              ]
                    }
                />
            }
            stages={
                <StartSourceStages
                    running={workState === "running"}
                    completedPercent={done ? 100 : 32}
                    activePercent={workState === "running" ? 10 : 0}
                />
            }
            lanes={
                <>
                    <SourcingLane
                        state="found"
                        label="Found"
                        count={done ? 0 : 6}
                        documents={done ? [] : found}
                        emptyMessage="No documents awaiting capture."
                        remainingLabel={done ? undefined : "+2 more"}
                    />
                    <SourcingLane
                        state="capturing"
                        active={workState === "running"}
                        label={interrupted ? "Waiting" : "Capturing"}
                        count={done ? 0 : 2}
                        documents={done ? [] : capturing}
                        emptyMessage="No captures in progress."
                    />
                    <SourcingLane
                        state="captured"
                        label="Captured"
                        count={done ? 38 : 6}
                        documents={
                            done
                                ? captured
                                      .slice(0, 3)
                                      .map((doc) => ({ ...doc, meta: "" }))
                                : captured
                        }
                        remainingLabel={done ? "+35 more" : "+2 more"}
                    />
                </>
            }
            limitations={
                <Collapsible
                    defaultOpen
                    className="start-preview-limitations"
                    role="region"
                    aria-label="Coverage gaps">
                    <h2>
                        <CollapsibleTrigger
                            render={<Button variant="ghost" />}
                            aria-label="Coverage gaps · 2"
                            className="start-preview-limitations-toggle">
                            <span className="start-preview-limitations-heading">
                                Coverage gaps
                                <span className="start-preview-limitations-count">
                                    2
                                </span>
                            </span>
                            <WorkbenchIcon name="chevron" size={14} />
                        </CollapsibleTrigger>
                    </h2>
                    <CollapsibleContent>
                        <ul>
                            <li>
                                <WorkbenchIcon name="unestablished" size={14} />
                                <div>
                                    <span>Analyst coverage</span>
                                    <p>
                                        No matching material found in this
                                        search.
                                    </p>
                                </div>
                            </li>
                            <li>
                                <WorkbenchIcon name="clock" size={14} />
                                <div>
                                    <span>Patent register</span>
                                    <p>Search could not be completed.</p>
                                </div>
                            </li>
                        </ul>
                    </CollapsibleContent>
                </Collapsible>
            }
        />
    );
}
function ConfirmationExample({
    onBack,
    onConfirm,
}: {
    onBack: () => void;
    onConfirm: () => void;
}) {
    const [coveragePreset, setCoveragePreset] =
        useState<CoveragePreset>("balanced");
    return (
        <CompanyMandatePanel
            company={company}
            coverage={
                <CoveragePresetPicker
                    value={coveragePreset}
                    onChange={setCoveragePreset}
                />
            }
            mandate={
                <>
                    <p>
                        Primary sources first: SEC filings and company material,
                        then public third-party sources.
                    </p>
                    <p>
                        Counter-evidence is always sought. Every claim stays
                        traceable to a passage.
                    </p>
                    <p className="text-muted-foreground">
                        Bounded effort. You are asked only for important
                        exceptions.
                    </p>
                </>
            }
            onChangeCompany={onBack}
            onConfirm={onConfirm}
        />
    );
}
export function StartScreenPreview({
    name,
    theme,
    onNavigate,
    onOpenProgress,
    onStatus,
}: {
    name: StartScreenName;
    theme: "light" | "dark";
    onNavigate: (screen: StartScreenName) => void;
    onOpenProgress: () => void;
    onStatus?: (message: string) => void;
}) {
    const controller = useStartConversationPreview(name, onStatus);
    const { state, reply, activeTurn } = controller;
    const modelControls = usePreviewModelSelector();
    const preparationState = sourcePreparation(state).state;
    const composerControls = {
        ...modelControls,
        availableCommands: [
            "/model",
            ...(preparationState === "running"
                ? ["/pause" as const]
                : preparationState === "interrupted"
                  ? ["/resume" as const]
                  : []),
        ] as const,
        onCommand: controller.controlPreparation,
    };
    const history = (
        <ConversationHistory
            entries={controller.historyEntries}
            agents={state.agents}
            missions={state.missions}
            turns={state.turns}
        />
    );
    const trialControls = (
        <section
            aria-label="Illustrative conversation controls"
            className="flex flex-wrap gap-1">
            <Button
                variant="ghost"
                size="sm"
                disabled={!!activeTurn || reply !== null}
                onClick={controller.workThenReply}>
                Work then reply
            </Button>
            {activeTurn && (
                <>
                    <Button
                        variant="ghost"
                        size="sm"
                        onClick={controller.advanceIllustrativeTurn}>
                        Advance illustrative turn
                    </Button>
                    <Button
                        variant="ghost"
                        size="sm"
                        onClick={controller.finishIllustrativeTurn}>
                        Finish illustrative turn
                    </Button>
                </>
            )}
            {(name === "framing" || name === "handoff") && (
                <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => onNavigate("launched")}>
                    Try activity grouping
                </Button>
            )}
            <Button
                variant="ghost"
                size="sm"
                disabled={reply !== null || !!activeTurn}
                onClick={controller.growReply}>
                Grow illustrative reply
            </Button>
            {reply && (
                <Button
                    variant="ghost"
                    size="sm"
                    onClick={controller.interruptReply}>
                    Interrupt illustrative reply
                </Button>
            )}
        </section>
    );
    return (
        <WorkbenchUiRoot
            theme={theme}
            className="start-screen-preview"
            style={{ lineHeight: 1.5 }}
            data-start-screen={name}>
            <WorkbenchShellSurface
                plain={
                    name === "framing" ||
                    name === "launched" ||
                    name === "handoff"
                }
                className={
                    name === "framing" ||
                    name === "launched" ||
                    name === "handoff"
                        ? "start-conversation-shell"
                        : undefined
                }
                contentClassName={
                    name === "framing" ||
                    name === "launched" ||
                    name === "handoff"
                        ? "start-conversation-surface"
                        : undefined
                }>
                {name === "framing" ||
                ((name === "launched" || name === "handoff") &&
                    !state.launched) ? (
                    <FramingExample
                        trialControls={trialControls}
                        controller={controller}
                        composerControls={composerControls}
                        history={history}
                        onLaunch={() => {
                            controller.startResearch();
                            onNavigate("launched");
                        }}
                    />
                ) : name === "launched" || name === "handoff" ? (
                    <ResearchExample
                        trialControls={trialControls}
                        controller={controller}
                        composerControls={composerControls}
                        history={history}
                        onInspectFraming={() => onNavigate("framing")}
                        onOpenProgress={onOpenProgress}
                    />
                ) : name === "confirm" ? (
                    <div className="start-confirmation-frame">
                        <StartDossierHeading />
                        <ConfirmationExample
                            onBack={() => onNavigate("composer")}
                            onConfirm={() => onNavigate("framing")}
                        />
                    </div>
                ) : (
                    <EntryExample modelControls={modelControls} />
                )}
            </WorkbenchShellSurface>
        </WorkbenchUiRoot>
    );
}
