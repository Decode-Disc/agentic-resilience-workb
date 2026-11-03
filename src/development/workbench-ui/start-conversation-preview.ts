import type {
    ExternalThreadQueueAdapter,
    ThreadMessageLike,
} from "@assistant-ui/react";
import { useCallback, useEffect, useRef, useState } from "react";
import {
    type ConversationAgent,
    WORKBENCH_AGENT,
} from "@/components/chat/conversation-agent";
import type { ConversationMissionSnapshot } from "@/components/chat/conversation-mission";
import type { ConversationTurnSnapshot } from "@/components/chat/conversation-turn";
import { useWorkbenchConversation } from "@/components/chat/workbench-conversation";
import type { ResearchControlCommand } from "@/components/composer/slash-commands";
import type { StartFramingQuestion } from "@/components/workspace/start/start-screens";

const request =
    "Does CCC control the photo-led claim workflow, or supply modules an agent could replace?";
const claimsScope =
    "Photo-led auto claims, focusing on coordination between insurers, repairers and CCC, and what an agent could replace.";
const networkScope =
    "Repair network management, focusing on the relationships between insurers, repairers and CCC, and the dependencies a substitute would need.";
export const activityClarification = {
    id: "activity",
    prompt: "Which part of the claims workflow should we focus on?",
    reason: "Your request names the company. The activity determines which relationships and dependencies this dossier should investigate.",
    proposedValue: "claims",
    choices: [
        {
            value: "claims",
            scope: claimsScope,
            label: "Photo-led auto claims",
            description:
                "From damage photos to repair estimates, connecting insurers and repairers.",
        },
        {
            value: "network",
            scope: networkScope,
            label: "Repair network management",
            description:
                "Focus on repairer participation, assignments and network coordination.",
        },
    ],
};
const initialQuestions: StartFramingQuestion[] = [
    {
        id: "q1",
        label: "Q1",
        shortLabel: "Coordination",
        text: "Does CCC control coordination, or supply replaceable modules?",
        rationale: "Distinguish running the workflow from deciding its rules.",
    },
    {
        id: "q2",
        label: "Q2",
        shortLabel: "Switching",
        text: "Is its operational context durable beyond contracts?",
        rationale:
            "Examine what remains useful and difficult to reproduce across renewals.",
    },
    {
        id: "q3",
        label: "Q3",
        shortLabel: "Substitution",
        text: "Could core claims platforms replace it for insurers?",
        rationale:
            "Compare substitution paths and the dependencies they would need.",
    },
    {
        id: "q4",
        label: "Q4",
        shortLabel: "Bypass",
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
export function report(detail: string) {
    window.dispatchEvent(
        new CustomEvent("workbench-example-action", {
            detail: `Illustrative callback: ${detail}`,
        }),
    );
}
export type PreviewMessage = {
    id: string;
    createdAt?: string;
    text: string;
    from?: "user" | "assistant";
    agentId?: string;
    status?: "running" | "interrupted";
    delivery?: "queued" | "steered" | "processed" | "removed";
    deliveryTurnId?: string;
};
type PreviewHistoryEntry =
    | { kind: "message"; message: PreviewMessage }
    | { kind: "mission"; id: string };
/** One recorded history references independently owned mission snapshots. */
export type PreviewConversation = {
    version: 5;
    agents: Record<string, ConversationAgent>;
    history: PreviewHistoryEntry[];
    turns: ConversationTurnSnapshot[];
    missions: ConversationMissionSnapshot[];
    pendingReports: { missionId: string; text: string }[];
    sourcePreparationMissionId?: string;
    questionAction?: { id?: string; text: string } | null;
    selectedQuestionId?: string;
    contextDraft?: string;
    contextChoice?: string;
    analystQuestionIds?: string[];
    startedAt?: string;
    scenario: "specific" | "company";
    needsContext: boolean;
    scope: string;
    questions: StartFramingQuestion[];
    suppliedContext?: { question: string; answer: string };
    draft: string;
    queuePaused?: boolean;
    launched: boolean;
};
type PreviewPatch = Partial<PreviewConversation> & {
    messages?: PreviewMessage[];
};
export const previewKey = "start-conversation-preview-v5";
const previousKeys = [
    "start-conversation-preview-v4",
    "start-conversation-preview-v3",
];
const previewAgents = {
    workbench: WORKBENCH_AGENT,
    sources: { id: "sources", name: "Sources" },
};
function messageEntries(messages: PreviewMessage[]): PreviewHistoryEntry[] {
    return messages.map((message) => ({ kind: "message", message }));
}
function getMessages(state: PreviewConversation): PreviewMessage[] {
    return state.history.flatMap((entry) =>
        entry.kind === "message" ? [entry.message] : [],
    );
}
/** Upserts recorded messages without moving them or losing independent updates and mission anchors. */
function applyPreviewPatch(
    state: PreviewConversation,
    patch: PreviewPatch,
): PreviewConversation {
    const { messages, ...rest } = patch;
    if (!messages) return { ...state, ...rest };
    const updates = new Map(messages.map((message) => [message.id, message]));
    const seen = new Set<string>();
    const history = (rest.history ?? state.history).map((entry) => {
        if (entry.kind !== "message") return entry;
        seen.add(entry.message.id);
        return {
            ...entry,
            message: updates.get(entry.message.id) ?? entry.message,
        };
    });
    return {
        ...state,
        ...rest,
        history: [
            ...history,
            ...messageEntries(
                messages.filter((message) => !seen.has(message.id)),
            ),
        ],
    };
}
function freshConversation(
    scenario: PreviewConversation["scenario"] = "specific",
): PreviewConversation {
    const startedAt = new Date().toISOString();
    return {
        version: 5,
        agents: previewAgents,
        turns: [],
        missions: [],
        pendingReports: [],
        startedAt,
        scenario,
        needsContext: scenario === "company",
        scope: claimsScope,
        questions: [...initialQuestions],
        analystQuestionIds: [],
        draft: "",
        launched: false,
        history: messageEntries([
            {
                id: "initial-request",
                from: "user",
                text:
                    scenario === "specific"
                        ? request
                        : "Study CCC Intelligent Solutions.",
                createdAt: startedAt,
            },
            {
                id: "framing-introduction",
                from: "assistant",
                agentId: "workbench",
                text: "I can help frame this research before it starts.",
                createdAt: startedAt,
            },
        ]),
    };
}
function createPreviewMessage(
    message: Omit<PreviewMessage, "id" | "createdAt">,
): PreviewMessage {
    return {
        ...message,
        ...(message.from === "assistant"
            ? { agentId: message.agentId ?? "workbench" }
            : {}),
        id: crypto.randomUUID(),
        createdAt: new Date().toISOString(),
    };
}
const illustrativeLongAnswer = `## Illustrative reading: coordination and substitution

This is an illustrative response for examining the reading experience. It is not a finding about CCC. The question is whether replacing an application also requires replacing the relationships around it.

### Start with the activity

A photo-led claim connects intake, estimates, insurer requirements and repairer participation. A useful investigation separates each participant's decisions from the software used to exchange information. A workflow diagram alone cannot establish who has authority to change the rules.

### Distinguish integration from control

An integration can make an established process easier to operate without giving its supplier decision rights. Conversely, a company may coordinate participants through contracts or shared operating practices without controlling their individual decisions. These possibilities require different evidence and should not be treated as equivalent.

### Examine what changes when agents act

An agent might receive a user's intention, gather information and transmit an instruction across several tools. That does not establish that it can replace every dependency of the existing workflow. The important comparison is what the agent can execute, what it may decide and what remains dependent on other participants.

### Test substitution in concrete terms

- Identify which information must move between systems.
- Establish who authorizes access and changes to the process.
- Compare the effort of replacing a module with the effort of coordinating a replacement network.
- Keep contractual restrictions separate from operational dependencies.

### Keep competing readings visible

One interpretation is that coordination makes substitution difficult. Another is that interoperable interfaces let a new coordinator reuse the same participants. A third is that an agent changes the intake channel while leaving downstream decisions and relationships intact. These are hypotheses to test, not conclusions established by this preview.

### Organize the comparison

| Question | Material to examine |
| --- | --- |
| Who sets the rules? | Decision rights and participant agreements |
| What must be rebuilt? | Integration requirements and operating dependencies |
| Who can redirect the work? | Routing authority and access conditions |
| What remains unknown? | Non-public terms and unavailable readings |

### Preserve the limits

A source mentioning participation does not measure switching effort. An integration list does not prove exclusive access. A partnership announcement does not reveal the terms governing a relationship. Missing public detail should remain a stated gap rather than becoming evidence of either strength or weakness.

### Next useful question

Which dependency would actually prevent an insurer or repairer from moving the activity elsewhere? The answer requires retained material, competing interpretations and explicit limits. This response only demonstrates their presentation.

**Illustrative reading complete.** No live research or analytical assessment was executed.`;
const illustrativeAnswer =
    "## Replacing software is not replacing coordination\n\nThe illustrative material points to two dependencies:\n\n- **Integrations:** exchanging data inside established workflows.\n- **Coordination:** connecting insurers and repairers around the same claim.\n\n| What to test | Why it matters |\n| --- | --- |\n| Switching effort | Can integrations be rebuilt? |\n| Decision rights | Who can redirect the work? |\n\n**Limit:** This example does not establish switching costs or pricing power.";
function interruptTurn(state: PreviewConversation): PreviewPatch {
    const stoppedIds = new Set(
        state.turns
            .filter((turn) => turn.state === "running")
            .flatMap((turn) =>
                turn.entries.flatMap((entry) =>
                    entry.kind === "message" ? [entry.id] : [],
                ),
            ),
    );
    return {
        turns: state.turns.map((turn) =>
            turn.state !== "running"
                ? turn
                : {
                      ...turn,
                      state: "interrupted",
                      finishedAt: new Date().toISOString(),
                      entries: turn.entries.map((entry) =>
                          entry.kind === "operation" &&
                          entry.operation.state === "running"
                              ? {
                                    ...entry,
                                    operation: {
                                        ...entry.operation,
                                        state: "interrupted",
                                    },
                                }
                              : entry,
                      ),
                  },
        ),
        messages: getMessages(state).map((message) =>
            stoppedIds.has(message.id) && message.status === "running"
                ? { ...message, status: "interrupted" }
                : message,
        ),
    };
}
function validPreviewTime(value: unknown) {
    return (
        value === undefined ||
        (typeof value === "string" && Number.isFinite(Date.parse(value)))
    );
}
function record(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === "object" && !Array.isArray(value);
}
function workState(value: unknown) {
    return (
        value === "running" || value === "completed" || value === "interrupted"
    );
}
function validOperation(value: unknown): boolean {
    return (
        record(value) &&
        typeof value.id === "string" &&
        typeof value.title === "string" &&
        typeof value.summary === "string" &&
        (value.details === undefined || typeof value.details === "string") &&
        workState(value.state)
    );
}
function validStoredTurn(value: unknown): value is ConversationTurnSnapshot {
    return (
        record(value) &&
        typeof value.id === "string" &&
        workState(value.state) &&
        validPreviewTime(value.startedAt) &&
        validPreviewTime(value.finishedAt) &&
        (value.agentId === undefined || typeof value.agentId === "string") &&
        Array.isArray(value.entries) &&
        value.entries.every(
            (entry) =>
                record(entry) &&
                (entry.kind === "message"
                    ? typeof entry.id === "string" &&
                      (entry.phase === "commentary" || entry.phase === "answer")
                    : entry.kind === "operation" &&
                      validOperation(entry.operation)),
        )
    );
}
function validMessage(value: unknown): value is PreviewMessage {
    return (
        record(value) &&
        typeof value.id === "string" &&
        typeof value.text === "string" &&
        validPreviewTime(value.createdAt) &&
        (value.from === undefined ||
            value.from === "user" ||
            value.from === "assistant") &&
        (value.agentId === undefined || typeof value.agentId === "string") &&
        (value.deliveryTurnId === undefined ||
            typeof value.deliveryTurnId === "string") &&
        (value.delivery === undefined ||
            ["queued", "steered", "processed", "removed"].includes(
                String(value.delivery),
            )) &&
        (value.status === undefined ||
            value.status === "running" ||
            value.status === "interrupted")
    );
}
function validFraming(data: Record<string, unknown>): boolean {
    return (
        (data.scenario === "specific" || data.scenario === "company") &&
        typeof data.needsContext === "boolean" &&
        typeof data.launched === "boolean" &&
        typeof data.scope === "string" &&
        typeof data.draft === "string" &&
        (data.queuePaused === undefined ||
            typeof data.queuePaused === "boolean") &&
        validPreviewTime(data.startedAt) &&
        (data.selectedQuestionId === undefined ||
            typeof data.selectedQuestionId === "string") &&
        (data.contextDraft === undefined ||
            typeof data.contextDraft === "string") &&
        (data.suppliedContext === undefined ||
            (record(data.suppliedContext) &&
                typeof data.suppliedContext.question === "string" &&
                typeof data.suppliedContext.answer === "string")) &&
        (data.questionAction === undefined ||
            data.questionAction === null ||
            (record(data.questionAction) &&
                typeof data.questionAction.text === "string" &&
                (data.questionAction.id === undefined ||
                    typeof data.questionAction.id === "string"))) &&
        (data.analystQuestionIds === undefined ||
            (Array.isArray(data.analystQuestionIds) &&
                data.analystQuestionIds.every(
                    (id) => typeof id === "string",
                ))) &&
        (data.contextChoice === undefined ||
            activityClarification.choices.some(
                (choice) => choice.value === data.contextChoice,
            )) &&
        Array.isArray(data.questions) &&
        data.questions.every(
            (q) =>
                record(q) &&
                typeof q.id === "string" &&
                typeof q.text === "string" &&
                typeof q.label === "string" &&
                (q.rationale === undefined ||
                    typeof q.rationale === "string") &&
                (q.shortLabel === undefined ||
                    typeof q.shortLabel === "string"),
        )
    );
}
function validateConversation(value: unknown): PreviewConversation {
    if (
        !record(value) ||
        value.version !== 5 ||
        !validFraming(value) ||
        !record(value.agents) ||
        !Object.entries(value.agents).every(
            ([id, agent]) =>
                record(agent) &&
                agent.id === id &&
                typeof agent.name === "string" &&
                agent.name.trim().length > 0,
        ) ||
        !Array.isArray(value.history) ||
        !value.history.every(
            (entry) =>
                record(entry) &&
                (entry.kind === "message"
                    ? validMessage(entry.message)
                    : entry.kind === "mission" && typeof entry.id === "string"),
        ) ||
        !Array.isArray(value.turns) ||
        !value.turns.every(validStoredTurn) ||
        !Array.isArray(value.missions) ||
        !value.missions.every(
            (mission) =>
                record(mission) &&
                typeof mission.id === "string" &&
                typeof mission.agentId === "string" &&
                typeof mission.title === "string" &&
                workState(mission.state) &&
                validPreviewTime(mission.startedAt) &&
                validPreviewTime(mission.finishedAt) &&
                Array.isArray(mission.operations) &&
                mission.operations.every(validOperation),
        ) ||
        !Array.isArray(value.pendingReports) ||
        !value.pendingReports.every(
            (report) =>
                record(report) &&
                typeof report.missionId === "string" &&
                typeof report.text === "string",
        )
    )
        throw new Error("Invalid saved preview");
    const state = value as PreviewConversation;
    const messages = getMessages(state);
    const ids = new Set(messages.map((message) => message.id));
    const anchors = state.history.flatMap((entry) =>
        entry.kind === "mission" ? [entry.id] : [],
    );
    const missionIds = new Set(state.missions.map((mission) => mission.id));
    if (
        ids.size !== messages.length ||
        missionIds.size !== state.missions.length ||
        new Set(anchors).size !== anchors.length ||
        anchors.length !== missionIds.size ||
        anchors.some((id) => !missionIds.has(id)) ||
        new Set(state.turns.map((turn) => turn.id)).size !== state.turns.length
    )
        throw new Error("Invalid history references");
    if (
        (state.launched && !state.sourcePreparationMissionId) ||
        (state.sourcePreparationMissionId !== undefined &&
            !missionIds.has(state.sourcePreparationMissionId))
    )
        throw new Error("Missing preparation mission");
    const referenced = new Set<string>();
    const operationIds = new Set<string>();
    for (const turn of state.turns) {
        if (!turn.agentId || !state.agents[turn.agentId])
            throw new Error("Missing response agent");
        for (const entry of turn.entries) {
            if (entry.kind === "message") {
                if (!ids.has(entry.id) || referenced.has(entry.id))
                    throw new Error("Invalid response reference");
                referenced.add(entry.id);
            } else {
                if (operationIds.has(entry.operation.id))
                    throw new Error("Duplicate operation");
                operationIds.add(entry.operation.id);
            }
        }
    }
    for (const mission of state.missions) {
        if (!state.agents[mission.agentId])
            throw new Error("Missing mission agent");
        for (const operation of mission.operations) {
            if (operationIds.has(operation.id))
                throw new Error("Duplicate operation");
            operationIds.add(operation.id);
        }
    }
    if (
        messages.some(
            (message) =>
                message.from === "assistant" &&
                (!message.agentId || !state.agents[message.agentId]),
        )
    )
        throw new Error("Missing message agent");
    if (
        new Set(state.pendingReports.map((report) => report.missionId)).size !==
            state.pendingReports.length ||
        state.pendingReports.some(
            (report) =>
                !state.missions.some(
                    (mission) =>
                        mission.id === report.missionId &&
                        mission.state !== "running",
                ),
        )
    )
        throw new Error("Invalid pending result");
    return state;
}
export const guidedExamples = [
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
function previewMessages(messages: PreviewMessage[]): ThreadMessageLike[] {
    return messages
        .filter(
            (message) =>
                message.delivery !== "queued" && message.delivery !== "removed",
        )
        .map((message) => ({
            id: message.id,
            role: message.from ?? "user",
            content: message.text,
            createdAt: message.createdAt
                ? new Date(message.createdAt)
                : undefined,
            metadata: { custom: { agentId: message.agentId } },
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

type PreviewScreen =
    | "composer"
    | "confirm"
    | "framing"
    | "launched"
    | "handoff";
const launchText =
    "Research started. Sources is preparing the documentary material.";
const preparationReply =
    "## Material ready for examination\n\nThe illustrative corpus includes company reporting and integration documentation.\n\n- Examine coordination and substitution dependencies.\n- Gaps: analyst coverage and an unavailable patent search.\n\nThis mock establishes no conclusion about CCC.";
export const preparationQuestionExample = {
    id: "during-preparation",
    label: "Example: ask during preparation",
    text: "Does this already establish that CCC controls the workflow?",
};
const preparationAnswer =
    "No conclusion is established yet. Sources is still collecting material. I’ll distinguish who sets the rules from who executes them. This illustrative exchange does not establish control or switching costs.";

/** Projects the same recorded mission for the transcript, context and documentary progress. */
export function sourcePreparation(state: PreviewConversation) {
    const mission = state.missions.find(
        (entry) => entry.id === state.sourcePreparationMissionId,
    );
    const activities = mission?.operations ?? [];
    return {
        mission,
        activities,
        state: mission?.state ?? "not-started",
        step:
            mission?.state === "completed"
                ? 2
                : activities.some((entry) => entry.id.endsWith("-integration"))
                  ? 1
                  : 0,
    };
}
function acceptDelivery(
    state: PreviewConversation,
    message: PreviewMessage,
    delivery: "queue" | "steer",
): PreviewConversation {
    const turn = state.turns.find((turn) => turn.state === "running");
    const steering = delivery === "steer" && turn;
    const priorAnswerIds = steering
        ? new Set(
              turn.entries.flatMap((entry) =>
                  entry.kind === "message" && entry.phase === "answer"
                      ? [entry.id]
                      : [],
              ),
          )
        : new Set<string>();
    return applyPreviewPatch(state, {
        messages: [
            ...getMessages(state)
                .filter((item) => priorAnswerIds.has(item.id))
                .map((item) => ({ ...item, status: undefined })),
            {
                ...message,
                delivery: steering ? "steered" : "queued",
                deliveryTurnId: steering ? turn.id : undefined,
            },
        ],
        draft: "",
        queuePaused: false,
        turns: steering
            ? state.turns.map((item) =>
                  item.id === turn.id
                      ? {
                            ...item,
                            entries: item.entries.map((entry) =>
                                entry.kind === "message" &&
                                entry.phase === "answer"
                                    ? { ...entry, phase: "commentary" as const }
                                    : entry,
                            ),
                        }
                      : item,
              )
            : state.turns,
    });
}
function responseRunning(state: PreviewConversation) {
    return (
        state.turns.some((turn) => turn.state === "running") ||
        getMessages(state).some((message) => message.status === "running")
    );
}
function flushReports(state: PreviewConversation): PreviewConversation {
    if (responseRunning(state) || !state.pendingReports.length) return state;
    const reports = state.pendingReports.map((report) => ({
        message: createPreviewMessage({ from: "assistant", text: report.text }),
        turnId: `report-${report.missionId}`,
    }));
    return {
        ...state,
        pendingReports: [],
        history: [
            ...state.history,
            ...messageEntries(reports.map((report) => report.message)),
        ],
        turns: [
            ...state.turns,
            ...reports.map(({ message, turnId }) => ({
                id: turnId,
                agentId: "workbench",
                state: "completed" as const,
                startedAt: message.createdAt,
                finishedAt: message.createdAt,
                entries: [
                    {
                        kind: "message" as const,
                        id: message.id,
                        phase: "answer" as const,
                    },
                ],
            })),
        ],
    };
}
function startResearch(state: PreviewConversation): PreviewConversation {
    if (
        state.launched ||
        state.needsContext ||
        state.questionAction ||
        !state.questions.length
    )
        return state;
    const id = crypto.randomUUID();
    const message = createPreviewMessage({
        from: "assistant",
        text: launchText,
    });
    const mission: ConversationMissionSnapshot = {
        id,
        agentId: "sources",
        title: "Documentary preparation",
        state: "running",
        startedAt: message.createdAt,
        operations: [
            ...(state.scenario === "specific"
                ? [
                      {
                          id: `${id}-reference`,
                          title: "Check supplied reference",
                          state: "completed" as const,
                          summary:
                              "Investor presentation recorded as an input; contents not retrieved.",
                          details:
                              "Illustrative reference check. The supplied document has not been read by this preview.",
                      },
                  ]
                : []),
            {
                id: `${id}-reporting`,
                title: "Find company reporting",
                state: "running",
                summary:
                    "Looking for filings and earnings material about claims coordination.",
                details:
                    "Illustrative activity — these documents have not been retrieved by this preview.",
            },
        ],
    };
    return {
        ...state,
        launched: true,
        sourcePreparationMissionId: id,
        history: [
            ...state.history,
            ...messageEntries([message]),
            { kind: "mission", id },
        ],
        missions: [...state.missions, mission],
        turns: [
            ...state.turns,
            {
                id: `launch-${id}`,
                agentId: "workbench",
                state: "completed",
                startedAt: message.createdAt,
                finishedAt: message.createdAt,
                entries: [{ kind: "message", id: message.id, phase: "answer" }],
            },
        ],
    };
}
function advancePreparation(state: PreviewConversation): PreviewConversation {
    const { mission, step } = sourcePreparation(state);
    if (mission?.state !== "running" || step > 0) return state;
    return {
        ...state,
        missions: state.missions.map((entry) =>
            entry.id !== mission.id
                ? entry
                : {
                      ...entry,
                      operations: [
                          ...entry.operations.map((item) =>
                              item.id.endsWith("-reporting")
                                  ? {
                                        ...item,
                                        state: "completed" as const,
                                        summary:
                                            "Filing and earnings candidates listed; contents remain unverified.",
                                    }
                                  : item,
                          ),
                          {
                              id: `${mission.id}-integration`,
                              title: "Find product and integration documentation",
                              state: "running" as const,
                              summary:
                                  "Looking for insurer integration and workflow documentation.",
                              details:
                                  "Illustrative candidate search, not a verified reading or analytical finding.",
                          },
                      ],
                  },
        ),
    };
}
function endPreparation(
    state: PreviewConversation,
    outcome: "completed" | "interrupted",
): PreviewConversation {
    const { mission } = sourcePreparation(state);
    if (mission?.state !== "running") return state;
    return flushReports({
        ...state,
        missions: state.missions.map((entry) =>
            entry.id !== mission.id
                ? entry
                : {
                      ...entry,
                      state: outcome,
                      finishedAt: new Date().toISOString(),
                      operations: entry.operations.map((item) =>
                          item.state !== "running"
                              ? item
                              : {
                                    ...item,
                                    state: outcome,
                                    summary:
                                        outcome === "completed"
                                            ? "Candidates listed; contents remain unverified."
                                            : "Work stopped; recorded inputs remain available.",
                                },
                      ),
                  },
        ),
        pendingReports: [
            ...state.pendingReports,
            {
                missionId: mission.id,
                text:
                    outcome === "completed"
                        ? preparationReply
                        : "Sources stopped its illustrative preparation. Recorded inputs and any listed candidates remain available. Resume or restart illustrative work to continue this preview.",
            },
        ],
    });
}
function sceneState(
    screen: PreviewScreen,
    scenario: PreviewConversation["scenario"] = "specific",
) {
    const fresh = freshConversation(scenario);
    if (screen !== "launched" && screen !== "handoff") return fresh;
    const started = startResearch(fresh);
    return screen === "handoff"
        ? endPreparation(advancePreparation(started), "completed")
        : started;
}

/** Migrates prior preview records without assigning dates that were never recorded. */
function migrateConversation(data: unknown): PreviewConversation {
    if (
        !record(data) ||
        (data.version !== undefined && data.version !== 4) ||
        !validFraming(data) ||
        !Array.isArray(data.messages) ||
        !data.messages.every(validMessage) ||
        (data.turns !== undefined &&
            (!Array.isArray(data.turns) || !data.turns.every(validStoredTurn)))
    )
        throw new Error("Invalid legacy preview");
    const savedMessages = data.messages;
    const ids = new Set(savedMessages.map((message) => message.id));
    if (ids.size !== savedMessages.length)
        throw new Error("Duplicate legacy message");
    const scenario = data.scenario === "company" ? "company" : "specific";
    const seed = getMessages(freshConversation(scenario))
        .filter((message) => !ids.has(message.id))
        .map((message) => ({
            ...message,
            createdAt:
                typeof data.startedAt === "string" ? data.startedAt : undefined,
        }));
    let messages: PreviewMessage[] = [...seed, ...savedMessages].map(
        (message) => ({
            ...message,
            ...(message.from === "assistant" ? { agentId: "workbench" } : {}),
        }),
    );
    const oldTurns: ConversationTurnSnapshot[] = data.turns ?? [];
    if (
        data.sourcePreparationTurnId !== undefined &&
        (typeof data.sourcePreparationTurnId !== "string" ||
            !oldTurns.some((turn) => turn.id === data.sourcePreparationTurnId))
    )
        throw new Error("Invalid legacy mission");
    if (data.version === 4 && data.launched && !data.sourcePreparationTurnId)
        throw new Error("Missing legacy mission");
    let oldSource = oldTurns.find(
        (turn) => turn.id === data.sourcePreparationTurnId,
    );
    if (data.launched && !oldSource) {
        const acknowledgement = messages.find(
            (message) =>
                message.from === "assistant" &&
                message.text.startsWith("Research started."),
        ) ?? {
            id: "legacy-research-start",
            from: "assistant",
            agentId: "workbench",
            text: launchText,
        };
        if (!messages.some((message) => message.id === acknowledgement.id)) {
            const boundary =
                typeof data.framingMessageCount === "number"
                    ? data.framingMessageCount + seed.length
                    : messages.length;
            messages = [
                ...messages.slice(0, boundary),
                acknowledgement,
                ...messages.slice(boundary),
            ];
        }
        oldSource = {
            id: "legacy-source-preparation",
            state: "interrupted",
            startedAt: acknowledgement.createdAt,
            entries: [
                {
                    kind: "message",
                    id: acknowledgement.id,
                    phase: "commentary",
                },
                {
                    kind: "operation",
                    operation: {
                        id: "legacy-source-preparation-status",
                        title: "Source preparation",
                        state: "interrupted",
                        summary:
                            "This saved preview did not retain preparation progress. Restart illustrative work to inspect it.",
                    },
                },
            ],
        };
    }
    const mission: ConversationMissionSnapshot | undefined = oldSource && {
        id: oldSource.id,
        agentId: "sources",
        title: "Documentary preparation",
        state: oldSource.state,
        startedAt: oldSource.startedAt,
        finishedAt: oldSource.finishedAt,
        operations: oldSource.entries.flatMap((entry) =>
            entry.kind === "operation" ? [entry.operation] : [],
        ),
    };
    const sourceMessageIds =
        oldSource?.entries.flatMap((entry) =>
            entry.kind === "message" ? [entry.id] : [],
        ) ?? [];
    const firstSourceId = sourceMessageIds[0];
    if (mission && !messages.some((message) => message.id === firstSourceId))
        throw new Error("Missing legacy acknowledgement");
    const history = messageEntries(messages).flatMap((entry) =>
        mission &&
        entry.kind === "message" &&
        entry.message.id === firstSourceId
            ? [entry, { kind: "mission" as const, id: mission.id }]
            : [entry],
    );
    const {
        messages: _messages,
        turns: _turns,
        sourcePreparationTurnId: _source,
        framingMessageCount: _boundary,
        ...framing
    } = data;
    return validateConversation({
        ...framing,
        version: 5,
        agents: previewAgents,
        history,
        turns: [
            ...oldTurns
                .filter((turn) => turn.id !== oldSource?.id)
                .map((turn) => ({ ...turn, agentId: "workbench" })),
            ...(oldSource
                ? oldSource.entries.flatMap((entry) =>
                      entry.kind === "message"
                          ? [
                                {
                                    id: `${oldSource.id}-${entry.id}`,
                                    agentId: "workbench",
                                    state: "completed" as const,
                                    entries: [
                                        { ...entry, phase: "answer" as const },
                                    ],
                                },
                            ]
                          : [],
                  )
                : []),
        ],
        missions: mission ? [mission] : [],
        pendingReports: [],
        sourcePreparationMissionId: mission?.id,
    });
}
function restoreConversation(screen: PreviewScreen): {
    state: PreviewConversation;
    saveAllowed: boolean;
    error?: string;
} {
    try {
        const current = sessionStorage.getItem(previewKey);
        const old =
            current === null
                ? previousKeys
                      .map((key) => sessionStorage.getItem(key))
                      .find((value) => value !== null)
                : undefined;
        const stored = current ?? old;
        if (stored === undefined || stored === null)
            return { state: sceneState(screen), saveAllowed: true };
        const data: unknown = JSON.parse(stored);
        let restored =
            current !== null
                ? validateConversation(data)
                : migrateConversation(data);
        restored = applyPreviewPatch(restored, {
            ...interruptTurn(restored),
            queuePaused: getMessages(restored).some(
                (message) => message.delivery === "queued",
            ),
        });
        restored = applyPreviewPatch(restored, {
            messages: getMessages(restored).map((message) =>
                message.status === "running"
                    ? { ...message, status: "interrupted" }
                    : message,
            ),
        });
        restored = flushReports({
            ...restored,
            missions: restored.missions.map((mission) =>
                mission.state !== "running"
                    ? mission
                    : {
                          ...mission,
                          state: "interrupted",
                          finishedAt: new Date().toISOString(),
                          operations: mission.operations.map((operation) =>
                              operation.state !== "running"
                                  ? operation
                                  : { ...operation, state: "interrupted" },
                          ),
                      },
            ),
        });
        if (
            !restored.launched &&
            (screen === "launched" || screen === "handoff")
        )
            restored = startResearch(restored);
        return { state: validateConversation(restored), saveAllowed: true };
    } catch {
        return {
            state: sceneState(screen),
            saveAllowed: false,
            error: "Saved preview could not be restored. Its saved data was preserved. Reset the preview to start again.",
        };
    }
}

type ResponseScript = { text: string; work: boolean; steps: number };
function advanceResponse(
    current: PreviewConversation,
    turnId: string,
    step: number,
    script: ResponseScript,
): PreviewConversation {
    const turn = current.turns.find((entry) => entry.id === turnId);
    if (turn?.state !== "running") return current;
    const entries = [...turn.entries];
    if (script.work && step === 1) {
        const first = entries.findIndex((entry) => entry.kind === "operation");
        const operation = entries[first];
        if (operation?.kind === "operation")
            entries[first] = {
                ...operation,
                operation: { ...operation.operation, state: "completed" },
            };
        entries.push({
            kind: "operation",
            operation: {
                id: `${turn.id}-compare`,
                title: "Compare switching dependencies",
                state: "running",
                summary:
                    "Checking what is contractual and what is operational.",
                details:
                    "Illustrative comparison of integrations and participation; no switching-cost conclusion is established.",
            },
        });
    }
    const instructions = getMessages(current).filter(
        (message) =>
            message.delivery === "steered" &&
            message.deliveryTurnId === turn.id,
    );
    const answerId = `${turn.id}-answer${instructions.length ? `-steer-${instructions.length}` : ""}`;
    if (
        (!script.work || step >= 2) &&
        !entries.some(
            (entry) => entry.kind === "message" && entry.id === answerId,
        )
    )
        entries.push({ kind: "message", id: answerId, phase: "answer" });
    const done = step >= script.steps;
    const latestInstruction = instructions.at(-1);
    const responseText = latestInstruction
        ? `**Steering instruction received:** ${latestInstruction.text}\n\nIllustrative instruction recorded in this turn. Earlier work is retained; no live interpretation was executed.`
        : script.text;
    const text = responseText.slice(
        0,
        Math.ceil(
            (responseText.length * Math.max(0, step - (script.work ? 1 : 0))) /
                (script.steps - (script.work ? 1 : 0)),
        ),
    );
    return flushReports(
        applyPreviewPatch(current, {
            messages:
                !script.work || step >= 2
                    ? [
                          {
                              id: answerId,
                              agentId: turn.agentId,
                              from: "assistant",
                              text,
                              createdAt:
                                  getMessages(current).find(
                                      (message) => message.id === answerId,
                                  )?.createdAt ?? new Date().toISOString(),
                              status: done ? undefined : "running",
                          },
                      ]
                    : [],
            turns: current.turns.map((entry) =>
                entry.id !== turn.id
                    ? entry
                    : {
                          ...turn,
                          state: done ? "completed" : "running",
                          finishedAt: done
                              ? new Date().toISOString()
                              : undefined,
                          entries: done
                              ? entries.map((entry) =>
                                    entry.kind === "operation"
                                        ? {
                                              ...entry,
                                              operation: {
                                                  ...entry.operation,
                                                  state: "completed",
                                              },
                                          }
                                        : entry,
                                )
                              : entries,
                      },
            ),
        }),
    );
}

/** Owns one illustrative conversation, its runtime, persistence and deterministic preview commands. */
export function useStartConversationPreview(
    screen: PreviewScreen,
    onStatus: (message: string) => void = report,
) {
    const [restoration] = useState(() => restoreConversation(screen));
    const [state, setState] = useState(restoration.state);
    const [saveAllowed, setSaveAllowed] = useState(restoration.saveAllowed);
    const update = (patch: PreviewPatch) =>
        setState((current) => applyPreviewPatch(current, patch));
    useEffect(() => {
        if ((screen === "launched" || screen === "handoff") && !state.launched)
            setState(startResearch);
    }, [screen, state.launched]);
    const [example, setExample] = useState<string | null>(null);
    const [failNext, setFailNext] = useState(false);
    const { needsContext, scope, suppliedContext } = state;
    const questionAction = state.questionAction ?? null;
    const setQuestionAction = (value: PreviewConversation["questionAction"]) =>
        update({ questionAction: value });
    const setSelectedQuestionId = (value: string) =>
        update({ selectedQuestionId: value });
    const activeTurn = state.turns.find((turn) => turn.state === "running");
    const canAskDuringPreparation =
        sourcePreparation(state).state === "running" && !responseRunning(state);
    const activeTurnId = activeTurn?.id;
    const reply =
        activeTurn &&
        !activeTurn.entries.some((entry) => entry.kind === "operation")
            ? { id: activeTurn.id }
            : null;
    const script = useRef<ResponseScript>({
        text: illustrativeAnswer,
        work: true,
        steps: 10,
    });
    const beginResponse = useCallback(
        (nextScript: ResponseScript, priorMessages: PreviewMessage[] = []) => {
            const id = crypto.randomUUID();
            const message = createPreviewMessage({
                from: "assistant",
                text: nextScript.work
                    ? "I'll compare the retained material on integrations and coordination."
                    : nextScript.text.slice(0, 28),
                status: nextScript.work ? undefined : "running",
            });
            const answerId = `${id}-answer`;
            const recordedMessage = nextScript.work
                ? message
                : { ...message, id: answerId };
            setState((current) => {
                if (responseRunning(current)) return current;
                script.current = nextScript;
                return applyPreviewPatch(
                    {
                        ...current,
                        history: current.history.filter(
                            (entry) =>
                                entry.kind !== "message" ||
                                !priorMessages.some(
                                    (message) =>
                                        message.id === entry.message.id,
                                ),
                        ),
                    },
                    {
                        messages: [...priorMessages, recordedMessage],
                        draft: priorMessages.some(
                            (message) => message.delivery === "processed",
                        )
                            ? current.draft
                            : "",
                        turns: [
                            ...current.turns,
                            {
                                id,
                                agentId: "workbench",
                                state: "running",
                                startedAt: message.createdAt,
                                entries: [
                                    {
                                        kind: "message",
                                        id: recordedMessage.id,
                                        phase: nextScript.work
                                            ? "commentary"
                                            : "answer",
                                    },
                                    ...(nextScript.work
                                        ? [
                                              {
                                                  kind: "operation" as const,
                                                  operation: {
                                                      id: `${id}-read`,
                                                      title: "Read the retained investor presentation",
                                                      state: "running" as const,
                                                      summary:
                                                          "Illustrative reading: coordination and network participation.",
                                                      details:
                                                          "Illustrative investor presentation input; this preview does not retrieve or verify a document.",
                                                  },
                                              },
                                          ]
                                        : []),
                                ],
                            },
                        ],
                    },
                );
            });
        },
        [],
    );
    const advanceTurn = useRef<(() => void) | null>(null);
    useEffect(() => {
        if (!activeTurnId) return;
        let step = 0;
        const advance = () => {
            const next = ++step;
            setState((current) =>
                advanceResponse(current, activeTurnId, next, script.current),
            );
        };
        advanceTurn.current = advance;
        const timer = window.setInterval(
            advance,
            script.current.work ? 800 : 200,
        );
        return () => {
            window.clearInterval(timer);
            advanceTurn.current = null;
        };
    }, [activeTurnId]);
    function finishIllustrativeTurn() {
        if (activeTurnId)
            setState((current) =>
                advanceResponse(
                    current,
                    activeTurnId,
                    script.current.steps,
                    script.current,
                ),
            );
    }

    const setScope = (scope: string) => update({ scope });
    const setQuestions = (proposed: StartFramingQuestion[]) => {
        const supplied = [...initialQuestions, ...networkQuestions];
        // Older gallery drafts have no authorship marker; retain wording absent from either supplied program.
        const preserved = state.questions.filter(
            (q) =>
                state.analystQuestionIds?.includes(q.id) ||
                !supplied.some(
                    (initial) => initial.id === q.id && initial.text === q.text,
                ),
        );
        update({
            questions: [
                ...proposed.map(
                    (q) => preserved.find((edited) => edited.id === q.id) ?? q,
                ),
                ...preserved.filter(
                    (q) => !proposed.some((next) => next.id === q.id),
                ),
            ],
        });
    };
    const setSuppliedContext = (
        suppliedContext: PreviewConversation["suppliedContext"],
    ) => update({ suppliedContext });
    const setRefinement = (draft: string) => update({ draft });
    const proposedScopeValue =
        activityClarification.choices.find(
            (choice) => choice.label === suppliedContext?.answer,
        )?.value ??
        suppliedContext?.answer ??
        "claims";
    const contextChoice =
        state.contextChoice ??
        (activityClarification.choices.some(
            (choice) => choice.value === proposedScopeValue,
        )
            ? proposedScopeValue
            : "");
    const scopeAnswer = state.contextDraft?.trim() || contextChoice;
    const queued = getMessages(state).filter(
        (message) => message.delivery === "queued",
    );
    const queue: Omit<ExternalThreadQueueAdapter, "enqueue" | "steer"> = {
        items: queued.map((message) => ({
            id: message.id,
            prompt: message.text,
            parts: [{ type: "text", text: message.text }],
        })),
        steerItems: [],
        remove: (id) =>
            setState((current) =>
                applyPreviewPatch(current, {
                    messages: getMessages(current)
                        .filter(
                            (message) =>
                                message.id === id &&
                                message.delivery === "queued",
                        )
                        .map((message) => ({
                            ...message,
                            delivery: "removed",
                        })),
                }),
            ),
        edit: (id, message) =>
            setState((current) =>
                applyPreviewPatch(current, {
                    messages: getMessages(current)
                        .filter(
                            (item) =>
                                item.id === id && item.delivery === "queued",
                        )
                        .map((item) => ({
                            ...item,
                            text: message.content
                                .flatMap((part) =>
                                    part.type === "text" ? [part.text] : [],
                                )
                                .join("\n"),
                        })),
                }),
            ),
        move: (id, placement) => {
            if (placement.lane !== "steer") return;
            setState((current) => {
                const message = getMessages(current).find(
                    (item) => item.id === id && item.delivery === "queued",
                );
                return message
                    ? acceptDelivery(current, message, "steer")
                    : current;
            });
        },
    };
    const nextQueuedId = queued[0]?.id;
    useEffect(() => {
        if (activeTurnId || state.queuePaused || !nextQueuedId) return;
        const message = getMessages(state).find(
            (item) => item.id === nextQueuedId,
        );
        if (!message) return;
        beginResponse(
            {
                text: `Illustrative follow-up received: ${message.text}\n\nFreeform interpretation is not connected in this preview.`,
                work: false,
                steps: 12,
            },
            [{ ...message, delivery: "processed" }],
        );
    }, [activeTurnId, nextQueuedId, state, beginResponse]);
    const conversation = useWorkbenchConversation({
        messages: previewMessages(getMessages(state)),
        queue,
        onStop: stopResponse,
        draft:
            !state.launched && needsContext
                ? (state.contextDraft ?? "")
                : ((!state.launched ? questionAction?.text : undefined) ??
                  state.draft),
        isRunning: responseRunning(state),
        onDraftChange: (text) =>
            !state.launched && needsContext
                ? update({ contextDraft: text })
                : !state.launched && questionAction
                  ? setQuestionAction({ ...questionAction, text })
                  : setRefinement(text),
        onSend: send,
    });
    async function send(text: string, delivery: "queue" | "steer" = "queue") {
        if (failNext) {
            setFailNext(false);
            throw new Error("fixture_delivery_failure");
        }
        if (
            !needsContext &&
            !questionAction &&
            (responseRunning(state) ||
                getMessages(state).some(
                    (message) => message.delivery === "queued",
                ))
        ) {
            const message = createPreviewMessage({ from: "user", text });
            setState((current) => acceptDelivery(current, message, delivery));
            return;
        }
        if (state.launched) {
            const user = createPreviewMessage({ from: "user", text });
            if (
                canAskDuringPreparation &&
                example === preparationQuestionExample.id &&
                text === preparationQuestionExample.text
            ) {
                beginResponse(
                    { text: preparationAnswer, work: false, steps: 24 },
                    [user],
                );
                setExample(null);
            } else {
                update({ messages: [user], draft: "" });
                onStatus(
                    "Request recorded in this preview; freeform interpretation is not connected.",
                );
            }
            return;
        }
        if (needsContext) {
            applyContext(text);
            return;
        }
        if (questionAction) {
            const id = questionAction.id ?? crypto.randomUUID();
            update({
                analystQuestionIds: [
                    ...new Set([...(state.analystQuestionIds ?? []), id]),
                ],
                messages: [
                    ...getMessages(state),
                    createPreviewMessage({
                        from: "user",
                        text: `${questionAction.id ? "Updated" : "Added"} research question: ${text}`,
                    }),
                ],
                questions: questionAction.id
                    ? state.questions.map((q) =>
                          q.id === id ? { ...q, text } : q,
                      )
                    : [
                          ...state.questions,
                          { id, label: `Q${state.questions.length + 1}`, text },
                      ],
            });
            setSelectedQuestionId(id);
            setQuestionAction(null);
            return;
        }

        const chosen = guidedExamples.find(
            (item) => item.id === example && item.text === text,
        );
        const messages: PreviewMessage[] = [
            ...getMessages(state),
            createPreviewMessage({ text }),
        ];
        const patch: PreviewPatch = { messages, draft: "" };
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
            patch.analystQuestionIds = [
                ...new Set([...(state.analystQuestionIds ?? []), revised.id]),
            ];
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
            patch.analystQuestionIds = [
                ...new Set([...(state.analystQuestionIds ?? []), added.id]),
            ];
            result = `Added to the research program: ${added.text}`;
        }
        if (result)
            messages.push(
                createPreviewMessage({
                    from: "assistant",
                    text: result,
                }),
            );
        update(patch);
        setExample(null);
        onStatus(
            chosen
                ? "Illustrative framing updated"
                : "Request recorded in this preview; freeform interpretation is not connected.",
        );
    }
    function completeContext(text: string) {
        update({
            needsContext: false,
            contextDraft: "",
            contextChoice: undefined,
            messages: [
                ...getMessages(state),
                createPreviewMessage({ text, from: "user" }),
                createPreviewMessage({
                    text: "The framing is ready to review.",
                    from: "assistant",
                }),
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
        setScope(option?.scope ?? answer);
        if (answer === "claims") {
            setQuestions(initialQuestions);
        } else if (answer === "network") {
            setQuestions(networkQuestions);
        } else {
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
    function selectScenario(scenario: "specific" | "company") {
        setSaveAllowed(true);
        setExample(null);
        setState(sceneState(screen, scenario));
        onStatus("Illustrative preview reset");
    }

    function requestScopeChange() {
        if (state.launched) return;
        update({
            needsContext: true,
            contextChoice: undefined,
            contextDraft:
                scope === claimsScope || scope === networkScope
                    ? ""
                    : (suppliedContext?.answer ?? scope),
        });
    }

    function workThenReply() {
        beginResponse({ text: illustrativeAnswer, work: true, steps: 10 });
    }
    function growReply() {
        beginResponse({ text: illustrativeLongAnswer, work: false, steps: 24 });
    }
    function stopResponse() {
        if (!activeTurnId) return;
        setState((current) =>
            flushReports(
                applyPreviewPatch(current, {
                    ...interruptTurn(current),
                    queuePaused: true,
                }),
            ),
        );
    }
    const interruptReply = stopResponse;
    useEffect(() => {
        if (restoration.error) onStatus(restoration.error);
    }, [restoration.error, onStatus]);
    useEffect(() => {
        if (!saveAllowed) return;
        try {
            sessionStorage.setItem(previewKey, JSON.stringify(state));
            for (const key of previousKeys) sessionStorage.removeItem(key);
        } catch {
            onStatus(
                "Preview continuity is unavailable in this browser. Your current conversation remains open.",
            );
        }
    }, [state, saveAllowed, onStatus]);
    return {
        state,
        messages: getMessages(state),
        historyEntries: state.history
            .filter(
                (entry) =>
                    entry.kind !== "message" ||
                    (entry.message.delivery !== "queued" &&
                        entry.message.delivery !== "removed"),
            )
            .map((entry) => ({
                kind: entry.kind,
                id: entry.kind === "message" ? entry.message.id : entry.id,
            })),
        update,
        conversation,
        resumeQueue:
            state.queuePaused && queued.length
                ? () => update({ queuePaused: false })
                : undefined,
        canAskDuringPreparation,
        setExample,
        setFailNext,
        setQuestionAction,
        setRefinement,
        selectScenario,
        requestScopeChange,
        scopeAnswer,
        contextChoice,
        proposedScopeValue,
        reply,
        activeTurn,
        workThenReply,
        growReply,
        interruptReply,
        stopResponse,
        finishIllustrativeTurn,
        advanceIllustrativeTurn: () => advanceTurn.current?.(),
        startResearch: () => setState(startResearch),
        advancePreparation: () => setState(advancePreparation),
        finishPreparation: () =>
            setState((current) => endPreparation(current, "completed")),
        interruptPreparation: () =>
            setState((current) => endPreparation(current, "interrupted")),
        controlPreparation: async (command: ResearchControlCommand) => {
            const { mission } = sourcePreparation(state);
            if (
                !mission ||
                (command === "/pause"
                    ? mission.state !== "running"
                    : mission.state !== "interrupted")
            )
                throw new Error(
                    "Illustrative command is not available in this state",
                );
            setState((current) =>
                command === "/pause"
                    ? endPreparation(current, "interrupted")
                    : {
                          ...current,
                          missions: current.missions.map((entry) =>
                              entry.id !== mission.id
                                  ? entry
                                  : {
                                        ...entry,
                                        state: "running",
                                        finishedAt: undefined,
                                        operations: entry.operations.map(
                                            (operation) =>
                                                operation.state !==
                                                "interrupted"
                                                    ? operation
                                                    : {
                                                          ...operation,
                                                          state: "running",
                                                          summary:
                                                              "Illustrative work resumed; recorded inputs are retained.",
                                                      },
                                        ),
                                    },
                          ),
                      },
            );
        },
        restartPreparation: () =>
            setState((current) =>
                sourcePreparation(current).state === "running"
                    ? current
                    : startResearch({ ...current, launched: false }),
            ),
    };
}
export type StartConversationPreview = ReturnType<
    typeof useStartConversationPreview
>;
