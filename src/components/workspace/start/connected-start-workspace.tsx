import type { ExternalThreadQueueAdapter } from "@assistant-ui/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { approvalActionCopy } from "@convex/domain/approvalCopy";
import { isResumableResearchPause } from "@convex/domain/transitions";
import { HISTORY_PAGE_SIZE } from "@convex/resourcePolicy";
import {
    ArrowRight01Icon,
    Loading03Icon,
    PauseIcon,
    PlayIcon,
} from "@hugeicons/core-free-icons";
import { Link, useNavigate } from "@tanstack/react-router";
import { useMutation, usePaginatedQuery, useQuery } from "convex/react";
import type { FunctionArgs, FunctionReturnType } from "convex/server";
import { ConvexError } from "convex/values";
import { MotionConfig, motion } from "motion/react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { ConversationActivityList } from "@/components/chat/conversation-activity-list";
import { AgentByline } from "@/components/chat/agent-identity";
import {
    DEFAULT_CONVERSATION_AGENTS as agents,
    SOURCES_AGENT,
} from "@/components/chat/conversation-agent";
import { ConversationHistory } from "@/components/chat/conversation-history";
import {
    type ConversationMissionSnapshot,
    ConversationWorkReturn,
} from "@/components/chat/conversation-mission";
import {
    ConversationActivity,
    ConversationApprovalProvider,
    ConversationComposer,
    ConversationContext,
    ConversationReference,
    useWorkbenchConversation,
} from "@/components/chat/workbench-conversation";
import { CompanyFaviconAvatar } from "@/components/company-favicon-avatar";
import { WorkbenchModelSelector } from "@/components/composer/model-picker";
import type { ResearchControlCommand } from "@/components/composer/slash-commands";
import Icon from "@/components/icon";
import { LoadErrorBoundary } from "@/components/load-error-boundary";
import { Button, buttonVariants } from "@/components/ui/button";
import {
    Empty,
    EmptyDescription,
    EmptyHeader,
    EmptyTitle,
} from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
import { LoadErrorAlert } from "@/components/ui/load-error-alert";
import { Skeleton } from "@/components/ui/skeleton";
import { WorkbenchUiRoot } from "@/components/workbench-ui/root";
import { SourcingLane } from "@/components/workbench-ui/sourcing-lane";
import {
    approvalCardElementId,
    ConnectedApprovalCard,
} from "@/components/workspace/approvals/connected-approval-card";
import { RunHistoryDisclosure } from "@/components/workspace/run-history";
import { UsePreparedSourcesButton } from "@/components/workspace/use-prepared-sources-button";
import { WorkspaceNavigation } from "@/components/workspace/workspace-navigation";
import {
    dossierStages,
    sourcesHandedOff,
    sourcesPhasePresentation,
} from "@/lib/presentation/sources";
import {
    conversationOperation,
    questionCapacityCopy,
    researchProgramReadiness,
    researchStartRefusalCopy,
    workbenchFailureCopy,
    workbenchTurn,
} from "@/lib/presentation/workbench";
import { conversationMessageContent } from "@/lib/workspace/conversation-approvals";
import { insertOptimisticConversationMessage } from "@/lib/workspace/conversation-delivery";
import {
    clearWorkbenchDraft,
    peekWorkbenchDraft,
} from "@/lib/workspace/workbench-draft";
import {
    FramingProposal,
    StageOverview,
    StartFramingScreen,
    StartResearchScreen,
    StartSourceCounts,
    StartSourcesHeader,
    useRevealInConversation,
} from "./start-screens";

import { WorkbenchTurnDetails } from "./workbench-turn-details";

type Snapshot = FunctionReturnType<typeof api.workbench.snapshot>;
type Edit = {
    kind: "scope" | "question";
    id?: string;
    text: string;
    revision: number;
    content: NonNullable<Snapshot["framing"]>["content"];
    requestKey: string;
    newQuestionId?: string;
};

/** The typed code a Convex operation refused with, if any. */
/** Points from the progress header to the decision card in the conversation instead of repeating its choices. */
function OpenDecisionButton({
    requestId,
}: {
    requestId: Id<"approvalRequests">;
}) {
    const reveal = useRevealInConversation();
    return (
        <Button
            variant="outline"
            onClick={() => reveal?.(approvalCardElementId(requestId))}>
            Open decision
        </Button>
    );
}

function convexErrorCode(error: unknown) {
    return error instanceof ConvexError &&
        typeof error.data === "object" &&
        error.data &&
        "code" in error.data
        ? error.data.code
        : undefined;
}

