import "./preview-controls.css";
import {
    AssistantRuntimeProvider,
    ComposerPrimitive,
} from "@assistant-ui/react";
import {
    ArrowDown01Icon,
    ArrowRight01Icon,
    ArrowUp02Icon,
    CheckmarkCircle02Icon,
    File01Icon,
    Search01Icon,
} from "@hugeicons/core-free-icons";
import { useId, useState } from "react";
import { useWorkbenchConversation } from "@/components/chat/workbench-conversation";
import Icon from "@/components/icon";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import {
    Collapsible,
    CollapsibleContent,
    CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { WorkbenchUiRoot } from "@/components/workbench-ui/root";
import "./chat-composition-mocks.css";

const compositions = [
    {
        id: "continuous",
        name: "Continuous thread",
        description:
            "Visible activity in the thread, an open question, and one attached composer.",
        marker: "01",
    },
    {
        id: "grouped",
        name: "Grouped turns",
        description:
            "Work is grouped by turn; the attached action opens when needed.",
        marker: "02",
    },
    {
        id: "reading",
        name: "Reading first",
        description:
            "The response leads; references and supporting work stay one click away.",
        marker: "03",
    },
] as const;
type Composition = (typeof compositions)[number]["id"];
type Scene = "clarification" | "framing" | "research";
const questions = [
    "Who sets the rules for routing a claim?",
    "Who retains the operational context?",
    "What would an insurer need to replace CCC?",
];
const choices = [
    "Photo-led claims, from intake to estimate",
    "Coordination between insurers and repairers",
    "Use the scope Workbench proposes",
] as const;
const researchWork = [
    {
        title: "Company reporting",
        detail: "Locate the business description and the scope of the claims workflow.",
        complete: true,
    },
    {
        title: "Product and integration material",
        detail: "Identify the systems, participants and decisions described in the workflow.",
        complete: true,
    },
    {
        title: "Decision rights and counter-evidence",
        detail: "Look for who can set rules, change the route, and substitute a participant.",
        complete: false,
    },
];

const framingWork = [
    {
        title: "Company identity",
        detail: "Keep the selected legal entity as the basis of the research.",
        complete: true,
    },
    {
        title: "Proposed activity boundary",
        detail: "Prepare an initial scope without starting documentary research.",
        complete: true,
    },
    {
        title: "Research direction",
        detail: "Clarify the boundary that could materially change the research.",
        complete: false,
    },
];

function WorkEntries({
    condensed = false,
    research,
}: {
    condensed?: boolean;
    research: boolean;
}) {
    const work = research ? researchWork : framingWork;
    return (
        <div className="cm-work-entries">
            {work.map((entry) => (
                <Collapsible key={entry.title}>
                    <CollapsibleTrigger className="cm-work-line">
                        <Icon
                            iconNode={
                                entry.complete
                                    ? CheckmarkCircle02Icon
                                    : Search01Icon
                            }
                            size={14}
                        />
                        <span>{entry.title}</span>
                        <span className="cm-work-trailing">
                            {entry.complete
                                ? research
                                    ? "Read"
                                    : "Prepared"
                                : research
                                  ? "In progress"
                                  : "Needs your input"}
                        </span>
                    </CollapsibleTrigger>
                    <CollapsibleContent>
                        <p className="cm-work-detail">
                            {entry.detail} <span>Illustrative activity.</span>
                        </p>
                    </CollapsibleContent>
                </Collapsible>
            ))}
            {!condensed && (
                <span className="cm-work-note">
                    {research ? "Documentary preparation" : "Research framing"}{" "}
                    · illustrative state
                </span>
            )}
        </div>
    );
}

function WorkGroup({
    composition,
    research,
}: {
    composition: Composition;
    research: boolean;
}) {
    if (composition === "continuous")
        return <WorkEntries research={research} />;
    return (
        <Collapsible className="cm-work-group" defaultOpen={false}>
            <CollapsibleTrigger className="cm-group-trigger">
                <Icon iconNode={ArrowRight01Icon} size={12} />
                <span>
                    {composition === "grouped"
                        ? research
                            ? "Examining the documentary basis"
                            : "Preparing the research scope"
                        : research
                          ? "Research activity"
                          : "Framing preparation"}
                </span>
                <span className="cm-work-trailing">
                    {research
                        ? "2 read · 1 in progress"
                        : "2 prepared · input needed"}
                </span>
            </CollapsibleTrigger>
            <CollapsibleContent>
                <WorkEntries condensed research={research} />
            </CollapsibleContent>
        </Collapsible>
    );
}

function PendingPanel({
    composition,
    proposal,
    onResolve,
    onLaunch,
}: {
    composition: Composition;
    proposal: boolean;
    onResolve: (answer: string) => void;
    onLaunch: () => void;
}) {
    const id = useId();
    const [answer, setAnswer] = useState<string>(choices[0]);
    const [expanded, setExpanded] = useState(composition === "continuous");
    return (
        <Collapsible
            className="cm-pending"
            open={expanded}
            onOpenChange={setExpanded}>
            <CollapsibleTrigger className="cm-pending-heading">
                <span className="cm-pending-state" />
                <span>{proposal ? "Proposed research" : "Your direction"}</span>
                <span className="cm-pending-summary">
                    {proposal ? "Photo-led claims · 3 questions" : answer}
                </span>
                <Icon iconNode={ArrowDown01Icon} size={14} />
            </CollapsibleTrigger>
            <CollapsibleContent>
                <div className="cm-pending-body">
                    {proposal ? (
                        <>
                            <p className="cm-pending-question">
                                Examine insurer–repairer coordination after
                                photo intake.
                            </p>
                            <ol className="cm-program">
                                {questions.map((question, index) => (
                                    <li key={question}>
                                        <span>{index + 1}</span>
                                        {question}
                                    </li>
                                ))}
                            </ol>
                            <p className="cm-small-copy">
                                You can refine this proposal before starting.
                            </p>
                        </>
                    ) : (
                        <>
                            <p className="cm-pending-question">
                                Which part of CCC’s claims workflow should this
                                study examine?
                            </p>
                            <RadioGroup
                                value={answer}
                                onValueChange={setAnswer}
                                className="cm-options"
                                onKeyDown={(event) => {
                                    if (!/^[1-3]$/.test(event.key)) return;
                                    const choice =
                                        choices[Number(event.key) - 1];
                                    if (choice) {
                                        event.preventDefault();
                                        setAnswer(choice);
                                    }
                                }}>
                                {choices.map((choice, index) => (
                                    <label
                                        className="cm-option"
                                        key={choice}
                                        htmlFor={`${id}-${index}`}>
                                        <RadioGroupItem
                                            id={`${id}-${index}`}
                                            value={choice}
                                        />
                                        <span className="cm-option-text">
                                            {choice}
                                        </span>
                                        <kbd>{index + 1}</kbd>
                                    </label>
                                ))}
                            </RadioGroup>
                        </>
                    )}
                </div>
            </CollapsibleContent>
            <div className="cm-pending-footer">
                <span>
                    {proposal
                        ? "Research starts only when you choose."
                        : "A proposed scope is available."}
                </span>
                <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                        if (!proposal && !expanded) {
                            setExpanded(true);
                            return;
                        }
                        proposal ? onLaunch() : onResolve(answer);
                    }}>
                    {proposal
                        ? "Start research"
                        : expanded
                          ? "Use this scope"
                          : "Choose a scope"}
                    <Icon iconNode={ArrowRight01Icon} size={13} />
                </Button>
            </div>
        </Collapsible>
    );
}

