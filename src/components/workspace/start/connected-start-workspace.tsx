import type { ExternalThreadQueueAdapter } from "@assistant-ui/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { isResumableResearchPause } from "@convex/domain/transitions";
import { HISTORY_PAGE_SIZE } from "@convex/resourcePolicy";
import { ArrowLeft01Icon, ArrowRight01Icon } from "@hugeicons/core-free-icons";
import { useNavigate } from "@tanstack/react-router";
import { useMutation, usePaginatedQuery, useQuery } from "convex/react";
import type { FunctionArgs, FunctionReturnType } from "convex/server";
import { ConvexError } from "convex/values";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { ConversationHistory } from "@/components/chat/conversation-history";
import type { ConversationMissionSnapshot } from "@/components/chat/conversation-mission";
import {
    ConversationComposer,
    ConversationContext,
    ConversationReference,
    useWorkbenchConversation,
} from "@/components/chat/workbench-conversation";
import { WorkbenchModelSelector } from "@/components/composer/model-picker";
import type { ResearchControlCommand } from "@/components/composer/slash-commands";
import Icon from "@/components/icon";
import { LoadErrorBoundary } from "@/components/load-error-boundary";
import { Button } from "@/components/ui/button";
import {
    Empty,
    EmptyDescription,
    EmptyHeader,
    EmptyTitle,
} from "@/components/ui/empty";
import { LoadErrorAlert } from "@/components/ui/load-error-alert";
import { Skeleton } from "@/components/ui/skeleton";
import { WorkbenchUiRoot } from "@/components/workbench-ui/root";
import { SourcingLane } from "@/components/workbench-ui/sourcing-lane";
import { WorkspaceNavigation } from "@/components/workspace/workspace-navigation";
import { useResponsive } from "@/hooks/use-responsive";
import {
    questionCapacityCopy,
    researchProgramReadiness,
    researchStartRefusalCopy,
    sourceMissionPresentation,
    workbenchFailureCopy,
    workbenchTurn,
} from "@/lib/presentation/workbench";
import {
    clearWorkbenchDraft,
    peekWorkbenchDraft,
} from "@/lib/workspace/workbench-draft";
import {
    FramingProposal,
    StartFramingScreen,
    StartResearchScreen,
    StartSourceCounts,
    StartSourcesHeader,
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
const agents = {
    workbench: { id: "workbench", name: "Workbench Agent" },
    sources: { id: "sources", name: "Sources" },
};

/** The typed code a Convex operation refused with, if any. */
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
    detail?: "timeline" | "framing";
    progress?: ReactNode;
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
            data-workbench-layout={
                props.detail === "timeline" ? "document" : "viewport"
            }
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
function StartWorkspaceQuery({
    runId,
    detail,
    progress,
    drafts,
}: StartWorkspaceProps & { drafts: ReturnType<typeof useStartDraft> }) {
    const snapshot = useQuery(api.workbench.snapshot, { runId });
    if (snapshot === undefined)
        return (
            <div
                role="status"
                aria-label="Loading research conversation"
                className="flex min-h-0 flex-1 flex-col gap-6 p-6">
                <Skeleton className="h-12 w-full" />
                <Skeleton className="h-24 w-3/4" />
                <Skeleton className="mt-auto h-64 w-full" />
            </div>
        );
    return (
        <StartWorkspaceContent
            key={runId}
            snapshot={snapshot}
            detail={detail}
            progress={progress}
            drafts={drafts}
        />
    );
}
function StartWorkspaceContent({
    snapshot,
    detail,
    progress,
    drafts,
}: {
    snapshot: Snapshot;
    detail?: "timeline" | "framing";
    progress?: ReactNode;
    drafts: ReturnType<typeof useStartDraft>;
}) {
    const { run, company, framing } = snapshot;
    const runId = run._id;
    const navigate = useNavigate();
    const { isMobile } = useResponsive();
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
    const submit = useMutation(api.execution.conversations.submit),
        remove = useMutation(api.execution.conversations.removeQueued),
        promote = useMutation(api.execution.conversations.promoteQueued),
        stop = useMutation(api.execution.conversations.stopResponse),
        resume = useMutation(api.execution.conversations.resumeQueue);
    const save = useMutation(api.framing.save),
        start = useMutation(api.framing.startResearch);
    const pauseResearch = useMutation(api.execution.researchControl.pause),
        resumeResearch = useMutation(api.execution.researchControl.resume);
    const { draft, setDraft, edit, setEdit, launchKey, delivery } = drafts;
    const [error, setError] = useState<string | null>(null);
    const [saving, setSaving] = useState(false);
    const inputRef = useRef<HTMLTextAreaElement>(null);
    const trigger = useRef<HTMLElement | null>(null);
    const activeTurnId = state?.activeTurn?._id;
    const editKey = edit ? `${edit.kind}:${edit.id ?? ""}` : null;
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
    const send = async (text: string, mode: "queue" | "steer" = "queue") => {
        setError(null);
        if (edit) {
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
                    code === "framing_question_capacity" &&
                        readiness.questionLimit
                        ? questionCapacityCopy(readiness.questionLimit)
                        : "The research program could not be saved. If it changed, cancel this edit and review the latest version before trying again.",
                );
                throw cause;
            } finally {
                setSaving(false);
            }
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
    const queue: Omit<ExternalThreadQueueAdapter, "enqueue" | "steer"> = {
        items: history.results
            .filter((m) => m.status === "queued")
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
    const messages = history.results
        .filter((m) => m.status !== "queued" && m.status !== "removed")
        .slice()
        .reverse();
    const conversation = useWorkbenchConversation({
        messages: messages.map((m) => ({
            id: m._id,
            role: m.role,
            content: m.text,
            createdAt: new Date(m.createdAt),
            metadata: {
                custom: {
                    agentId: m.role === "assistant" ? "workbench" : undefined,
                    responseControl: m.responseControl,
                },
            },
        })),
        draft: edit?.text ?? draft,
        onDraftChange: (text) =>
            edit
                ? setEdit({ ...edit, text, requestKey: crypto.randomUUID() })
                : setDraft(text),
        onSend: send,
        isRunning: running,
        queue: edit ? undefined : queue,
        onStop: activeTurnId
            ? () => stop({ runId, turnId: activeTurnId }).then(() => {})
            : undefined,
    });
    useEffect(() => {
        if (editKey) inputRef.current?.focus();
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
    if (snapshot.activeWork)
        work.set(
            snapshot.activeWork.turn._id,
            workbenchTurn(snapshot.activeWork),
        );
    const captured = snapshot.sources.filter(
        (s) => s.state === "captured",
    ).length;
    const sourcePresentation = sourceMissionPresentation(
        run,
        snapshot.preparation,
    );
    const sourceState = sourcePresentation.state;
    const missions: ConversationMissionSnapshot[] = launched
        ? [
              {
                  id: `sources:${runId}`,
                  agentId: "sources",
                  title: "Documentary preparation",
                  state: sourceState,
                  startedAt: run.researchStartedAt
                      ? new Date(run.researchStartedAt).toISOString()
                      : undefined,
                  operations: [],
                  summary: `${snapshot.sources.length} references · ${captured} captures`,
                  details: (
                      <>
                          <p>{sourcePresentation.detail}</p>
                          <Button
                              variant="outline"
                              size="sm"
                              onClick={() =>
                                  void navigate({
                                      to: "/workspace/$runId",
                                      params: { runId },
                                      search: {
                                          section: "progress",
                                          detail: "timeline",
                                      },
                                  })
                              }>
                              Activity log
                              <Icon iconNode={ArrowRight01Icon} size={16} />
                          </Button>
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
                            className="text-sm text-muted-foreground">
                            Pause requested. The current operation will finish
                            first.
                        </p>
                        <Button
                            variant="ghost"
                            size="sm"
                            onClick={() =>
                                control(
                                    resumeResearch({
                                        runId,
                                        expectedGeneration:
                                            run.executionGeneration,
                                    }),
                                )
                            }>
                            Keep researching
                        </Button>
                    </>
                ) : isResumableResearchPause(run) ? (
                    <Button
                        variant="outline"
                        size="sm"
                        onClick={() =>
                            control(
                                resumeResearch({
                                    runId,
                                    expectedGeneration: run.executionGeneration,
                                }),
                            )
                        }>
                        Resume research
                    </Button>
                ) : run.executionStatus === "running" ? (
                    <Button
                        variant="ghost"
                        size="sm"
                        onClick={() =>
                            control(
                                pauseResearch({
                                    runId,
                                    expectedGeneration: run.executionGeneration,
                                }),
                            )
                        }>
                        Pause research
                    </Button>
                ) : null}
            </div>
        ) : null;
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
                <ConversationHistory
                    entries={[
                        ...messages.map((m) => ({
                            kind: "message" as const,
                            id: m._id,
                            time: m.createdAt,
                        })),
                        ...[...work.values()]
                            .filter(
                                (turn) =>
                                    !turn.entries.some(
                                        (entry) =>
                                            entry.kind === "message" &&
                                            messages.some(
                                                (m) => m._id === entry.id,
                                            ),
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
            )}
            {state?.execution?.status === "blocked" && (
                <LoadErrorAlert
                    variant="inline"
                    title="Response unavailable"
                    description={workbenchFailureCopy(state.execution.code)}
                />
            )}
            {state && state.queuedCount > queue.items.length && (
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
        <ConversationComposer
            inputRef={inputRef}
            onCommand={!edit ? onCommand : undefined}
            availableCommands={[...snapshot.availableCommands, "/model"]}
            onOpenModels={() => setModelPickerOpen(true)}
            controlsOpen={modelPickerOpen}
            modelSelector={
                !edit ? (
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
                edit
                    ? edit.kind === "scope"
                        ? "Edit research scope"
                        : edit.id
                          ? "Edit research question"
                          : "Add research question"
                    : launched
                      ? "Ask about the sources"
                      : "Refine the framing in your own words"
            }
            placeholder={
                edit?.kind === "question" && !edit.id
                    ? "What would you like to investigate?"
                    : undefined
            }
            actionLabel={
                edit
                    ? edit.kind === "scope" || edit.id
                        ? "Save changes"
                        : "Add question"
                    : undefined
            }
            onCancel={
                edit
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
                state.admissionFailure?.code !== "definition_version_conflict"
                    ? () => control(resume({ runId }))
                    : undefined
            }
        />
    );
    const context = (
        <ConversationContext
            title={`${company?.ticker ?? "Company"} · Research`}
            defaultOpen={!launched && !isMobile}
            missions={missions}
            agents={agents}
            activities={[...work.values()].flatMap((t) =>
                t.entries.flatMap((e) =>
                    e.kind === "operation" ? [e.operation] : [],
                ),
            )}
            onChangeScope={!launched ? () => beginEdit("scope") : undefined}
            planSummary={
                <>
                    <span>
                        {framing?.content.scope || "Scope being prepared"}
                    </span>
                    <span className="chat-context-meta">
                        {launched ? "Accepted framing" : "Proposed framing"} ·{" "}
                        {framing?.content.questions.length ?? 0} questions
                    </span>
                </>
            }
            plan={
                <p>
                    {framing?.content.scope ||
                        "Workbench will propose an activity and a research program."}
                </p>
            }
            planAction={
                launched ? (
                    <Button
                        variant="ghost"
                        size="xs"
                        onClick={() =>
                            void navigate({
                                to: "/workspace/$runId",
                                params: { runId },
                                search: {
                                    section: "progress",
                                    detail: "framing",
                                },
                                resetScroll: false,
                            })
                        }>
                        View framing
                    </Button>
                ) : undefined
            }
            outputs={
                <p className="chat-context-empty">
                    No retained analytical outputs yet.
                </p>
            }
            sources={
                snapshot.sources.length ? (
                    snapshot.sources.map((s) => (
                        <ConversationReference
                            key={s.id}
                            title={s.title}
                            description={
                                s.state === "captured"
                                    ? "Retained capture"
                                    : "Research input"
                            }>
                            <a href={s.url} target="_blank" rel="noreferrer">
                                Open original
                            </a>
                            <p>
                                {s.state === "captured"
                                    ? "A capture is retained. Inclusion and factual support remain separate decisions."
                                    : "This reference has not yet been captured."}
                            </p>
                        </ConversationReference>
                    ))
                ) : (
                    <p className="chat-context-empty">
                        No references supplied.
                    </p>
                )
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
            questions={
                framing?.content.questions.map((q, index) => ({
                    ...q,
                    label: `Q${index + 1}`,
                })) ?? []
            }
            composer={composer}
            actionActive={!!edit}
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
                !launched ? (q) => beginEdit("question", q.id) : undefined
            }
            onAddRequest={!launched ? () => beginEdit("question") : undefined}
            onStart={!launched ? () => void launch() : undefined}
            error={undefined}
        />
    );
    const sections = <WorkspaceNavigation runId={runId} section="progress" />;
    if (detail === "timeline")
        return (
            <div className="min-w-0 pb-28 pt-2 sm:pb-36">
                {sections}
                <header className="mb-5 flex flex-col items-start gap-3">
                    <Button
                        variant="outline"
                        size="sm"
                        onClick={() =>
                            void navigate({
                                to: "/workspace/$runId",
                                params: { runId },
                                search: { section: "progress" },
                            })
                        }>
                        <Icon iconNode={ArrowLeft01Icon} size={16} />
                        Back to research
                    </Button>
                    <h1 className="text-section text-2xl">Activity log</h1>
                </header>
                {progress}
            </div>
        );
    return (
        <WorkbenchUiRoot className="flex h-full min-h-0 flex-1 flex-col">
            {launched && <div className="shrink-0 px-4 pt-3">{sections}</div>}
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
                    runtime={conversation.runtime}
                    context={context}
                    conversation={log}
                    conversationComposer={composer}
                    heading={
                        <>
                            <StartSourcesHeader
                                running={sourceState === "running"}
                                label={
                                    sourceState === "running"
                                        ? "// Sources · live"
                                        : sourceState === "paused"
                                          ? "// Sources · paused"
                                          : "// Sources"
                                }
                                title={sourcePresentation.title}
                                onOpenActivity={() =>
                                    void navigate({
                                        to: "/workspace/$runId",
                                        params: { runId },
                                        search: {
                                            section: "progress",
                                            detail: "timeline",
                                        },
                                    })
                                }
                            />
                            {researchControls}
                            {(sourceState === "completed" ||
                                sourceState === "interrupted") && (
                                <p
                                    className="text-sm text-muted-foreground"
                                    role="status">
                                    {sourcePresentation.detail}
                                </p>
                            )}
                        </>
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
                                    highlight: sourceState === "running",
                                },
                                { value: captured, label: "captured" },
                            ]}
                        />
                    }
                    lanes={
                        snapshot.sources.length ? (
                            (["found", "capturing", "captured"] as const).map(
                                (stage) => {
                                    const docs = snapshot.sources.filter(
                                        (s) => s.state === stage,
                                    );
                                    return (
                                        <SourcingLane
                                            key={stage}
                                            state={stage}
                                            active={
                                                stage === "capturing" &&
                                                sourceState === "running"
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
                                },
                            )
                        ) : (
                            <Empty>
                                <EmptyHeader>
                                    <EmptyTitle>
                                        {insufficient
                                            ? "No documentary preparation completed"
                                            : "Preparing source discovery"}
                                    </EmptyTitle>
                                    <EmptyDescription>
                                        {insufficient
                                            ? "Research ended before documentary preparation could proceed."
                                            : "Documents will appear as they are found."}
                                    </EmptyDescription>
                                </EmptyHeader>
                            </Empty>
                        )
                    }
                    notice={
                        insufficient ? (
                            <div className="p-4">
                                <p>
                                    There is not enough public evidence to
                                    continue this research.
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
                            search: { section: "progress" },
                        })
                    }>
                    Back to preparation
                </Button>
            )}
        </WorkbenchUiRoot>
    );
}
