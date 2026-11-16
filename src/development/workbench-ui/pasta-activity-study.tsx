import { ArrowRight01Icon } from "@hugeicons/core-free-icons";
import { useId, useState } from "react";
import {
    ConversationActivity,
    type ConversationWorkItem,
    workStateLabels,
} from "@/components/chat/conversation-activity";
import { ConversationActivityList } from "@/components/chat/conversation-activity-list";
import { DEFAULT_CONVERSATION_AGENTS } from "@/components/chat/conversation-agent";
import { ConversationMission } from "@/components/chat/conversation-mission";
import Icon from "@/components/icon";
import { Button } from "@/components/ui/button";
import {
    Collapsible,
    CollapsibleContent,
    CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
    Select,
    SelectContent,
    SelectGroup,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import styles from "./pasta-activity-study.module.css";

type StudyState = ConversationWorkItem["state"];
type StudyStep = { label: string; detail: string };
const scenarios: Record<string, { title: string; steps: StudyStep[] }> = {
    sources: {
        title: "Documentary preparation",
        steps: [
            {
                label: "Find company reporting",
                detail: "Reporting candidates retained for documentary inquiry.",
            },
            {
                label: "Read integration documentation",
                detail: "Inspecting how the platform connects IT teams, buyers and implementation partners.",
            },
            {
                label: "Check documentary coverage",
                detail: "Organize contributions and identify what the retained material cannot establish.",
            },
        ],
    },
    workbench: {
        title: "Explain the retained dossier",
        steps: [
            {
                label: "Read the dossier context",
                detail: "Using the recorded framing and available material.",
            },
            {
                label: "Compare retained material",
                detail: "Comparing what the material supports with what remains uncertain.",
            },
            {
                label: "Prepare the explanation",
                detail: "Keep the interpretation, available support and uncertainty readable.",
            },
        ],
    },
    investigation: {
        title: "Examine workflow control",
        steps: [
            {
                label: "Inspect decision rights",
                detail: "Distinguishing supply, execution and control.",
            },
            {
                label: "Compare counter-evidence",
                detail: "Look for material that could overturn the current interpretation.",
            },
            {
                label: "Prepare the assessment",
                detail: "Keep supported findings and decisive unknowns distinct.",
            },
        ],
    },
    synthesis: {
        title: "Prepare the research synthesis",
        steps: [
            {
                label: "Gather the findings",
                detail: "Using the current retained work and analyst decisions.",
            },
            {
                label: "Check question coverage",
                detail: "Make conflicts and missing support explicit.",
            },
            {
                label: "Prepare the synthesis",
                detail: "Make the economic interpretation and its limits inspectable.",
            },
        ],
    },
};
const stateOptions = (Object.keys(workStateLabels) as StudyState[]).map(
    (value) => ({ value, label: workStateLabels[value] }),
);
const agentOptions = Object.values(DEFAULT_CONVERSATION_AGENTS).map(
    (agent) => ({ value: agent.id, label: agent.name }),
);

/** Illustrative state controls exercise the same activity rendering used in the connected chat. */
export function PastaActivityStudy({
    retained,
}: {
    retained: readonly ConversationWorkItem[];
}) {
    const controlId = useId();
    const [agentId, setAgentId] = useState("sources");
    const [state, setState] = useState<StudyState>("running");
    const [step, setStep] = useState(1);
    const agent = DEFAULT_CONVERSATION_AGENTS[agentId];
    const scenario = scenarios[agentId];
    if (!agent || !scenario) throw new Error("Unknown illustrative agent");
    const operations = scenario.steps.map(
        (item, index): ConversationWorkItem => ({
            id: `${agentId}-${item.label}`,
            title: item.label,
            summary: item.detail,
            state:
                state === "completed" || index < step
                    ? "completed"
                    : index > step
                      ? "waiting"
                      : state,
        }),
    );
    return (
        <div className={styles.preview}>
            <p className={styles.disclosure}>
                Illustrative UI · no agent is running. Use the controls to
                compare recorded states.
            </p>
            <div className={styles.controls}>
                <label htmlFor={`${controlId}-agent`}>
                    <span>Agent</span>
                    <Select
                        items={agentOptions}
                        value={agentId}
                        onValueChange={(value) => {
                            if (value && scenarios[value]) {
                                setAgentId(value);
                            }
                        }}>
                        <SelectTrigger
                            size="sm"
                            id={`${controlId}-agent`}
                            aria-label="Illustrative agent">
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectGroup>
                                {agentOptions.map((option) => (
                                    <SelectItem
                                        key={option.value}
                                        value={option.value}>
                                        {option.label}
                                    </SelectItem>
                                ))}
                            </SelectGroup>
                        </SelectContent>
                    </Select>
                </label>
                <label htmlFor={`${controlId}-state`}>
                    <span>State</span>
                    <Select
                        items={stateOptions}
                        value={state}
                        onValueChange={(value) => {
                            const option = stateOptions.find(
                                (option) => option.value === value,
                            );
                            if (option) setState(option.value);
                        }}>
                        <SelectTrigger
                            size="sm"
                            id={`${controlId}-state`}
                            aria-label="Illustrative work state">
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectGroup>
                                {stateOptions.map((option) => (
                                    <SelectItem
                                        key={option.value}
                                        value={option.value}>
                                        {option.label}
                                    </SelectItem>
                                ))}
                            </SelectGroup>
                        </SelectContent>
                    </Select>
                </label>
                <Button
                    variant="outline"
                    size="sm"
                    disabled={state !== "running"}
                    onClick={() => {
                        if (step >= scenario.steps.length - 1)
                            setState("completed");
                        else setStep(step + 1);
                    }}>
                    Advance work
                </Button>
                <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                        setStep(0);
                        setState("running");
                    }}>
                    Replay
                </Button>
            </div>

            <ConversationMission
                agent={agent}
                mission={{
                    id: `study-${agentId}`,
                    agentId,
                    title: scenario.title,
                    state,
                    operations,
                    summary: `${operations.length} recent operations · ${retained.length} earlier operations`,
                    details: (
                        <>
                            <ConversationActivityList>
                                {operations.map((operation) => (
                                    <ConversationActivity
                                        key={operation.id}
                                        {...operation}
                                    />
                                ))}
                            </ConversationActivityList>
                            <Collapsible>
                                <CollapsibleTrigger
                                    render={
                                        <Button variant="ghost" size="sm" />
                                    }>
                                    <Icon iconNode={ArrowRight01Icon} />
                                    Earlier recorded activity ·{" "}
                                    {retained.length} operations
                                </CollapsibleTrigger>
                                <CollapsibleContent>
                                    <ConversationActivityList>
                                        {retained.map((item) => (
                                            <ConversationActivity
                                                key={item.id}
                                                {...item}
                                                compact>
                                                {item.details}
                                            </ConversationActivity>
                                        ))}
                                    </ConversationActivityList>
                                </CollapsibleContent>
                            </Collapsible>
                        </>
                    ),
                }}
            />
            <p className={styles.caption}>
                Recorded inputs and outcomes remain separate from an analytical
                conclusion.
            </p>
        </div>
    );
}