function MockConversation({
    study,
    scene,
    mobile,
}: {
    study: (typeof compositions)[number];
    scene: Scene;
    mobile: boolean;
}) {
    const composition = study.id;
    const [proposal, setProposal] = useState(scene === "framing");
    const [launched, setLaunched] = useState(scene === "research");
    const [receipt, setReceipt] = useState("");
    const [draft, setDraft] = useState("");
    const [messages, setMessages] = useState<
        { id: string; role: "user"; content: string }[]
    >([]);
    const [referencesOpen, setReferencesOpen] = useState(false);
    const conversation = useWorkbenchConversation({
        messages,
        draft,
        onDraftChange: setDraft,
        onSend: (text) =>
            setMessages((current) => [
                ...current,
                { id: crypto.randomUUID(), role: "user", content: text },
            ]),
    });
    return (
        <AssistantRuntimeProvider runtime={conversation.runtime}>
            <section
                className="cm-frame"
                data-composition={composition}
                data-mobile={mobile}
                aria-label={`${study.name} mock`}>
                <header className="cm-app-header">
                    <span className="cm-brand">{"//"}</span>
                    <span>Workbench</span>
                    <span className="cm-header-divider" />
                    <span className="cm-company">
                        CCC Intelligent Solutions
                    </span>
                    <span className="cm-company-symbol">CCCS</span>
                    <Button
                        variant="ghost"
                        size="xs"
                        className="cm-reference-button"
                        onClick={() => setReferencesOpen((open) => !open)}
                        aria-expanded={referencesOpen}>
                        References <span>3</span>
                    </Button>
                </header>
                <div className="cm-frame-content">
                    <div className="cm-chat-column">
                        <div
                            className="cm-transcript"
                            role="log"
                            aria-label={`${study.name} conversation`}>
                            <div className="cm-user-message">
                                {launched
                                    ? "What would make the orchestration thesis weaker?"
                                    : "Where could agents change CCC’s position in the claims workflow?"}
                            </div>
                            <div className="cm-turn">
                                <div className="cm-assistant-author">
                                    <span>{"//"}</span> Workbench
                                </div>
                                <p>
                                    {launched
                                        ? "I’ll look for evidence that insurers retain the rules, operational context and authority to replace individual services."
                                        : "I’ll separate who sets the rules, who holds the operational context, and who can act across systems."}
                                </p>
                                {composition !== "reading" && (
                                    <WorkGroup
                                        composition={composition}
                                        research={launched}
                                    />
                                )}
                                <p className="cm-answer">
                                    {launched
                                        ? "The useful distinction is coordination versus authority. The investigation will test whether replacing CCC would require rebuilding a shared workflow, or substituting modules within one the insurer already controls."
                                        : proposal
                                          ? "I’ve prepared a scope and three research questions. You can refine the proposal below, or start with it as shown."
                                          : "One boundary needs your direction before I frame the research: the photo-led claim itself, or the coordination between insurers and repairers."}
                                </p>
                                {composition === "reading" && (
                                    <>
                                        <div className="cm-reference-strip">
                                            <span>
                                                <Icon
                                                    iconNode={File01Icon}
                                                    size={12}
                                                />{" "}
                                                {launched
                                                    ? "Company reporting"
                                                    : "Company identity"}
                                            </span>
                                            <span>
                                                <Icon
                                                    iconNode={File01Icon}
                                                    size={12}
                                                />{" "}
                                                {launched
                                                    ? "Product material"
                                                    : "Research boundary"}
                                            </span>
                                        </div>
                                        <WorkGroup
                                            composition={composition}
                                            research={launched}
                                        />
                                    </>
                                )}
                            </div>
                            {receipt && (
                                <div className="cm-receipt">
                                    <Icon
                                        iconNode={CheckmarkCircle02Icon}
                                        size={14}
                                    />
                                    <span>{receipt}</span>
                                </div>
                            )}
                            {messages.map((message) => (
                                <div
                                    key={message.id}
                                    className="cm-user-message">
                                    {message.content}
                                </div>
                            ))}
                            {messages.length > 0 && (
                                <output className="cm-small-copy">
                                    Displayed in this mock only. No message has
                                    been sent to an agent.
                                </output>
                            )}
                            {launched && (
                                <div className="cm-active-work">
                                    <span />
                                    Checking decision rights and competing
                                    interpretations
                                </div>
                            )}
                        </div>
                        <div className="cm-composer-dock">
                            {!launched ? (
                                <PendingPanel
                                    composition={composition}
                                    proposal={proposal}
                                    onResolve={(answer) => {
                                        setReceipt(
                                            `Research direction: ${answer}`,
                                        );
                                        setProposal(true);
                                    }}
                                    onLaunch={() => {
                                        setReceipt(
                                            "Research started with the framing shown above — illustrative transition.",
                                        );
                                        setLaunched(true);
                                    }}
                                />
                            ) : (
                                <div className="cm-research-banner">
                                    <span className="cm-pending-state" />
                                    <span>Sources is preparing material</span>
                                    <span>Discussion remains available</span>
                                </div>
                            )}
                            <ComposerPrimitive.Root
                                className="cm-composer"
                                aria-label={`${study.name} composer`}>
                                <ComposerPrimitive.Input
                                    aria-label={`Message Workbench in ${study.name}`}
                                    placeholder={
                                        launched
                                            ? "Ask about the material…"
                                            : "Refine the research…"
                                    }
                                    className="cm-composer-input"
                                    rows={2}
                                    addAttachmentOnPaste={false}
                                    cancelOnEscape={false}
                                />
                                <div className="cm-composer-bottom">
                                    <span>
                                        {launched
                                            ? "Within the agreed research scope"
                                            : "Framing · research has not started"}
                                    </span>
                                    <ComposerPrimitive.Send
                                        render={
                                            <Button
                                                variant="round"
                                                size="icon-sm"
                                            />
                                        }
                                        aria-label={`Send in ${study.name}`}>
                                        <Icon
                                            iconNode={ArrowUp02Icon}
                                            size={16}
                                        />
                                    </ComposerPrimitive.Send>
                                </div>
                            </ComposerPrimitive.Root>
                            <p className="cm-integrity">
                                Illustrative composition · no research is
                                executed
                            </p>
                        </div>
                    </div>
                    {referencesOpen && (
                        <aside
                            className="cm-reference-panel"
                            aria-label="Illustrative references">
                            <h3>Reference context</h3>
                            <p>
                                These source roles illustrate the composition.
                                They are not captured evidence.
                            </p>
                            {researchWork.map((entry) => (
                                <div key={entry.title}>
                                    <Icon iconNode={File01Icon} size={14} />
                                    <span>{entry.title}</span>
                                </div>
                            ))}
                            <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => setReferencesOpen(false)}>
                                Close references
                            </Button>
                        </aside>
                    )}
                </div>
            </section>
        </AssistantRuntimeProvider>
    );
}