type StartWorkspaceProps = {
    runId: Id<"researchRuns">;
    /** `timeline` opens History in the stage panel; `framing` shows the accepted framing. */
    detail?: "timeline" | "framing";
    /** Workspace-wide controls at the end of the section bar, such as the evidence inventory. */
    navigationActions?: ReactNode;
    /** The Sources result shown in the stage panel once Sources has handed off. */
    sourcesResult?: ReactNode;
};
function useStartDraft(runId: Id<"researchRuns">) {
    // A follow-up prepared on another screen starts the draft; the analyst still sends it.
    const [draft, setDraft] = useState(() => peekWorkbenchDraft(runId) ?? "");
    useEffect(() => clearWorkbenchDraft(runId), [runId]);
    const [edit, setEdit] = useState<Edit | null>(null);
    const launchKey = useRef(crypto.randomUUID());
    const delivery = useRef<{ text: string; mode: string; key: string } | null>(
        null,
    );
    return { draft, setDraft, edit, setEdit, launchKey, delivery };
}
/** Keeps each dossier's draft above recoverable subscription failures. */
export function ConnectedStartWorkspace(props: StartWorkspaceProps) {
    return (
        <div
            data-workbench-layout="viewport"
            className="flex min-h-0 flex-1 flex-col">
            <StartWorkspaceSession key={props.runId} {...props} />
        </div>
    );
}
function StartWorkspaceSession(props: StartWorkspaceProps) {
    const drafts = useStartDraft(props.runId);
    return (
        <LoadErrorBoundary
            title="Research conversation unavailable"
            description="Your saved work and current draft are retained. Try again to reconnect."
            className="m-4">
            <StartWorkspaceQuery {...props} drafts={drafts} />
        </LoadErrorBoundary>
    );
}
/** Layout-accurate skeleton for the Progress split viewport. */
export function StartWorkspaceSkeleton({
    ariaLabel = "Loading research conversation",
}: {
    ariaLabel?: string;
}) {
    return (
        <div
            role="status"
            aria-label={ariaLabel}
            aria-busy="true"
            className="flex h-full min-h-0 flex-1 overflow-hidden">
            <div className="hidden min-h-0 w-[40%] min-w-[22rem] flex-col gap-4 border-r border-divider bg-card/35 px-4 py-3 md:flex">
                <div className="flex items-center justify-between border-b border-divider pb-3">
                    <Skeleton className="h-6 w-36 rounded-md" />
                    <Skeleton className="h-7 w-28 rounded-full" />
                </div>
                <div className="flex flex-1 flex-col gap-4 pt-2">
                    <Skeleton className="h-16 w-4/5 rounded-2xl" />
                    <Skeleton className="h-24 w-11/12 rounded-2xl" />
                    <Skeleton className="h-14 w-2/3 self-end rounded-2xl" />
                </div>
                <Skeleton className="mt-auto h-24 w-full rounded-2xl" />
            </div>
            <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-5 py-6 md:pl-6">
                <div className="flex flex-wrap items-start justify-between gap-4">
                    <div className="flex min-w-0 flex-1 flex-col gap-2.5">
                        <Skeleton className="h-3.5 w-28 rounded" />
                        <Skeleton className="h-9 w-80 max-w-full rounded-lg" />
                        <Skeleton className="h-4 w-96 max-w-full rounded" />
                    </div>
                    <Skeleton className="h-10 w-36 shrink-0 rounded-full" />
                </div>
                <div className="flex flex-wrap items-center gap-8 rounded-2xl border border-divider bg-card/55 px-5 py-4">
                    <div className="flex gap-8">
                        <div className="space-y-1.5">
                            <Skeleton className="h-10 w-12 rounded-md" />
                            <Skeleton className="h-3 w-12 rounded" />
                        </div>
                        <div className="space-y-1.5">
                            <Skeleton className="h-10 w-12 rounded-md" />
                            <Skeleton className="h-3 w-16 rounded" />
                        </div>
                        <div className="space-y-1.5">
                            <Skeleton className="h-10 w-12 rounded-md" />
                            <Skeleton className="h-3 w-16 rounded" />
                        </div>
                    </div>
                    <div className="min-w-[12rem] flex-1 space-y-2.5">
                        <Skeleton className="h-2 w-full rounded-full" />
                        <div className="flex justify-between gap-2">
                            <Skeleton className="h-3 w-14 rounded" />
                            <Skeleton className="h-3 w-24 rounded" />
                            <Skeleton className="h-3 w-16 rounded" />
                        </div>
                    </div>
                </div>
                <div className="grid grid-cols-1 gap-3.5 lg:grid-cols-3">
                    <Skeleton className="h-64 w-full rounded-2xl" />
                    <Skeleton className="h-64 w-full rounded-2xl" />
                    <Skeleton className="h-64 w-full rounded-2xl" />
                </div>
            </div>
        </div>
    );
}
function StartWorkspaceQuery({
    runId,
    detail,
    navigationActions,
    sourcesResult,
    drafts,
}: StartWorkspaceProps & { drafts: ReturnType<typeof useStartDraft> }) {
    const snapshot = useQuery(api.workbench.snapshot, { runId });
    if (snapshot === undefined) return <StartWorkspaceSkeleton />;
    return (
        <StartWorkspaceContent
            key={runId}
            snapshot={snapshot}
            detail={detail}
            navigationActions={navigationActions}
            sourcesResult={sourcesResult}
            drafts={drafts}
        />
    );
}
function StartWorkspaceContent({
    snapshot,
    detail,
    navigationActions,
    sourcesResult,
    drafts,
}: {
    snapshot: Snapshot;
    detail?: "timeline" | "framing";
    navigationActions?: ReactNode;
    sourcesResult?: ReactNode;
    drafts: ReturnType<typeof useStartDraft>;
}) {
    const { run, company, framing } = snapshot;
    const runId = run._id;
    const navigate = useNavigate();
    const state = useQuery(api.execution.conversations.get, { runId });
    const modelChoices = useQuery(api.workbench.models, { runId });
    const selectModel = useMutation(api.workbench.setModel);
    const executeResearchCommand = useMutation(api.workbench.command);
    const [modelPickerOpen, setModelPickerOpen] = useState(false);
    const [modelPending, setModelPending] = useState(false);
    const commandDelivery = useRef<{
        command: ResearchControlCommand;
        generation: number;
        key: string;
    } | null>(null);
    const modelDelivery = useRef<{
        id: Id<"modelCatalog">;
        effort?: FunctionArgs<typeof api.workbench.setModel>["reasoningEffort"];
        revision: number;
        key: string;
    } | null>(null);
    const history = usePaginatedQuery(
        api.workbench.history,
        { runId },
        { initialNumItems: HISTORY_PAGE_SIZE },
    );
    const submit = useMutation(
            api.execution.conversations.submit,
        ).withOptimisticUpdate(insertOptimisticConversationMessage),
        remove = useMutation(api.execution.conversations.removeQueued),
        promote = useMutation(api.execution.conversations.promoteQueued),
        stop = useMutation(api.execution.conversations.stopResponse),
        resume = useMutation(api.execution.conversations.resumeQueue);
    const save = useMutation(api.framing.save),
        start = useMutation(api.framing.startResearch);
    const pauseResearch = useMutation(api.execution.researchControl.pause),
        resumeResearch = useMutation(api.execution.researchControl.resume);
    const activeGrants = useQuery(api.execution.approvals.listGrants, {
        runId,
    });
    const revokeGrant = useMutation(api.execution.approvals.revokeGrant);
    const { draft, setDraft, edit, setEdit, launchKey, delivery } = drafts;
    const [error, setError] = useState<string | null>(null);
    const [saving, setSaving] = useState(false);
    const inputRef = useRef<HTMLTextAreaElement>(null);
    const trigger = useRef<HTMLElement | null>(null);
    const activeTurnId = state?.activeTurn?._id;
    // An existing question is edited in its row; scope edits and new questions use the composer.
    const inlineEdit = edit?.kind === "question" && edit.id ? edit : null;
    const composerEdit = inlineEdit ? null : edit;
    const editKey = composerEdit
        ? `${composerEdit.kind}:${composerEdit.id ?? ""}`
        : null;
    const insufficient =
        run.completionOutcome === "insufficient_public_evidence";
    const launched = !!run.fixedFramingRevisionId;
    const readiness = researchProgramReadiness(
        snapshot.researchStart,
        framing?.content.questions.length ?? 0,
    );
    const inspecting = !launched || detail === "framing";
    const running =
        !!state?.activeTurn &&
        (state.execution?.status === "running" ||
            state.execution?.status === "ready");
    const control = (operation: Promise<unknown>) => {
        void operation.catch(() =>
            setError(
                "That action could not be completed. Your saved work is unchanged. Try again.",
            ),
        );
    };
    const onCommand = async (command: ResearchControlCommand) => {
        if (commandDelivery.current?.command !== command)
            commandDelivery.current = {
                command,
                generation: run.executionGeneration,
                key: crypto.randomUUID(),
            };
        const delivery = commandDelivery.current;
        await executeResearchCommand({
            runId,
            command,
            expectedGeneration: delivery.generation,
            requestKey: delivery.key,
        });
        commandDelivery.current = null;
    };
    const onSelectModel = async (
        id: Id<"modelCatalog">,
        effort?: FunctionArgs<typeof api.workbench.setModel>["reasoningEffort"],
    ) => {
        if (!modelChoices || modelPending) return;
        if (
            modelDelivery.current?.id !== id ||
            modelDelivery.current?.effort !== effort
        )
            modelDelivery.current = {
                id,
                effort,
                revision: modelChoices.revision,
                key: crypto.randomUUID(),
            };
        const delivery = modelDelivery.current;
        setModelPending(true);
        setError(null);
        try {
            await selectModel({
                runId,
                catalogId: id,
                ...(delivery.effort
                    ? { reasoningEffort: delivery.effort }
                    : {}),
                expectedRevision: delivery.revision,
                requestKey: delivery.key,
            });
            modelDelivery.current = null;
            setModelPickerOpen(false);
        } catch (error) {
            if (convexErrorCode(error) === "model_configuration_conflict")
                modelDelivery.current = null;
            setError(
                "The model settings could not be confirmed. Check the selection and try again.",
            );
        } finally {
            setModelPending(false);
        }
    };
    /** Saves an edit against the framing revision it was opened on, so a newer program is never overwritten. */
    const saveEdit = async (edit: Edit, text: string) => {
        const content =
            edit.kind === "scope"
                ? { ...edit.content, scope: text }
                : {
                      ...edit.content,
                      questions: edit.id
                          ? edit.content.questions.map((q) =>
                                q.id === edit.id ? { ...q, text } : q,
                            )
                          : [
                                ...edit.content.questions,
                                {
                                    id:
                                        edit.newQuestionId ??
                                        crypto.randomUUID(),
                                    text,
                                    shortLabel: `Question ${edit.content.questions.length + 1}`,
                                    rationale: "Added by the analyst.",
                                },
                            ],
                  };
        try {
            setSaving(true);
            await save({
                runId,
                expectedRevision: edit.revision,
                requestKey: edit.requestKey,
                content,
            });
            setEdit(null);
            queueMicrotask(() => trigger.current?.focus());
        } catch (cause) {
            const code = convexErrorCode(cause);
            setError(
                code === "framing_question_capacity" && readiness.questionLimit
                    ? questionCapacityCopy(readiness.questionLimit)
                    : "The research program could not be saved. If it changed, cancel this edit and review the latest version before trying again.",
            );
            throw cause;
        } finally {
            setSaving(false);
        }
    };
    const send = async (text: string, mode: "queue" | "steer" = "queue") => {
        setError(null);
        if (composerEdit) {
            await saveEdit(composerEdit, text);
            return;
        }
        if (delivery.current?.text !== text || delivery.current?.mode !== mode)
            delivery.current = { text, mode, key: crypto.randomUUID() };
        await submit({
            runId,
            requestKey: delivery.current.key,
            text,
            delivery: mode,
            turnId: mode === "steer" ? state?.activeTurn?._id : undefined,
        });
        delivery.current = null;
        setDraft((current) => (current === text ? "" : current));
    };
    const awaitingAdmission =
        !running && !state?.queuePaused
            ? history.results
                  .filter((message) => message.status === "queued")
                  .at(-1)?._id
            : undefined;
    const queue: Omit<ExternalThreadQueueAdapter, "enqueue" | "steer"> = {
        items: history.results
            .filter((m) => m.status === "queued" && m._id !== awaitingAdmission)
            .slice()
            .reverse()
            .map((m) => ({
                id: m._id,
                prompt: m.text,
                parts: [{ type: "text", text: m.text }],
            })),
        steerItems: [],
        remove: (id) =>
            control(
                remove({
                    runId,
                    messageId: id as Id<"agentMessageDeliveries">,
                }),
            ),
        move: (id, placement) => {
            if (placement.lane === "steer" && state?.activeTurn)
                control(
                    promote({
                        runId,
                        messageId: id as Id<"agentMessageDeliveries">,
                        turnId: state.activeTurn._id,
                    }),
                );
        },
        edit: () =>
            setError(
                "Remove the queued message and send your revised instruction.",
            ),
    };
    const publishedTurns = new Set(
        history.results.flatMap((m) =>
            m.role === "assistant" && m.turnId ? [m.turnId] : [],
        ),
    );
    const responsePreview = useQuery(
        api.workbench.responsePreview,
        snapshot.activeWork ? { runId } : "skip",
    );
    const previewTurns = new Map(
        history.results.flatMap(({ work }) =>
            work?.turn.preview && !work.turn.publishedMessageId
                ? [[work.turn._id, work.turn] as const]
                : [],
        ),
    );
    if (
        responsePreview &&
        snapshot.activeWork?.turn._id === responsePreview.turnId &&
        !publishedTurns.has(responsePreview.turnId)
    )
        previewTurns.set(responsePreview.turnId, {
            ...snapshot.activeWork.turn,
            preview: responsePreview,
        });
    for (const id of publishedTurns) previewTurns.delete(id);
    const messages = history.results
        .filter(
            (m) =>
                (m.status !== "queued" || m._id === awaitingAdmission) &&
                m.status !== "removed",
        )
        .slice()
        .reverse()
        .map((m) => ({
            ...m,
            _id:
                m.role === "assistant" && m.turnId
                    ? `reply:${m.turnId}`
                    : m.role === "user" && m.requestKey
                      ? `message:${m.requestKey}`
                      : m._id,
        }));
    const conversation = useWorkbenchConversation({
        messages: [
            ...messages.map((m) => {
                const approvalIds =
                    "approvalRequestIds" in m &&
                    Array.isArray(m.approvalRequestIds) &&
                    m.approvalRequestIds.length
                        ? m.approvalRequestIds
                        : m.approvalRequestId
                          ? [m.approvalRequestId]
                          : [];
                return {
                    id: m._id,
                    role: m.role,
                    content: conversationMessageContent(
                        m._id,
                        m.text,
                        approvalIds,
                    ),
                    createdAt: new Date(m.createdAt),
                    metadata: {
                        custom: {
                            agentId:
                                m.role === "assistant"
                                    ? "workbench"
                                    : undefined,
                            responseControl: m.responseControl,
                        },
                    },
                };
            }),
            ...[...previewTurns.values()].map((turn) => ({
                id: `reply:${turn._id}`,
                role: "assistant" as const,
                content: turn.preview?.text ?? "",
                createdAt: new Date(turn.createdAt),
                status:
                    turn.status === "active" &&
                    snapshot.activeWork?.turn._id === turn._id &&
                    snapshot.activeWork.missionStatus === "running"
                        ? { type: "running" as const }
                        : {
                              type: "incomplete" as const,
                              reason: "cancelled" as const,
                          },
                metadata: { custom: { agentId: "workbench" } },
            })),
        ],
        draft: composerEdit?.text ?? draft,
        onDraftChange: (text) =>
            composerEdit
                ? setEdit({
                      ...composerEdit,
                      text,
                      requestKey: crypto.randomUUID(),
                  })
                : setDraft(text),
        onSend: send,
        isRunning: running || awaitingAdmission !== undefined,
        queue: composerEdit ? undefined : queue,
        onStop: activeTurnId
            ? () => stop({ runId, turnId: activeTurnId }).then(() => {})
            : undefined,
    });
    const wasEditing = useRef(false);
    useEffect(() => {
        if (editKey) inputRef.current?.focus();
        else if (wasEditing.current) trigger.current?.focus();
        wasEditing.current = Boolean(editKey);
    }, [editKey]);
    const work = new Map(
        history.results.flatMap(({ work }) => {
            if (!work) return [];
            return [
                [
                    work.turn._id,
                    {
                        ...workbenchTurn(work),
                        ...(work.deferred
                            ? {
                                  workDetails: (open: boolean) => (
                                      <WorkbenchTurnDetails
                                          runId={runId}
                                          turnId={work.turn._id}
                                          open={open}
                                      />
                                  ),
                              }
                            : {}),
                    },
                ] as const,
            ];
        }),
    );
    if (
        snapshot.activeWork &&
        !publishedTurns.has(snapshot.activeWork.turn._id)
    )
        work.set(
            snapshot.activeWork.turn._id,
            workbenchTurn({
                ...snapshot.activeWork,
                turn:
                    previewTurns.get(snapshot.activeWork.turn._id) ??
                    snapshot.activeWork.turn,
            }),
        );
    const captured = snapshot.sources.filter(
        (s) => s.state === "captured",
    ).length;
    const sourcePresentation = sourcesPhasePresentation(snapshot.sourcesPhase);
    // Once Sources hands off, its result replaces the collection lanes.
    const programQuestions =
        framing?.content.questions.map((q, index) => ({
            ...q,
            label: `Q${index + 1}`,
        })) ?? [];
    const stageResult = sourcesHandedOff(snapshot.sourcesPhase)
        ? sourcesResult
        : undefined;
    const sourceDetail =
        snapshot.sourcesWork?.interruptionDetail ?? sourcePresentation.detail;
    const sourceState = sourcePresentation.workState;
    const sourceOperations =
        snapshot.sourcesWork?.operations.map((operation) =>
            conversationOperation(operation, sourceState),
        ) ?? [];
    const missions: ConversationMissionSnapshot[] = launched
        ? [
              {
                  id: `sources:${runId}`,
                  agentId: "sources",
                  title: "Documentary preparation",
                  state: sourceState,
                  stateLabel: sourcePresentation.label,
                  startedAt:
                      (snapshot.sourcesWork?.startedAt ?? run.researchStartedAt)
                          ? new Date(
                                snapshot.sourcesWork?.startedAt ??
                                    run.researchStartedAt ??
                                    run._creationTime,
                            ).toISOString()
                          : undefined,
                  operations: sourceOperations,
                  finishedAt: snapshot.sourcesWork?.finishedAt
                      ? new Date(snapshot.sourcesWork.finishedAt).toISOString()
                      : undefined,
                  summary: `${snapshot.sources.length} references · ${captured} captures`,
                  details: (
                      <>
                          <p>{sourceDetail}</p>
                          <ConversationActivityList>
                              {sourceOperations.map((operation) => (
                                  <ConversationActivity
                                      key={operation.id}
                                      {...operation}
                                  />
                              ))}
                          </ConversationActivityList>
                          {snapshot.sourcesWork?.operationsLimited && (
                              <p>
                                  Recent operations shown. History in the stage
                                  panel lists earlier steps.
                              </p>
                          )}
                      </>
                  ),
              },
          ]
        : [];
    const researchControls =
        launched && snapshot.researchControlAvailable ? (
            <div className="flex flex-wrap items-center gap-2">
                {run.researchPauseRequested ? (
                    <>
                        <p
                            role="status"
                            className="flex items-center gap-1.5 text-sm text-muted-foreground">
                            <Icon
                                iconNode={Loading03Icon}
                                size={14}
                                className="animate-spin motion-reduce:animate-none"
                            />
                            Pausing after the current step
                        </p>
                        <Button
                            variant="outline"
                            onClick={() =>
                                control(
                                    resumeResearch({
                                        runId,
                                        expectedGeneration:
                                            run.executionGeneration,
                                    }),
                                )
                            }>
                            <Icon iconNode={PlayIcon} size={15} />
                            Keep researching
                        </Button>
                    </>
                ) : snapshot.sourcesPhase === "time_limit" ? (
                    // The time-limit decision is only made on its approval card in the conversation; a generic Resume would renew the window unasked.
                    snapshot.sourcesDecisionRequestId ? (
                        <OpenDecisionButton
                            requestId={snapshot.sourcesDecisionRequestId}
                        />
                    ) : null
                ) : isResumableResearchPause(run) &&
                  snapshot.researchResumeAvailable ? (
                    <Button
                        onClick={() =>
                            control(
                                resumeResearch({
                                    runId,
                                    expectedGeneration: run.executionGeneration,
                                }),
                            )
                        }>
                        <Icon iconNode={PlayIcon} size={15} />
                        Resume research
                    </Button>
                ) : run.executionStatus === "running" ? (
                    <Button
                        variant="outline"
                        onClick={() =>
                            control(
                                pauseResearch({
                                    runId,
                                    expectedGeneration: run.executionGeneration,
                                }),
                            )
                        }>
                        <Icon iconNode={PauseIcon} size={15} />
                        Pause research
                    </Button>
                ) : null}
                {snapshot.sourcesSettlementAvailable &&
                snapshot.sourcesPhase !== "time_limit" ? (
                    <UsePreparedSourcesButton
                        runId={runId}
                        expectedGeneration={run.executionGeneration}
                    />
                ) : null}
            </div>
        ) : null;
    const grants = activeGrants?.map((grant) => ({
        id: grant.action,
        label: approvalActionCopy[grant.action].grantedLabel,
        onRevoke: () =>
            control(
                revokeGrant({
                    runId,
                    action: grant.action,
                }),
            ),
    }));
    const log = (
        <>
            {history.status === "CanLoadMore" && (
                <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => history.loadMore(20)}>
                    Load earlier conversation
                </Button>
            )}
            {history.status === "LoadingFirstPage" ? (
                <Skeleton className="h-24 w-3/4" />
            ) : (
                <ConversationApprovalProvider
                    renderApproval={(requestId) => (
                        <ConnectedApprovalCard
                            requestId={requestId as Id<"approvalRequests">}
                        />
                    )}>
                    <ConversationHistory
                        entries={[
                            ...messages.map((m) => ({
                                kind: "message" as const,
                                id: m._id,
                                time: m.createdAt,
                            })),
                            ...[...previewTurns.values()].map((turn) => ({
                                kind: "message" as const,
                                id: `reply:${turn._id}`,
                                time: turn.createdAt,
                            })),
                            ...[...work.values()]
                                .filter(
                                    (turn) =>
                                        !turn.entries.some(
                                            (entry) =>
                                                entry.kind === "message" &&
                                                (messages.some(
                                                    (m) => m._id === entry.id,
                                                ) ||
                                                    [
                                                        ...previewTurns.values(),
                                                    ].some(
                                                        (t) =>
                                                            `reply:${t._id}` ===
                                                            entry.id,
                                                    )),
                                        ),
                                )
                                .map((turn) => ({
                                    kind: "turn" as const,
                                    id: turn.id,
                                    time: Date.parse(turn.startedAt ?? "") || 0,
                                })),
                            ...missions.map((m) => ({
                                kind: "mission" as const,
                                id: m.id,
                                time: run.researchStartedAt ?? run.updatedAt,
                            })),
                        ].sort((a, b) => a.time - b.time)}
                        turns={[...work.values()]}
                        missions={missions}
                        agents={agents}
                    />
                </ConversationApprovalProvider>
            )}
            {state?.execution?.status === "blocked" && (
                <LoadErrorAlert
                    variant="inline"
                    title="Response unavailable"
                    description={workbenchFailureCopy(state.execution.code)}
                />
            )}
            {state &&
                state.queuedCount - (awaitingAdmission ? 1 : 0) >
                    queue.items.length && (
                    <p className="text-sm text-muted-foreground">
                        {state.queuedCount} messages are queued. Load earlier
                        conversation to inspect the remaining messages.
                    </p>
                )}
            {(snapshot.activeWork?.operationsLimited ||
                history.results.some((m) => m.work?.operationsLimited)) && (
                <p className="text-sm text-muted-foreground">
                    Showing the latest operations in each response.
                </p>
            )}
            {snapshot.instructions.map((instruction) => (
                <div
                    key={instruction.id}
                    className="rounded-md border p-3 text-sm">
                    <p className="font-medium">{instruction.need}</p>
                    <p className="text-muted-foreground">
                        {instruction.outcome}
                    </p>
                </div>
            ))}
            {state?.admissionFailure && (
                <LoadErrorAlert
                    variant="inline"
                    title="A queued message needs attention"
                    description={
                        state.admissionFailure.code === "context_capacity"
                            ? "A queued message could not fit in this response. Remove it from the queue and send a shorter request; later messages are saved."
                            : workbenchFailureCopy(state.admissionFailure.code)
                    }
                />
            )}
            {error && (
                <LoadErrorAlert
                    variant="inline"
                    title="Action unavailable"
                    description={error}
                />
            )}
        </>
    );
    const beginEdit = (kind: Edit["kind"], id?: string) => {
        if (!framing) return;
        trigger.current =
            document.activeElement instanceof HTMLElement
                ? document.activeElement
                : null;
        setEdit({
            kind,
            id,
            text:
                kind === "scope"
                    ? framing.content.scope
                    : (framing.content.questions.find((q) => q.id === id)
                          ?.text ?? ""),
            revision: framing.revision,
            content: framing.content,
            requestKey: crypto.randomUUID(),
            newQuestionId:
                kind === "question" && !id ? crypto.randomUUID() : undefined,
        });
        setError(null);
    };
    const composer = (
        <>
            {launched && !composerEdit && (
                <ConversationWorkReturn missions={missions} agents={agents} />
            )}
            <ConversationComposer
                inputRef={inputRef}
                onCommand={!composerEdit ? onCommand : undefined}
                availableCommands={[...snapshot.availableCommands, "/model"]}
                grants={!composerEdit ? grants : undefined}
                onOpenModels={() => setModelPickerOpen(true)}
                controlsOpen={modelPickerOpen}
                modelSelector={
                    !composerEdit ? (
                        <WorkbenchModelSelector
                            snapshot={modelChoices}
                            open={modelPickerOpen}
                            onOpenChange={setModelPickerOpen}
                            pending={modelPending}
                            onSelect={(id, effort) =>
                                void onSelectModel(id, effort)
                            }
                        />
                    ) : undefined
                }
                label={
                    composerEdit
                        ? composerEdit.kind === "scope"
                            ? "Edit research scope"
                            : "Add research question"
                        : launched
                          ? "Ask about the sources"
                          : "Refine the framing in your own words"
                }
                placeholder={
                    composerEdit?.kind === "question"
                        ? "What would you like to investigate?"
                        : undefined
                }
                actionLabel={
                    composerEdit
                        ? composerEdit.kind === "scope"
                            ? "Save changes"
                            : "Add question"
                        : undefined
                }
                onCancel={
                    composerEdit
                        ? () => {
                              setEdit(null);
                              setError(null);
                              trigger.current?.focus();
                          }
                        : undefined
                }
                pending={conversation.sending || saving || modelPending}
                failed={conversation.failed}
                compact={launched && !inspecting}
                onResumeQueue={
                    state?.queuePaused &&
                    state.queuedCount &&
                    state.admissionFailure?.code !== "context_capacity" &&
                    state.admissionFailure?.code !==
                        "native_settlement_incomplete" &&
                    state.admissionFailure?.code !==
                        "definition_version_conflict"
                        ? () => control(resume({ runId }))
                        : undefined
                }
            />
        </>
    );
    const context = (
        <ConversationContext
            title={`${company?.ticker ?? "Company"} · Research`}
            icon={
                company ? (
                    <CompanyFaviconAvatar company={company} size="xs" />
                ) : undefined
            }
            missions={missions}
            activities={[...work.values()].flatMap((t) =>
                t.entries.flatMap((e) =>
                    e.kind === "operation" ? [e.operation] : [],
                ),
            )}
            onChangeScope={!launched ? () => beginEdit("scope") : undefined}
            scope={framing?.content.scope || "Scope being prepared"}
            questions={
                framing?.content.questions.map((q) => q.shortLabel) ?? []
            }
            programTitle={
                launched
                    ? "Accepted research program"
                    : "Proposed research program"
            }
            scopeAction={
                launched ? (
                    <Button
                        variant="ghost"
                        size="xs"
                        onClick={() =>
                            void navigate({
                                to: "/workspace/$runId",
                                params: { runId },
                                search: {
                                    section: "overview",
                                    detail: "framing",
                                },
                                resetScroll: false,
                            })
                        }>
                        View framing
                    </Button>
                ) : undefined
            }
            sourcesSummary={`${snapshot.sources.length} references · ${captured} saved ${captured === 1 ? "capture" : "captures"}`}
            sources={
                <DossierContextSources
                    sources={snapshot.sources}
                    runId={launched ? runId : undefined}
                />
            }
        />
    );
    const launch = async () => {
        if (!framing) return;
        try {
            setSaving(true);
            setError(null);
            await start({
                runId,
                expectedRevision: framing.revision,
                requestKey: launchKey.current,
            });
        } catch (caught) {
            // The disabled Start already explains known blocks; this covers a change that raced the click.
            setError(
                researchStartRefusalCopy(convexErrorCode(caught)) ??
                    "Research could not start. Review the latest program, then try again.",
            );
        } finally {
            setSaving(false);
        }
    };
    const program = (
        <FramingProposal
            collapsible
            title={launched ? "Accepted research program" : undefined}
            questions={programQuestions}
            composer={composer}
            actionActive={!!composerEdit}
            pending={saving}
            startDisabled={
                !framing?.content.scope.trim() ||
                !framing.content.questions.length ||
                running
            }
            questionLimit={!launched ? readiness.questionLimit : undefined}
            addUnavailableReason={
                !launched ? readiness.addUnavailable : undefined
            }
            startUnavailableReason={
                !launched ? readiness.startUnavailable : undefined
            }
            onEditRequest={
                !launched && !composerEdit
                    ? (q) => beginEdit("question", q.id)
                    : undefined
            }
            editing={
                inlineEdit?.id
                    ? {
                          questionId: inlineEdit.id,
                          text: inlineEdit.text,
                          pending: saving,
                          error: error ?? undefined,
                      }
                    : undefined
            }
            onEditChange={(text) =>
                inlineEdit &&
                setEdit({
                    ...inlineEdit,
                    text,
                    requestKey: crypto.randomUUID(),
                })
            }
            onEditCancel={() => {
                setEdit(null);
                setError(null);
            }}
            onEditSave={() => {
                if (!inlineEdit) return;
                setError(null);
                // A refusal is shown beside the field; the unsaved wording stays.
                void saveEdit(inlineEdit, inlineEdit.text.trim()).catch(
                    () => undefined,
                );
            }}
            onAddRequest={!launched ? () => beginEdit("question") : undefined}
            onStart={!launched ? () => void launch() : undefined}
            error={undefined}
        />
    );
    const sections = (
        <WorkspaceNavigation
            runId={runId}
            section="overview"
            actions={navigationActions}
        />
    );
    return (
        <MotionConfig reducedMotion="user">
            <motion.div
                key={inspecting ? "framing" : "research"}
                initial={{ opacity: 0, x: -14 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
                className="flex h-full min-h-0 flex-1 flex-col">
                <WorkbenchUiRoot className="flex h-full min-h-0 flex-1 flex-col">
                    {!inspecting && (
                        <div className="shrink-0 pt-3 [&_[data-workspace-bar]]:pb-3">
                            {sections}
                        </div>
                    )}
                    {inspecting ? (
                        <StartFramingScreen
                            runtime={conversation.runtime}
                            context={context}
                            conversation={log}
                            action={program}
                            actionLabel={
                                launched ? "Research program" : "Pending action"
                            }
                        />
                    ) : (
                        <StartResearchScreen
                            overview={
                                <StageOverview
                                    questions={programQuestions}
                                    question={
                                        run.researchAngle?.trim() ||
                                        framing?.content.scope ||
                                        "Research question being prepared"
                                    }
                                    stages={dossierStages(
                                        snapshot.sourcesPhase,
                                    )}
                                />
                            }
                            runtime={conversation.runtime}
                            context={context}
                            conversation={log}
                            conversationComposer={composer}
                            heading={
                                <StartSourcesHeader
                                    mark={sourcePresentation.mark}
                                    tone={sourcePresentation.tone}
                                    label={sourcePresentation.label}
                                    title="Sources"
                                    description={
                                        stageResult ? undefined : sourceDetail
                                    }
                                    attribution={
                                        stageResult ? undefined : (
                                            <AgentByline agent={SOURCES_AGENT} />
                                        )
                                    }
                                    actions={
                                        stageResult ? (
                                            <>
                                                {researchControls}
                                                <Link
                                                    to="/workspace/$runId"
                                                    params={{ runId }}
                                                    search={{
                                                        section: "sources",
                                                    }}
                                                    className={buttonVariants()}>
                                                    Open sources
                                                    <Icon
                                                        iconNode={
                                                            ArrowRight01Icon
                                                        }
                                                        size={16}
                                                    />
                                                </Link>
                                            </>
                                        ) : (
                                            researchControls
                                        )
                                    }
                                />
                            }
                            summary={
                                <StartSourceCounts
                                    counts={[
                                        {
                                            value: snapshot.sources.length,
                                            label: "found",
                                        },
                                        {
                                            value: snapshot.sources.filter(
                                                (s) => s.state === "capturing",
                                            ).length,
                                            label:
                                                sourceState === "running"
                                                    ? "capturing"
                                                    : "waiting",
                                            highlight:
                                                sourceState === "running" &&
                                                snapshot.sources.some(
                                                    (s) =>
                                                        s.state === "capturing",
                                                ),
                                        },
                                        { value: captured, label: "captured" },
                                    ]}
                                />
                            }
                            resting={launched && sourceState !== "running"}
                            result={stageResult}
                            history={
                                <RunHistoryDisclosure
                                    runId={runId}
                                    defaultOpen={detail === "timeline"}
                                />
                            }
                            lanes={
                                snapshot.sources.length ? (
                                    (
                                        [
                                            "found",
                                            "capturing",
                                            "captured",
                                        ] as const
                                    ).map((stage) => {
                                        const docs = snapshot.sources.filter(
                                            (s) => s.state === stage,
                                        );
                                        return (
                                            <SourcingLane
                                                key={stage}
                                                state={stage}
                                                active={
                                                    stage === "capturing" &&
                                                    sourceState === "running" &&
                                                    docs.length > 0
                                                }
                                                label={
                                                    stage === "found"
                                                        ? "Found"
                                                        : stage === "capturing"
                                                          ? sourceState ===
                                                            "running"
                                                              ? "Capturing"
                                                              : "Waiting"
                                                          : "Captured"
                                                }
                                                count={docs.length}
                                                documents={docs
                                                    .slice(0, 4)
                                                    .map((s) => ({
                                                        id: s.id,
                                                        title: s.title,
                                                        format: s.format,
                                                        meta: s.unavailable
                                                            ? "Reading unavailable"
                                                            : "",
                                                    }))}
                                                remainingLabel={
                                                    docs.length > 4
                                                        ? `+${docs.length - 4} more`
                                                        : undefined
                                                }
                                                emptyMessage="No documents at this stage."
                                            />
                                        );
                                    })
                                ) : (
                                    <Empty>
                                        <EmptyHeader>
                                            <EmptyTitle>
                                                {insufficient
                                                    ? "No documentary preparation completed"
                                                    : sourceState === "running"
                                                      ? "Preparing source discovery"
                                                      : "No documents recorded"}
                                            </EmptyTitle>
                                            <EmptyDescription>
                                                {insufficient
                                                    ? "Research ended before documentary preparation could proceed."
                                                    : sourceState === "running"
                                                      ? "Documents will appear as they are found."
                                                      : "Open Sources to review preparation."}
                                            </EmptyDescription>
                                        </EmptyHeader>
                                    </Empty>
                                )
                            }
                            notice={
                                insufficient ? (
                                    <div className="p-4">
                                        <p>
                                            There is not enough public evidence
                                            to continue this research.
                                        </p>
                                        <Button
                                            variant="launch"
                                            onClick={() =>
                                                void navigate({
                                                    to: "/workspace/start",
                                                })
                                            }>
                                            Start another analysis
                                        </Button>
                                    </div>
                                ) : undefined
                            }
                        />
                    )}
                    {launched && inspecting && (
                        <Button
                            variant="ghost"
                            onClick={() =>
                                void navigate({
                                    to: "/workspace/$runId",
                                    params: { runId },
                                    search: { section: "overview" },
                                })
                            }>
                            Back to preparation
                        </Button>
                    )}
                </WorkbenchUiRoot>
            </motion.div>
        </MotionConfig>
    );
}

/** The context indexes research inputs without implying that an available capture establishes support. */
function DossierContextSources({
    sources,
    runId,
}: {
    sources: Snapshot["sources"];
    runId?: Id<"researchRuns">;
}) {
    const [search, setSearch] = useState("");
    const navigate = useNavigate();
    const matches = sources.filter((source) =>
        source.title
            .toLocaleLowerCase()
            .includes(search.trim().toLocaleLowerCase()),
    );
    return (
        <div className="chat-context-source-list">
            <p className="chat-context-meta">
                References and saved captures do not establish factual support.
            </p>
            {sources.length > 0 && (
                <Input
                    type="search"
                    aria-label="Find a source"
                    placeholder="Find a source"
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                />
            )}
            {matches.map((source) => (
                <ConversationReference
                    key={source.id}
                    title={source.title}
                    description={
                        source.state === "captured"
                            ? "Saved capture"
                            : "Research input"
                    }>
                    <a href={source.url} target="_blank" rel="noreferrer">
                        Open original
                    </a>
                </ConversationReference>
            ))}
            {!matches.length && (
                <p className="chat-context-empty">
                    {sources.length
                        ? "No matching source. Try another title."
                        : "No references supplied."}
                </p>
            )}
            {runId && (
                <Button
                    variant="ghost"
                    size="sm"
                    onClick={() =>
                        void navigate({
                            to: "/workspace/$runId",
                            params: { runId },
                            search: { section: "sources" },
                        })
                    }>
                    Inspect source workspace
                    <Icon iconNode={ArrowRight01Icon} size={14} />
                </Button>
            )}
        </div>
    );
}
