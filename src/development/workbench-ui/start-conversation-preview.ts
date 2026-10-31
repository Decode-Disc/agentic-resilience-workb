import type { ThreadMessageLike } from "@assistant-ui/react";
import { useEffect, useRef, useState } from "react";
import type { ConversationTurnSnapshot } from "@/components/chat/conversation-turn";
import { useWorkbenchConversation } from "@/components/chat/workbench-conversation";
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
/** The gallery's recorded conversation and framing, persisted as a single preview. */
export type PreviewConversation = {
    turns?: ConversationTurnSnapshot[];
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
    messages: {
        id: string;
        createdAt?: string;
        text: string;
        from?: "user" | "assistant";
        status?: "running" | "interrupted";
    }[];
    launched: boolean;
    version?: 4;
    sourcePreparationTurnId?: string;
};
export const previewKey = "start-conversation-preview-v4";
const legacyPreviewKey = "start-conversation-preview-v3";
function freshConversation(
    scenario: PreviewConversation["scenario"] = "specific",
): PreviewConversation {
    const startedAt = new Date().toISOString();
    return {
        startedAt,
        scenario,
        needsContext: scenario === "company",
        contextChoice: undefined,
        scope: claimsScope,
        questions: [...initialQuestions],
        analystQuestionIds: [],
        draft: "",
        messages: [
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
                text: "I can help frame this research before it starts.",
                createdAt: startedAt,
            },
        ],
        launched: false,
        version: 4,
    };
}
function createPreviewMessage(
    message: Omit<PreviewConversation["messages"][number], "id" | "createdAt">,
): PreviewConversation["messages"][number] {
    return {
        ...message,
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
function interruptTurn(
    state: PreviewConversation,
): Partial<PreviewConversation> {
    return {
        turns: state.turns?.map((t) =>
            t.state === "running"
                ? {
                      ...t,
                      state: "interrupted",
                      finishedAt: new Date().toISOString(),
                      entries: t.entries.map((e) =>
                          e.kind === "operation" &&
                          e.operation.state === "running"
                              ? {
                                    ...e,
                                    operation: {
                                        ...e.operation,
                                        state: "interrupted",
                                    },
                                }
                              : e,
                      ),
                  }
                : t,
        ),
        messages: state.messages.map((m) =>
            m.status === "running" ? { ...m, status: "interrupted" } : m,
        ),
    };
}
function validPreviewTime(value: unknown) {
    return (
        value === undefined ||
        (typeof value === "string" && Number.isFinite(Date.parse(value)))
    );
}
function validStoredTurn(value: unknown): value is ConversationTurnSnapshot {
    if (!value || typeof value !== "object") return false;
    const t = value as Record<string, unknown>;
    return (
        typeof t.id === "string" &&
        ["running", "completed", "interrupted"].includes(String(t.state)) &&
        validPreviewTime(t.startedAt) &&
        validPreviewTime(t.finishedAt) &&
        Array.isArray(t.entries) &&
        t.entries.every((entry: unknown) => {
            if (!entry || typeof entry !== "object") return false;
            const e = entry as Record<string, unknown>;
            if (e.kind === "message")
                return (
                    typeof e.id === "string" &&
                    (e.phase === "commentary" || e.phase === "answer")
                );
            if (
                e.kind !== "operation" ||
                !e.operation ||
                typeof e.operation !== "object"
            )
                return false;
            const op = e.operation as Record<string, unknown>;
            return (
                typeof op.id === "string" &&
                typeof op.title === "string" &&
                typeof op.summary === "string" &&
                (op.details === undefined || typeof op.details === "string") &&
                ["running", "completed", "interrupted"].includes(
                    String(op.state),
                )
            );
        })
    );
}
function validSavedConversation(data: unknown): data is PreviewConversation {
    return Boolean(
        typeof data === "object" &&
            data !== null &&
            (!("selectedQuestionId" in data) ||
                data.selectedQuestionId === undefined ||
                typeof data.selectedQuestionId === "string") &&
            (!("contextDraft" in data) ||
                data.contextDraft === undefined ||
                typeof data.contextDraft === "string") &&
            (!("suppliedContext" in data) ||
                data.suppliedContext === undefined ||
                (typeof data.suppliedContext === "object" &&
                    data.suppliedContext !== null &&
                    "question" in data.suppliedContext &&
                    typeof data.suppliedContext.question === "string" &&
                    "answer" in data.suppliedContext &&
                    typeof data.suppliedContext.answer === "string")) &&
            (!("startedAt" in data) || validPreviewTime(data.startedAt)) &&
            (!("turns" in data) ||
                (Array.isArray(data.turns) &&
                    data.turns.every(validStoredTurn))) &&
            (!("questionAction" in data) ||
                data.questionAction === null ||
                (typeof data.questionAction === "object" &&
                    data.questionAction !== null &&
                    "text" in data.questionAction &&
                    typeof data.questionAction.text === "string" &&
                    (!("id" in data.questionAction) ||
                        data.questionAction.id === undefined ||
                        typeof data.questionAction.id === "string"))) &&
            (!("analystQuestionIds" in data) ||
                (Array.isArray(data.analystQuestionIds) &&
                    data.analystQuestionIds.every(
                        (id: unknown) => typeof id === "string",
                    ))) &&
            (!("contextChoice" in data) ||
                data.contextChoice === undefined ||
                (typeof data.contextChoice === "string" &&
                    activityClarification.choices.some(
                        (choice) => choice.value === data.contextChoice,
                    ))) &&
            "questions" in data &&
            Array.isArray(data.questions) &&
            data.questions.every(
                (q) =>
                    q !== null &&
                    typeof q === "object" &&
                    typeof q.id === "string" &&
                    typeof q.text === "string" &&
                    typeof q.label === "string" &&
                    (q.rationale === undefined ||
                        typeof q.rationale === "string") &&
                    (q.shortLabel === undefined ||
                        typeof q.shortLabel === "string"),
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
                    (m.status === undefined ||
                        m.status === "running" ||
                        m.status === "interrupted") &&
                    validPreviewTime(m.createdAt) &&
                    (m.from === undefined ||
                        m.from === "user" ||
                        m.from === "assistant"),
            ) &&
            "scenario" in data &&
            (data.scenario === "specific" || data.scenario === "company") &&
            "needsContext" in data &&
            typeof data.needsContext === "boolean" &&
            "launched" in data &&
            typeof data.launched === "boolean",
    );
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
function previewMessages(
    messages: PreviewConversation["messages"],
): ThreadMessageLike[] {
    return messages.map((message) => ({
        id: message.id,
        role: message.from ?? "user",
        content: message.text,
        createdAt: message.createdAt ? new Date(message.createdAt) : undefined,
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
    "Research started. I’ll keep you updated as the material is prepared.";
const preparationReply =
    "The illustrative candidate list is ready. Document contents still need to be retrieved and checked.";

/** Projects the recorded preparation turn for chat context and documentary progress. */
export function sourcePreparation(state: PreviewConversation) {
    const turn = state.turns?.find(
        (entry) => entry.id === state.sourcePreparationTurnId,
    );
    const activities =
        turn?.entries.flatMap((entry) =>
            entry.kind === "operation" ? [entry.operation] : [],
        ) ?? [];
    const integration = activities.find((entry) =>
        entry.id.endsWith("-integration"),
    );
    return {
        turn,
        activities,
        state: turn?.state ?? "not-started",
        step: turn?.state === "completed" ? 2 : integration ? 1 : 0,
    };
}

function startResearch(state: PreviewConversation): PreviewConversation {
    if (
        state.launched ||
        state.needsContext ||
        state.questionAction ||
        state.questions.length === 0
    )
        return state;
    const id = crypto.randomUUID();
    const message = createPreviewMessage({
        from: "assistant",
        text: launchText,
    });
    return {
        ...state,
        launched: true,
        sourcePreparationTurnId: id,
        messages: [...state.messages, message],
        turns: [
            ...(state.turns ?? []),
            {
                id,
                state: "running",
                startedAt: message.createdAt,
                entries: [
                    { kind: "message", id: message.id, phase: "commentary" },
                    ...(state.scenario === "specific"
                        ? [
                              {
                                  kind: "operation" as const,
                                  operation: {
                                      id: `${id}-reference`,
                                      title: "Check supplied reference",
                                      state: "completed" as const,
                                      summary:
                                          "Investor presentation recorded as an input; contents not retrieved.",
                                      details:
                                          "Illustrative reference check. The supplied document has not been read by this preview.",
                                  },
                              },
                          ]
                        : []),
                    {
                        kind: "operation",
                        operation: {
                            id: `${id}-reporting`,
                            title: "Find company reporting",
                            state: "running",
                            summary:
                                "Looking for filings and earnings material about claims coordination.",
                            details:
                                "Illustrative activity — these documents have not been retrieved by this preview.",
                        },
                    },
                ],
            },
        ],
    };
}

function advancePreparation(state: PreviewConversation): PreviewConversation {
    const { turn, step } = sourcePreparation(state);
    if (turn?.state !== "running" || step > 0) return state;
    return {
        ...state,
        turns: state.turns?.map((entry) =>
            entry.id !== turn.id
                ? entry
                : {
                      ...entry,
                      entries: [
                          ...entry.entries.map((item) =>
                              item.kind === "operation" &&
                              item.operation.id.endsWith("-reporting")
                                  ? {
                                        ...item,
                                        operation: {
                                            ...item.operation,
                                            state: "completed" as const,
                                            summary:
                                                "Filing and earnings candidates listed; contents remain unverified.",
                                        },
                                    }
                                  : item,
                          ),
                          {
                              kind: "operation" as const,
                              operation: {
                                  id: `${turn.id}-integration`,
                                  title: "Find product and integration documentation",
                                  state: "running" as const,
                                  summary:
                                      "Looking for insurer integration and workflow documentation.",
                                  details:
                                      "Illustrative candidate search, not a verified reading or analytical finding.",
                              },
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
    const { turn } = sourcePreparation(state);
    if (turn?.state !== "running") return state;
    const message = createPreviewMessage({
        from: "assistant",
        text:
            outcome === "completed"
                ? preparationReply
                : "The illustrative preparation stopped. Recorded inputs and any listed candidates remain available.",
    });
    return {
        ...state,
        messages: [...state.messages, message],
        turns: state.turns?.map((entry) =>
            entry.id !== turn.id
                ? entry
                : {
                      ...entry,
                      state: outcome,
                      finishedAt: message.createdAt,
                      entries: [
                          ...entry.entries.map((item) =>
                              item.kind === "operation" &&
                              item.operation.state === "running"
                                  ? {
                                        ...item,
                                        operation: {
                                            ...item.operation,
                                            state: outcome,
                                            summary:
                                                outcome === "completed"
                                                    ? "Candidates listed; contents remain unverified."
                                                    : "Work stopped; recorded inputs remain available.",
                                        },
                                    }
                                  : item,
                          ),
                          {
                              kind: "message" as const,
                              id: message.id,
                              phase: "answer" as const,
                          },
                      ],
                  },
        ),
    };
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

function restoreConversation(screen: PreviewScreen): {
    state: PreviewConversation;
    saveAllowed: boolean;
    error?: string;
} {
    try {
        const current = sessionStorage.getItem(previewKey);
        const legacy =
            current === null ? sessionStorage.getItem(legacyPreviewKey) : null;
        const stored = current ?? legacy;
        if (stored === null)
            return { state: sceneState(screen), saveAllowed: true };
        const data: unknown = JSON.parse(stored);
        if (!validSavedConversation(data))
            throw new Error("Invalid saved preview");
        const ids = new Set(data.messages.map((message) => message.id));
        const referenced = new Set<string>();
        const operationIds = new Set<string>();
        if (
            ids.size !== data.messages.length ||
            new Set(data.turns?.map((turn) => turn.id)).size !==
                (data.turns?.length ?? 0)
        )
            throw new Error("Duplicate preview identity");
        for (const turn of data.turns ?? [])
            for (const entry of turn.entries) {
                if (entry.kind === "message") {
                    if (!ids.has(entry.id) || referenced.has(entry.id))
                        throw new Error("Invalid preview message reference");
                    referenced.add(entry.id);
                } else {
                    if (operationIds.has(entry.operation.id))
                        throw new Error("Duplicate preview operation");
                    operationIds.add(entry.operation.id);
                }
            }
        if (
            (current !== null && data.version !== 4) ||
            (data.version !== undefined && data.version !== 4)
        )
            throw new Error("Unsupported saved preview");
        if (
            (current !== null &&
                data.launched &&
                data.sourcePreparationTurnId === undefined) ||
            (data.sourcePreparationTurnId !== undefined &&
                (typeof data.sourcePreparationTurnId !== "string" ||
                    !data.turns?.some(
                        (turn) => turn.id === data.sourcePreparationTurnId,
                    )))
        )
            throw new Error("Missing preparation turn");
        const seed = freshConversation(data.scenario).messages.map(
            (message) => ({ ...message, createdAt: data.startedAt }),
        );
        let restored: PreviewConversation = {
            ...data,
            version: 4,
            messages: [
                ...seed.filter((message) => !ids.has(message.id)),
                ...data.messages,
            ],
        };
        if (legacy !== null && data.launched && !data.sourcePreparationTurnId) {
            // The old screen never retained its preparation state. Recover the fact of launch without claiming success.
            const oldAcknowledgement = restored.messages.find(
                (message) =>
                    message.from === "assistant" &&
                    message.text.startsWith("Research started."),
            );
            const acknowledgement: PreviewConversation["messages"][number] =
                oldAcknowledgement ?? {
                    id: "legacy-research-start",
                    from: "assistant" as const,
                    text: launchText,
                };
            const boundary =
                (data as PreviewConversation & { framingMessageCount?: number })
                    .framingMessageCount ?? data.messages.length;
            const messages = oldAcknowledgement
                ? restored.messages
                : [
                      ...restored.messages.slice(
                          0,
                          boundary +
                              seed.filter((message) => !ids.has(message.id))
                                  .length,
                      ),
                      acknowledgement,
                      ...restored.messages.slice(
                          boundary +
                              seed.filter((message) => !ids.has(message.id))
                                  .length,
                      ),
                  ];
            restored = {
                ...restored,
                messages,
                sourcePreparationTurnId: "legacy-source-preparation",
                turns: [
                    ...(restored.turns ?? []),
                    {
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
                    },
                ],
            };
        }
        delete (
            restored as PreviewConversation & { framingMessageCount?: number }
        ).framingMessageCount;
        restored = { ...restored, ...interruptTurn(restored) };
        if (
            !restored.launched &&
            (screen === "launched" || screen === "handoff")
        )
            restored = startResearch(restored);
        return { state: restored, saveAllowed: true };
    } catch {
        return {
            state: sceneState(screen),
            saveAllowed: false,
            error: "Saved preview could not be restored. Its saved data was preserved. Reset the preview to start again.",
        };
    }
}

function advanceResponse(
    current: PreviewConversation,
    activeTurnId: string,
    next: number,
): PreviewConversation {
    const turn = current.turns?.find((t) => t.id === activeTurnId);
    if (turn?.state !== "running") return current;
    const entries = turn.entries.map((e) =>
        e.kind === "operation" ? { ...e, operation: { ...e.operation } } : e,
    );
    if (next === 1) {
        const first = entries.find((e) => e.kind === "operation");
        if (first?.kind === "operation")
            first.operation = {
                ...first.operation,
                state: "completed",
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
    const answerId = `${turn.id}-answer`;
    if (next === 2)
        entries.push({
            kind: "message",
            id: answerId,
            phase: "answer",
        });
    const done = next >= 10;
    const text = illustrativeAnswer.slice(
        0,
        Math.ceil((illustrativeAnswer.length * Math.max(0, next - 1)) / 9),
    );
    const messages =
        next < 2
            ? current.messages
            : [
                  ...current.messages.filter((m) => m.id !== answerId),
                  {
                      id: answerId,
                      createdAt:
                          current.messages.find((m) => m.id === answerId)
                              ?.createdAt ?? new Date().toISOString(),
                      from: "assistant" as const,
                      text,
                      status: done ? undefined : ("running" as const),
                  },
              ];
    return {
        ...current,
        messages,
        turns: current.turns?.map((t) =>
            t.id !== turn.id
                ? t
                : {
                      ...turn,
                      entries: entries.map((e) =>
                          done && e.kind === "operation"
                              ? {
                                    ...e,
                                    operation: {
                                        ...e.operation,
                                        state: "completed",
                                    },
                                }
                              : e,
                      ),
                      state: done ? "completed" : "running",
                      finishedAt: done ? new Date().toISOString() : undefined,
                  },
        ),
    };
}

function finishResponse(
    current: PreviewConversation,
    activeTurnId: string,
): PreviewConversation {
    const turn = current.turns?.find((t) => t.id === activeTurnId);
    if (turn?.state !== "running") return current;
    const answerId = `${turn.id}-answer`;
    const entries = turn.entries.filter(
        (e) => e.kind !== "message" || e.phase !== "answer",
    );
    entries.push({ kind: "message", id: answerId, phase: "answer" });
    return {
        ...current,
        messages: [
            ...current.messages.filter((m) => m.id !== answerId),
            {
                id: answerId,
                from: "assistant",
                text: illustrativeAnswer,
                createdAt:
                    current.messages.find((m) => m.id === answerId)
                        ?.createdAt ?? new Date().toISOString(),
            },
        ],
        turns: current.turns?.map((t) =>
            t.id !== turn.id
                ? t
                : {
                      ...t,
                      state: "completed",
                      finishedAt: new Date().toISOString(),
                      entries: entries.map((e) =>
                          e.kind === "operation"
                              ? {
                                    ...e,
                                    operation: {
                                        ...e.operation,
                                        state: "completed",
                                    },
                                }
                              : e,
                      ),
                  },
        ),
    };
}

/** Owns one illustrative conversation, its runtime, persistence and deterministic preview commands. */
export function useStartConversationPreview(
    screen: PreviewScreen,
    onStatus: (message: string) => void = report,
) {
    const [restoration] = useState(() => restoreConversation(screen));
    const [state, setState] = useState(restoration.state);
    const [saveAllowed, setSaveAllowed] = useState(restoration.saveAllowed);
    const update = (patch: Partial<PreviewConversation>) =>
        setState((current) => ({ ...current, ...patch }));
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
                              text: illustrativeLongAnswer.slice(
                                  0,
                                  Math.ceil(
                                      (illustrativeLongAnswer.length *
                                          (reply.step + 1)) /
                                          24,
                                  ),
                              ),
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
    const activeTurn = state.turns?.find(
        (t) => t.state === "running" && t.id !== state.sourcePreparationTurnId,
    );
    const activeTurnId = activeTurn?.id;
    const advanceTurn = useRef<(() => void) | null>(null);
    useEffect(() => {
        if (!activeTurnId) return;
        let step = 0;
        const advance = () => {
            const next = ++step;
            setState((current) => advanceResponse(current, activeTurnId, next));
        };
        advanceTurn.current = advance;
        const timer = window.setInterval(advance, 800);
        return () => {
            window.clearInterval(timer);
            advanceTurn.current = null;
        };
    }, [activeTurnId]);
    function finishIllustrativeTurn() {
        if (activeTurnId)
            setState((current) => finishResponse(current, activeTurnId));
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
    const conversation = useWorkbenchConversation({
        messages: previewMessages(state.messages),
        draft:
            !state.launched && needsContext
                ? (state.contextDraft ?? "")
                : ((!state.launched ? questionAction?.text : undefined) ??
                  state.draft),
        isRunning:
            state.turns?.some(
                (t) =>
                    t.state === "running" &&
                    t.id !== state.sourcePreparationTurnId,
            ) || state.messages.some((message) => message.status === "running"),
        onDraftChange: (text) =>
            !state.launched && needsContext
                ? update({ contextDraft: text })
                : !state.launched && questionAction
                  ? setQuestionAction({ ...questionAction, text })
                  : setRefinement(text),
        onSend: send,
    });
    async function send(text: string) {
        if (failNext) {
            setFailNext(false);
            throw new Error("fixture_delivery_failure");
        }
        if (state.launched) {
            update({
                messages: [...state.messages, createPreviewMessage({ text })],
                draft: "",
            });
            onStatus(
                "Request recorded in this preview; freeform interpretation is not connected.",
            );
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
                    ...state.messages,
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
        const messages: PreviewConversation["messages"] = [
            ...state.messages,
            createPreviewMessage({ text }),
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
                ...state.messages,
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
        setReply(null);
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
        const id = crypto.randomUUID();
        const comment = createPreviewMessage({
            from: "assistant",
            text: "I'll compare the retained material on integrations and coordination.",
        });
        setState((current) => ({
            ...current,
            messages: [...current.messages, comment],
            turns: [
                ...(current.turns ?? []),
                {
                    id,
                    state: "running",
                    startedAt: new Date().toISOString(),
                    entries: [
                        {
                            kind: "message",
                            id: comment.id,
                            phase: "commentary",
                        },
                        {
                            kind: "operation",
                            operation: {
                                id: `${id}-read`,
                                title: "Read the retained investor presentation",
                                summary:
                                    "Illustrative reading: coordination and network participation.",
                                details:
                                    "Illustrative investor presentation input; this preview does not retrieve or verify a document.",
                                state: "running",
                            },
                        },
                    ],
                },
            ],
        }));
    }
    function growReply() {
        const message = createPreviewMessage({
            from: "assistant",
            text: "## Illustrative reading",
            status: "running",
        });
        setState((current) => ({
            ...current,
            messages: [...current.messages, message],
        }));
        setReply({ id: message.id, step: 0 });
    }
    function interruptReply() {
        const replyId = reply?.id;
        if (!replyId) return;
        setState((current) => ({
            ...current,
            messages: current.messages.map((message) =>
                message.id === replyId
                    ? { ...message, status: "interrupted" }
                    : message,
            ),
        }));
        setReply(null);
    }
    function stopResponse() {
        if (reply) {
            interruptReply();
            return;
        }
        if (!activeTurnId) return;
        setState((current) => {
            const interrupted = interruptTurn({
                ...current,
                turns: current.turns?.filter(
                    (turn) => turn.id === activeTurnId,
                ),
            });
            return {
                ...current,
                messages: interrupted.messages ?? current.messages,
                turns: current.turns?.map((turn) =>
                    turn.id === activeTurnId
                        ? (interrupted.turns?.[0] ?? turn)
                        : turn,
                ),
            };
        });
    }
    useEffect(() => {
        if (restoration.error) onStatus(restoration.error);
    }, [restoration.error, onStatus]);
    useEffect(() => {
        if (!saveAllowed) return;
        try {
            sessionStorage.setItem(previewKey, JSON.stringify(state));
            sessionStorage.removeItem(legacyPreviewKey);
        } catch {
            onStatus(
                "Preview continuity is unavailable in this browser. Your current conversation remains open.",
            );
        }
    }, [state, saveAllowed, onStatus]);
    return {
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