/** Standalone visual studies; choosing a study does not replace the installed conversation. */
export function ChatCompositionMocks({
    theme,
    onThemeChange,
}: {
    theme: "light" | "dark";
    onThemeChange: (theme: "light" | "dark") => void;
}) {
    const query = new URLSearchParams(location.search);
    const [view, setView] = useState<Composition | "compare">(
        () =>
            compositions.find((item) => item.id === query.get("study"))?.id ??
            "compare",
    );
    const [scene, setScene] = useState<Scene>(
        () =>
            (["clarification", "framing", "research"] as const).find(
                (value) => value === query.get("scene"),
            ) ?? "clarification",
    );
    const [mobile, setMobile] = useState(query.get("mobile") === "1");
    const visible =
        view === "compare"
            ? compositions
            : compositions.filter((item) => item.id === view);
    return (
        <WorkbenchUiRoot theme={theme} className="cm-gallery">
            <header className="cm-study-header">
                <div>
                    <p className="cm-study-context">
                        Workbench / Conversation studies
                    </p>
                    <h1>Three ways to compose the conversation.</h1>
                    <p>
                        Same research, different rhythm. Open a study to explore
                        it at full size.
                    </p>
                </div>
                <ThemeToggle theme={theme} onThemeChange={onThemeChange} />
            </header>
            <nav
                className="cm-study-controls"
                aria-label="Composition previews">
                <div className="cm-control-group preview-control-group">
                    <Button
                        variant={view === "compare" ? "secondary" : "ghost"}
                        aria-pressed={view === "compare"}
                        size="sm"
                        onClick={() => setView("compare")}>
                        Compare all
                    </Button>
                    {compositions.map((item) => (
                        <Button
                            key={item.id}
                            variant={view === item.id ? "secondary" : "ghost"}
                            aria-pressed={view === item.id}
                            size="sm"
                            onClick={() => setView(item.id)}>
                            {item.marker} · {item.name}
                        </Button>
                    ))}
                </div>
                <div className="cm-control-group preview-control-group">
                    {(
                        [
                            ["clarification", "Clarification"],
                            ["framing", "Proposed framing"],
                            ["research", "Research in progress"],
                        ] as const
                    ).map(([value, label]) => (
                        <Button
                            key={value}
                            size="sm"
                            variant={scene === value ? "secondary" : "ghost"}
                            aria-pressed={scene === value}
                            onClick={() => setScene(value)}>
                            {label}
                        </Button>
                    ))}
                </div>
                <Button
                    variant={mobile ? "secondary" : "ghost"}
                    size="sm"
                    aria-pressed={mobile}
                    onClick={() => setMobile((value) => !value)}>
                    Mobile preview
                </Button>
            </nav>
            <main
                className="cm-study-grid"
                data-compare={view === "compare"}
                data-mobile={mobile}>
                {visible.map((item) => (
                    <article className="cm-study" key={item.id}>
                        <header className="cm-study-label">
                            <div>
                                <h2>
                                    <span>{item.marker}</span>
                                    {item.name}
                                </h2>
                                <p>{item.description}</p>
                            </div>
                            {view === "compare" && (
                                <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() => setView(item.id)}
                                    aria-label={`Open ${item.name} study`}>
                                    Open study
                                </Button>
                            )}
                        </header>
                        <MockConversation
                            key={`${item.id}-${scene}`}
                            study={item}
                            scene={scene}
                            mobile={mobile}
                        />
                    </article>
                ))}
            </main>
            <footer className="cm-study-footer">
                Design exploration only. These studies do not change the
                installed START screens or record analytical decisions.
            </footer>
        </WorkbenchUiRoot>
    );
}
