import type { ThreadMessageLike } from "@assistant-ui/react";
import { ArrowRight01Icon, Plus } from "@hugeicons/core-free-icons";
import {
    type ReactNode,
    useEffect,
    useId,
    useLayoutEffect,
    useState,
} from "react";
import { createPortal } from "react-dom";
import { CompanyFaviconAvatar } from "@/components/company-favicon-avatar";
import Icon from "@/components/icon";
import {
    Popover,
    PopoverContent,
    PopoverTitle,
    PopoverTrigger,
} from "@/components/ui/popover";
import "./preview-controls.css";
import {
    ConversationActivityGroup,
    ConversationComposer,
    ConversationContext,
    ConversationMessages,
    ConversationReference,
    type ConversationWorkItem,
    useWorkbenchConversation,
} from "@/components/chat/workbench-conversation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { SmoothDropdwon } from "@/components/ui/smooth-dropdown";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
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
    type CoveragePreset,
    CoveragePresetPicker,
} from "@/components/workspace/coverage-preset-picker";
import {
    CompanyCandidateLabel,
    CompanyContextBadge,
    CompanyLookup,
    CompanyPickerTrigger,
    ResearchComposerToolbar,
    ResearchComposerView,
} from "@/components/workspace/start/research-composer-view";
import { StartDossierHeading } from "@/components/workspace/start/start-dossier-heading";
import {
    CompanyMandatePanel,
    FramingClarification,
    FramingProposal,
    StartAngleSuggestions,
    StartEntryScreen,
    type StartFramingQuestion,
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
const activityClarification = {
    id: "activity",
    prompt: "Which activity would you like to examine?",
    reason: "Your request names the company. The activity determines which relationships and dependencies this dossier should investigate.",
    proposedValue: "claims",
    choices: [
        { value: "claims", label: "Photo-led auto physical damage claims" },
        { value: "network", label: "Repair network management" },
    ],
};
const claimsScope =
    "Photo-led auto physical damage claims, focusing on coordination between insurers, repairers and CCC, and what an agent could replace.";
const networkScope =
    "Repair network management, focusing on the relationships between insurers, repairers and CCC, and the dependencies a substitute would need.";
const initialQuestions: StartFramingQuestion[] = [
    {
        id: "q1",
        label: "Q1",
        text: "Does CCC control coordination, or supply replaceable modules?",
        rationale: "Distinguish running the workflow from deciding its rules.",
    },
    {
        id: "q2",
        label: "Q2",
        text: "Is its operational context durable beyond contracts?",
        rationale:
            "Examine what remains useful and difficult to reproduce across renewals.",
    },
    {
        id: "q3",
        label: "Q3",
        text: "Could core claims platforms replace it for insurers?",
        rationale:
            "Compare substitution paths and the dependencies they would need.",
    },
    {
        id: "q4",
        label: "Q4",
        text: "Could agent-led claim intake bypass it?",
        rationale:
            "Trace a possible bypass and the coordination it would still require.",
    },
];
const networkQuestions: StartFramingQuestion[] = [
    {
        id: "q1",
        label: "Q1",
        text: "Who controls access to the repair network?",
        rationale:
            "Examine how participation, assignment and network rules are decided.",
    },
    {
        id: "q2",
        label: "Q2",
        text: "What keeps insurers and repairers using the network?",
        rationale:
            "Separate contractual participation from dependencies that may persist.",
    },
    {
        id: "q3",
        label: "Q3",
        text: "Could another coordinator reproduce these relationships?",
        rationale:
            "Investigate the relationships and integrations a substitute would need.",
    },
];
function report(detail: string) {
    window.dispatchEvent(
        new CustomEvent("workbench-example-action", {
            detail: `Illustrative callback: ${detail}`,
        }),
    );
}
/** Places gallery controls in its toolbar; isolated examples keep their controls in place. */
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
    scope,
    count,
    launched,
    hasReference,
}: {
    activities: readonly ConversationWorkItem[];
    scope: string;
    count: number;
    launched: boolean;
    hasReference: boolean;
}) {
    return (
        <ConversationContext
            title={`${company.ticker} · Research`}
            activities={activities}
            plan={
                <>
                    <p>{scope}</p>
                    <span className="chat-context-meta">
                        {launched ? "Accepted framing" : "Proposed framing"} ·{" "}
                        {count} questions
                    </span>
                </>
            }
            outputs={
                <p className="chat-context-empty">No retained outputs yet.</p>
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
function EntryExample() {
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
                                                        setHasSearched(false);
                                                    }}
                                                    isSearching={false}
                                                    lookupError={null}
                                                    hasResolution={selected}
                                                    hasSearched={hasSearched}
                                                    resultCount={
                                                        matches ? 1 : 0
                                                    }
                                                    onClear={() => {
                                                        setSelected(false);
                                                        setQuery("");
                                                        setHasSearched(false);
                                                    }}
                                                    onSearch={() => {
                                                        setSearchTerm(
                                                            query.trim(),
                                                        );
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
type PreviewConversation = {
    scenario: "specific" | "company";
    needsContext: boolean;
    scope: string;
    questions: StartFramingQuestion[];
    suppliedContext?: { question: string; answer: string };
    draft: string;
    messages: {
        id: string;
        text: string;
        from?: "user" | "assistant";
        status?: "running" | "interrupted";
    }[];
    launched: boolean;
    framingMessageCount: number;
};
const previewKey = "start-conversation-preview-v3";
function freshConversation(): PreviewConversation {
    return {
        scenario: "specific",
        needsContext: false,
        scope: claimsScope,
        questions: [...initialQuestions],
        draft: "",
        messages: [],
        launched: false,
        framingMessageCount: 0,
    };
}
function readConversation(): PreviewConversation {
    try {
        const stored = sessionStorage.getItem(previewKey);
        if (!stored) return freshConversation();
        const data: unknown = JSON.parse(stored);
        if (
            typeof data === "object" &&
            data !== null &&
            "questions" in data &&
            Array.isArray(data.questions) &&
            data.questions.every(
                (q) =>
                    typeof q.id === "string" &&
                    typeof q.text === "string" &&
                    typeof q.label === "string",
            ) &&
            "scope" in data &&
            typeof data.scope === "string" &&
            "draft" in data &&
            typeof data.draft === "string" &&
            "messages" in data &&
            Array.isArray(data.messages) &&
            data.messages.every(
                (m) =>
                    m !== null &&
                    typeof m === "object" &&
                    typeof m.id === "string" &&
                    typeof m.text === "string" &&
                    (m.from === undefined ||
                        m.from === "user" ||
                        m.from === "assistant"),
            ) &&
            "scenario" in data &&
            (data.scenario === "specific" || data.scenario === "company") &&
            "needsContext" in data &&
            typeof data.needsContext === "boolean" &&
            "launched" in data &&
            typeof data.launched === "boolean" &&
            "framingMessageCount" in data &&
            typeof data.framingMessageCount === "number"
        )
            return {
                ...data,
                messages: data.messages.map((message) =>
                    message.status === "running"
                        ? { ...message, status: "interrupted" }
                        : message,
                ),
            } as PreviewConversation;
        throw new Error("Invalid saved preview");
    } catch {
        report(
            "Saved preview could not be restored. A fresh illustrative conversation was opened.",
        );
        return freshConversation();
    }
}
const guidedExamples = [
    {
        id: "scope",
        label: "Example: narrower scope",
        text: "Focus on insurer–repairer coordination after photo intake.",
    },
    {
        id: "wording",
        label: "Example: reword Q1",
        text: "Distinguish who decides the rules from who executes the workflow in Q1.",
    },
    {
        id: "switching",
        label: "Example: switching costs",
        text: "Add a question about switching costs.",
    },
] as const;
function PreviewMessages({
    messages,
}: {
    messages: PreviewConversation["messages"];
}) {
    return <ConversationMessages ids={messages.map((message) => message.id)} />;
}
function previewMessages(
    messages: PreviewConversation["messages"],
): ThreadMessageLike[] {
    return messages.map((message) => ({
        id: message.id,
        role: message.from ?? "user",
        content: message.text,
        ...(message.status
            ? {
                  status:
                      message.status === "running"
                          ? { type: "running" as const }
                          : {
                                type: "incomplete" as const,
                                reason: "error" as const,
                            },
              }
            : {}),
    }));
}
function FramingExample({
    trialControls,
    state,
    update,
    onLaunch,
}: {
    state: PreviewConversation;
    update: (patch: Partial<PreviewConversation>) => void;
    onLaunch: () => void;
    trialControls: ReactNode;
}) {
    const { scenario, needsContext, scope, questions, suppliedContext } = state;
    const activities: ConversationWorkItem[] = [
        {
            id: "research-framing",
            title: "Prepare research framing",
            state: "completed",
            summary: needsContext
                ? "Company identified; the research boundary needs your direction."
                : "Activity scope and research questions are prepared for your review.",
            details: (
                <p>
                    Illustrative framing state. No source preparation has
                    started.
                </p>
            ),
        },
    ];
    const setNeedsContext = (needsContext: boolean) => update({ needsContext });
    const setScope = (scope: string) => update({ scope });
    const setQuestions = (
        next:
            | StartFramingQuestion[]
            | ((current: StartFramingQuestion[]) => StartFramingQuestion[]),
    ) =>
        update({
            questions:
                typeof next === "function" ? next(state.questions) : next,
        });
    const setSuppliedContext = (
        suppliedContext: PreviewConversation["suppliedContext"],
    ) => update({ suppliedContext });
    const setRefinement = (draft: string) => update({ draft });
    const { inputRef: refinementRef, fill } =
        useQuickTextFill<HTMLTextAreaElement>((text) => {
            setRefinement(text);
        });
    const [example, setExample] = useState<string | null>(null);
    const [failNext, setFailNext] = useState(false);
    const conversation = useWorkbenchConversation({
        messages: previewMessages(state.messages),
        draft: state.draft,
        isRunning: state.messages.some(
            (message) => message.status === "running",
        ),
        onDraftChange: setRefinement,
        onSend: send,
    });
    async function send(text: string) {
        if (failNext) {
            setFailNext(false);
            throw new Error("fixture_delivery_failure");
        }

        const chosen = guidedExamples.find(
            (item) => item.id === example && item.text === text,
        );
        const messages: PreviewConversation["messages"] = [
            ...state.messages,
            { id: crypto.randomUUID(), text },
        ];
        const patch: Partial<PreviewConversation> = { messages, draft: "" };
        let result: string | undefined;
        if (chosen?.id === "scope") {
            patch.scope = chosen.text;
            result = `Updated the activity scope: ${patch.scope}`;
        }
        if (chosen?.id === "wording") {
            patch.questions = state.questions.map((q, i) =>
                i === 0
                    ? {
                          ...q,
                          text: "Does CCC decide coordination rules, or execute workflows defined by insurers?",
                      }
                    : q,
            );
            const revised = patch.questions[0];
            if (!revised) throw new Error("fixture_question_missing");
            result = `Updated ${revised.label}: ${revised.text}`;
        }
        if (chosen?.id === "switching") {
            patch.questions = [
                ...state.questions,
                {
                    id: `q${state.questions.length + 1}`,
                    label: `Q${state.questions.length + 1}`,
                    text: "What would insurers and repairers need to change to switch away from CCC?",
                    rationale:
                        "Examine the practical requirements of substitution.",
                },
            ];
            const added = patch.questions.at(-1);
            if (!added) throw new Error("fixture_question_missing");
            result = `Added to the research program: ${added.text}`;
        }
        if (result)
            messages.push({
                id: crypto.randomUUID(),
                from: "assistant",
                text: result,
            });
        update(patch);
        setExample(null);
        report(
            chosen
                ? "Illustrative framing updated"
                : "Request recorded in this preview; freeform interpretation is not connected.",
        );
    }
    function completeContext(text: string) {
        setNeedsContext(false);
        update({
            messages: [
                ...state.messages,
                { id: crypto.randomUUID(), text, from: "user" },
                {
                    id: crypto.randomUUID(),
                    text: "The framing is ready to review.",
                    from: "assistant",
                },
            ],
        });
    }
    function applyContext(answer: string) {
        const option = activityClarification.choices.find(
            (choice) => choice.value === answer,
        );
        setSuppliedContext({
            question: activityClarification.prompt,
            answer: option?.label ?? answer,
        });
        if (answer === "claims") {
            setScope(claimsScope);
            setQuestions(initialQuestions);
        } else if (answer === "network") {
            setScope(networkScope);
            setQuestions(networkQuestions);
        } else {
            setScope(answer);
            setQuestions([
                {
                    id: "q1",
                    label: "Q1",
                    text: "Who holds decision rights in this activity?",
                    rationale:
                        "Identify who can define the rules and change the workflow.",
                },
                {
                    id: "q2",
                    label: "Q2",
                    text: "Which dependencies would a substitute still need?",
                    rationale:
                        "Examine relationships, information and integrations within the supplied scope.",
                },
                {
                    id: "q3",
                    label: "Q3",
                    text: "Where could an agent change how the activity is coordinated?",
                    rationale:
                        "Test possible changes while keeping remaining dependencies visible.",
                },
            ]);
        }
        completeContext(`Activity selected: ${option?.label ?? answer}`);
    }
    const selectedActivity =
        scope === claimsScope
            ? "claims"
            : scope === networkScope
              ? "network"
              : "other";
    function selectScenario(scenario: "specific" | "company") {
        update({
            ...freshConversation(),
            scenario,
            needsContext: scenario === "company",
        });
    }

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
                        activities={activities}
                        scope={scope}
                        count={questions.length}
                        launched={state.launched}
                        hasReference={scenario === "specific"}
                    />
                }
                runtime={conversation.runtime}
                history={<PreviewMessages messages={state.messages} />}
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
                request={
                    <StartRequestMessage>
                        {scenario === "specific"
                            ? request
                            : "Study CCC Intelligent Solutions."}
                    </StartRequestMessage>
                }
                response={
                    <>
                        {!state.launched && (
                            <ConversationActivityGroup
                                id="framing-preparation-turn"
                                title="Framing preparation"
                                state="completed"
                                activities={activities}
                                summary={
                                    needsContext
                                        ? "Your direction is needed"
                                        : "Ready for your review"
                                }
                            />
                        )}
                        <div className="start-conversation-author">
                            <span>{"//"}</span>
                            <strong>Workbench</strong>
                        </div>
                        <p>
                            {state.launched
                                ? "Research started with the framing you reviewed."
                                : "I can help frame this research before it starts."}
                        </p>
                        {state.launched && (
                            <FramingProposal
                                scope={scope}
                                questions={questions}
                                suppliedContext={suppliedContext}
                            />
                        )}
                    </>
                }
                action={
                    state.launched ? undefined : (
                        <FramingProposal
                            collapsible
                            scope={scope}
                            activity={
                                <div className="start-framing-activity">
                                    {state.launched ? (
                                        <span>{scope}</span>
                                    ) : (
                                        <ToggleGroup
                                            aria-label="Activity"
                                            value={[selectedActivity]}
                                            onValueChange={(values) => {
                                                const value = values[0];
                                                if (typeof value === "string")
                                                    applyContext(value);
                                            }}>
                                            {activityClarification.choices.map(
                                                (choice) => (
                                                    <ToggleGroupItem
                                                        key={choice.value}
                                                        value={choice.value}>
                                                        {selectedActivity ===
                                                            choice.value && (
                                                            <WorkbenchIcon
                                                                name="check"
                                                                size={12}
                                                            />
                                                        )}
                                                        {choice.label}
                                                    </ToggleGroupItem>
                                                ),
                                            )}
                                            <Button
                                                variant="outline"
                                                size="sm"
                                                aria-label="Adjust scope"
                                                disabled={needsContext}
                                                onClick={() =>
                                                    setNeedsContext(true)
                                                }>
                                                Other…
                                            </Button>
                                        </ToggleGroup>
                                    )}
                                    {selectedActivity === "other" && (
                                        <p>{scope}</p>
                                    )}
                                </div>
                            }
                            clarification={
                                needsContext ? (
                                    <FramingClarification
                                        question={{
                                            ...activityClarification,
                                            reason:
                                                scenario === "company" &&
                                                !suppliedContext
                                                    ? activityClarification.reason
                                                    : "Adjust the activity or boundary if the proposed scope does not match your intention.",
                                            proposedValue:
                                                activityClarification.choices.find(
                                                    (choice) =>
                                                        choice.label ===
                                                        suppliedContext?.answer,
                                                )?.value ??
                                                suppliedContext?.answer ??
                                                "claims",
                                        }}
                                        onUseProposal={() =>
                                            completeContext(
                                                "Use the proposed activity scope.",
                                            )
                                        }
                                        onAnswer={applyContext}
                                    />
                                ) : undefined
                            }
                            onAdjustScope={
                                state.launched
                                    ? undefined
                                    : () => setNeedsContext(true)
                            }
                            questions={questions}
                            onQuestionChange={(id, text) => {
                                setQuestions((current) =>
                                    current.map((question) =>
                                        question.id === id
                                            ? { ...question, text }
                                            : question,
                                    ),
                                );
                                update({
                                    messages: [
                                        ...state.messages,
                                        {
                                            id: crypto.randomUUID(),
                                            text: `Question updated: ${text}`,
                                            from: "user",
                                        },
                                    ],
                                });
                            }}
                            onAddQuestion={(text) => {
                                setQuestions((current) => [
                                    ...current,
                                    {
                                        id: `q${current.length + 1}`,
                                        label: `Q${current.length + 1}`,
                                        text,
                                        rationale:
                                            "Additional question suggested by the analyst.",
                                    },
                                ]);
                                update({
                                    messages: [
                                        ...state.messages,
                                        {
                                            id: crypto.randomUUID(),
                                            text: `Question added: ${text}`,
                                            from: "user",
                                        },
                                    ],
                                });
                            }}
                            onStart={state.launched ? undefined : onLaunch}
                        />
                    )
                }
                refinement={
                    <ConversationComposer
                        inputRef={refinementRef}
                        label="Refine the framing in your own words"
                        failed={conversation.failed}
                    />
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
    done,
    state,
    update,
    onOpenProgress,
}: {
    state: PreviewConversation;
    update: (patch: Partial<PreviewConversation>) => void;
    done: boolean;
    onOpenProgress: () => void;
    trialControls: ReactNode;
}) {
    const [workPreview, setWorkPreview] = useState<{
        step: number;
        state: ConversationWorkItem["state"];
        generation: number;
    }>({ step: 0, state: "running", generation: 0 });
    const workState = done ? "completed" : workPreview.state;
    const step = done ? 2 : workPreview.step;
    const activities: ConversationWorkItem[] = [
        ...(state.scenario === "specific"
            ? [
                  {
                      id: "reference-context",
                      title: "Check supplied reference",
                      state: "completed" as const,
                      summary:
                          "Investor presentation recorded as an input; contents not retrieved.",
                      details: (
                          <p>
                              Illustrative reference check. The supplied
                              document has not been read by this preview.
                          </p>
                      ),
                  },
              ]
            : []),
        {
            id: "company-reporting",
            title: "Find company reporting",
            state: step > 0 ? "completed" : workState,
            summary:
                step > 0
                    ? "Filing and earnings candidates listed; contents remain unverified."
                    : workState === "interrupted"
                      ? "Reporting search stopped; no new reading is available."
                      : "Looking for filings and earnings material about claims coordination.",
            details: (
                <p>
                    Illustrative activity — these documents have not been
                    retrieved by this preview.
                </p>
            ),
        },
        ...(step > 0
            ? [
                  {
                      id: "integration-documentation",
                      title: "Find product and integration documentation",
                      state: step === 2 ? ("completed" as const) : workState,
                      summary:
                          step === 2
                              ? "Documentation candidates listed; unavailable readings remain explicit."
                              : workState === "interrupted"
                                ? "Documentation search stopped; listed reporting candidates remain available."
                                : "Looking for insurer integration and workflow documentation.",
                      details: (
                          <p>
                              Illustrative candidate search, not a verified
                              reading or analytical finding.
                          </p>
                      ),
                  },
              ]
            : []),
    ];
    const workSummary =
        workState === "interrupted"
            ? "Preparation stopped; recorded inputs and candidates are retained."
            : workState === "completed"
              ? "Candidates listed; document contents remain unverified."
              : "Preparing the documentary basis";
    const [handoffVisible, setHandoffVisible] = useState(true);
    const [framingOpen, setFramingOpen] = useState(false);
    const framingDetailsId = useId();
    const earlierMessages = state.messages.slice(0, state.framingMessageCount);
    const refinementCount = earlierMessages.filter(
        (message) => message.from !== "assistant",
    ).length;
    const conversation = useWorkbenchConversation({
        messages: previewMessages(state.messages),
        draft: state.draft,
        isRunning: state.messages.some(
            (message) => message.status === "running",
        ),
        onDraftChange: (draft) => update({ draft }),
        onSend: (text) =>
            update({
                messages: [
                    ...state.messages,
                    { id: crypto.randomUUID(), text },
                ],
                draft: "",
            }),
    });
    return (
        <StartResearchScreen
            context={
                <PreviewResearchContext
                    activities={activities}
                    scope={state.scope}
                    count={state.questions.length}
                    launched
                    hasReference={state.scenario === "specific"}
                />
            }
            runtime={conversation.runtime}
            conversation={
                <>
                    <PreviewControls>
                        <PreviewTools>
                            {trialControls}
                            {!done && (
                                <>
                                    <Button
                                        variant="ghost"
                                        size="sm"
                                        disabled={
                                            step > 0 || workState !== "running"
                                        }
                                        onClick={() =>
                                            setWorkPreview((current) => ({
                                                ...current,
                                                step: 1,
                                                state: "running",
                                            }))
                                        }>
                                        Advance illustrative work
                                    </Button>
                                    <Button
                                        variant="ghost"
                                        size="sm"
                                        disabled={workState !== "running"}
                                        onClick={() =>
                                            setWorkPreview((current) => ({
                                                ...current,
                                                step: 2,
                                                state: "completed",
                                            }))
                                        }>
                                        Finish illustrative work
                                    </Button>
                                    <Button
                                        variant="ghost"
                                        size="sm"
                                        disabled={workState !== "running"}
                                        onClick={() =>
                                            setWorkPreview((current) => ({
                                                ...current,
                                                state: "interrupted",
                                            }))
                                        }>
                                        Interrupt illustrative work
                                    </Button>
                                    {workState !== "running" && (
                                        <Button
                                            variant="ghost"
                                            size="sm"
                                            onClick={() =>
                                                setWorkPreview((current) => ({
                                                    step: 0,
                                                    state: "running",
                                                    generation:
                                                        current.generation + 1,
                                                }))
                                            }>
                                            Restart illustrative work
                                        </Button>
                                    )}
                                </>
                            )}
                        </PreviewTools>
                    </PreviewControls>
                    <span className="wb-label">Conversation</span>
                    <StartRequestMessage>
                        {state.scenario === "specific"
                            ? request
                            : "Study CCC Intelligent Solutions."}
                    </StartRequestMessage>
                    <StartFramingSummary
                        scope={state.scope}
                        questionCount={state.questions.length}
                        onInspect={() => setFramingOpen((value) => !value)}
                        expanded={framingOpen}
                        detailsId={framingDetailsId}
                    />
                    <div id={framingDetailsId} hidden={!framingOpen}>
                        <FramingProposal
                            introduction="Research started with this framing."
                            scope={state.scope}
                            questions={state.questions}
                            suppliedContext={state.suppliedContext}
                        />
                    </div>
                    {state.suppliedContext && (
                        <details>
                            <summary>Your clarification</summary>
                            <p>{state.suppliedContext.question}</p>
                            <p>{state.suppliedContext.answer}</p>
                        </details>
                    )}
                    <details>
                        <summary>
                            Earlier conversation · {refinementCount}{" "}
                            {refinementCount === 1
                                ? "refinement"
                                : "refinements"}
                        </summary>
                        <PreviewMessages messages={earlierMessages} />
                    </details>
                    <PreviewMessages
                        messages={state.messages.slice(
                            state.framingMessageCount,
                        )}
                    />
                    <div
                        data-slot="conversation-assistant-turn"
                        data-message-id="source-preparation-turn">
                        <ConversationActivityGroup
                            key={workPreview.generation}
                            id={`source-preparation-turn-${workPreview.generation}`}
                            title="Source preparation"
                            summary={workSummary}
                            state={workState}
                            activities={activities}
                        />
                        <div className="start-conversation-author">
                            <span>{"//"}</span>
                            <strong>Workbench</strong>
                        </div>
                        <p className="start-preview-reply">
                            <span>{"// "}</span>
                            {done
                                ? `The material is ready. Investigation is starting on the ${state.questions.length} questions.`
                                : workState === "completed"
                                  ? "The illustrative candidate list is ready. Document contents still need to be retrieved and checked."
                                  : workState === "interrupted"
                                    ? "The illustrative preparation stopped. Recorded inputs and any listed candidates remain available."
                                    : "Research started. I'll bring you to Progress when the material is ready."}
                        </p>
                    </div>
                </>
            }
            conversationComposer={
                <ConversationComposer
                    label="Ask about the sources"
                    compact
                    failed={conversation.failed}
                />
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
}: {
    name: StartScreenName;
    theme: "light" | "dark";
    onNavigate: (screen: StartScreenName) => void;
    onOpenProgress: () => void;
}) {
    const [state, setState] = useState(readConversation);
    const update = (patch: Partial<PreviewConversation>) =>
        setState((current) => ({ ...current, ...patch }));
    const [reply, setReply] = useState<{ id: string; step: number } | null>(
        null,
    );
    useEffect(() => {
        if (!reply) return;
        const timer = window.setTimeout(() => {
            setState((current) => ({
                ...current,
                messages: current.messages.map((message) =>
                    message.id === reply.id
                        ? {
                              ...message,
                              text: Array.from(
                                  { length: reply.step + 1 },
                                  (_, index) =>
                                      `**Illustrative reading ${index + 1}.** Examine who sets the routing rules, owns operational context, and can substitute each integration. This preview does not establish an analytical finding. [Source context](https://www.sec.gov/edgar/search/).`,
                              ).join("\n\n"),
                              status: reply.step < 23 ? "running" : undefined,
                          }
                        : message,
                ),
            }));
            setReply(
                reply.step < 23 ? { ...reply, step: reply.step + 1 } : null,
            );
        }, 200);
        return () => window.clearTimeout(timer);
    }, [reply]);
    const trialControls = (
        <section
            aria-label="Illustrative conversation controls"
            className="flex flex-wrap gap-1">
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
                disabled={reply !== null}
                onClick={() => {
                    const id = crypto.randomUUID();
                    setState((current) => ({
                        ...current,
                        messages: [
                            ...current.messages,
                            {
                                id,
                                from: "assistant",
                                text: "**Illustrative reading",
                                status: "running",
                            },
                        ],
                    }));
                    setReply({ id, step: 0 });
                }}>
                Grow illustrative reply
            </Button>
            {reply && (
                <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                        setState((current) => ({
                            ...current,
                            messages: current.messages.map((message) =>
                                message.id === reply.id
                                    ? { ...message, status: "interrupted" }
                                    : message,
                            ),
                        }));
                        setReply(null);
                    }}>
                    Interrupt illustrative reply
                </Button>
            )}
        </section>
    );
    useEffect(() => {
        try {
            sessionStorage.setItem(previewKey, JSON.stringify(state));
        } catch {
            report("Preview continuity is unavailable in this browser.");
        }
    }, [state]);
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
                {name === "framing" ? (
                    <FramingExample
                        trialControls={trialControls}
                        state={state}
                        update={update}
                        onLaunch={() => {
                            const next = {
                                ...state,
                                launched: true,
                                framingMessageCount: state.messages.length,
                            };
                            sessionStorage.setItem(
                                previewKey,
                                JSON.stringify(next),
                            );
                            setState(next);
                            onNavigate("launched");
                        }}
                    />
                ) : name === "launched" || name === "handoff" ? (
                    <ResearchExample
                        trialControls={trialControls}
                        done={name === "handoff"}
                        state={state}
                        update={update}
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
                    <EntryExample />
                )}
            </WorkbenchShellSurface>
        </WorkbenchUiRoot>
    );
}
