"use client";

import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { CLIENT_PAGE_SIZE } from "@convex/resourcePolicy";
import { ArrowRight01Icon } from "@hugeicons/core-free-icons";
import { usePaginatedQuery, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { type Ref, useLayoutEffect, useRef, useState } from "react";
import { AdminDetailDisclosure } from "@/components/admin/admin-detail-disclosure";
import { AdminListFooter, AdminLoadMore } from "@/components/admin/admin-pager";
import { AdminMarkBadge } from "@/components/admin/admin-status-badge";
import Icon from "@/components/icon";
import { LoadErrorBoundary } from "@/components/load-error-boundary";
import { Button } from "@/components/ui/button";
import {
    Collapsible,
    CollapsibleContent,
    CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
    Empty,
    EmptyDescription,
    EmptyHeader,
    EmptyTitle,
} from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";

type JournalEvent = FunctionReturnType<
    typeof api.adminOperations.listRunJournalEventsPage
>["page"][number];
const eventLabels: Record<string, string> = {
    invocation_started: "Invocation admitted",
    invocation_request_recorded: "Request recorded",
    invocation_reply_recorded: "Reply recorded",
    invocation_returned: "Result retained",
    invocation_output_observed: "Response observed",
    operation_dispatched: "Operation dispatched",
    operation_completed: "Operation completed",
    operation_reused: "Operation result reused",
};

function SnapshotText({
    children,
    ref,
}: {
    children: string;
    ref?: Ref<HTMLPreElement>;
}) {
    return (
        <pre
            ref={ref}
            // biome-ignore lint/a11y/noNoninteractiveTabindex: Bounded snapshots need keyboard scrolling and text selection.
            tabIndex={0}
            className="max-h-80 max-w-full overflow-auto whitespace-pre-wrap break-all rounded-lg bg-muted p-3 font-mono text-xs">
            {children}
        </pre>
    );
}

function FragmentedPayload({
    runId,
    invocationId,
    part,
    contentHash,
}: {
    runId: Id<"researchRuns">;
    invocationId: Id<"agentInvocations">;
    part: "request" | "reply" | "received" | "adopted";
    contentHash?: string;
}) {
    const page = usePaginatedQuery(
        api.adminOperations.listInvocationPayloadFragmentsPage,
        { runId, invocationId, part, ...(contentHash ? { contentHash } : {}) },
        { initialNumItems: CLIENT_PAGE_SIZE.invocationPayloadFragments },
    );
    const container = useRef<HTMLDivElement>(null);
    const snapshot = useRef<HTMLPreElement>(null);
    const pagingHadFocus = useRef(false);
    useLayoutEffect(() => {
        if (page.status === "LoadingMore")
            pagingHadFocus.current =
                container.current?.contains(document.activeElement) ?? false;
        if (
            page.status === "Exhausted" &&
            pagingHadFocus.current &&
            document.activeElement === document.body
        )
            snapshot.current?.focus({ preventScroll: true });
        if (page.status === "Exhausted") pagingHadFocus.current = false;
    }, [page.status]);
    if (page.status === "LoadingFirstPage")
        return <p role="status">Loading snapshot…</p>;
    return (
        <div ref={container} className="space-y-2">
            <p className="text-xs text-muted-foreground">
                {page.status === "Exhausted"
                    ? "Full snapshot loaded"
                    : "More snapshot content available"}
            </p>
            <SnapshotText ref={snapshot}>
                {page.results.map((fragment) => fragment.content).join("")}
            </SnapshotText>
            <AdminLoadMore
                page={page}
                label="Load more snapshot content"
                count={1}
                focusableWhenDisabled
            />
        </div>
    );
}

function Payload({
    runId,
    invocationId,
    part,
}: {
    runId: Id<"researchRuns">;
    invocationId: Id<"agentInvocations">;
    part: "request" | "reply";
}) {
    const result = useQuery(api.adminOperations.readInvocationJournalPayload, {
        runId,
        invocationId,
        part,
    });
    if (!result) return <p role="status">Loading snapshot…</p>;
    if (result.kind === "unavailable")
        return (
            <p className="text-sm text-muted-foreground">
                {result.code === "not_dispatched"
                    ? "Not dispatched"
                    : result.code === "historical_trace"
                      ? "Historical trace · partial journal"
                      : part === "reply"
                        ? "Outcome not recorded · unknown"
                        : "Request not recorded"}
            </p>
        );
    const payload = result.payload;
    return (
        <div className="min-w-0 space-y-2">
            <p className="break-all text-xs text-muted-foreground">
                {payload.sizeBytes.toLocaleString("en")} bytes
                {payload.contentHash ? ` · SHA-256 ${payload.contentHash}` : ""}
            </p>
            {payload.state === "complete" && payload.json !== undefined ? (
                <SnapshotText>{payload.json}</SnapshotText>
            ) : payload.state === "complete" && payload.textId ? (
                <FragmentedPayload
                    runId={runId}
                    invocationId={invocationId}
                    part={part}
                />
            ) : (
                <>
                    <p className="text-sm">Incomplete snapshot</p>
                    <p className="text-sm text-muted-foreground">
                        {payload.code === "attempt_outcome_unknown"
                            ? "Interrupted · outcome unknown"
                            : payload.code === "not_dispatched"
                              ? "Not dispatched"
                              : "Full content unavailable"}
                    </p>
                    <code className="break-all text-xs text-muted-foreground">
                        {payload.code}
                    </code>
                </>
            )}
        </div>
    );
}

function InvocationPayloads({
    runId,
    invocationId,
}: {
    runId: Id<"researchRuns">;
    invocationId: Id<"agentInvocations">;
}) {
    const [part, setPart] = useState<"request" | "reply" | null>(null);
    return (
        <div className="space-y-2">
            {(["request", "reply"] as const).map((value) => (
                <Collapsible
                    key={value}
                    open={part === value}
                    onOpenChange={(open) => setPart(open ? value : null)}>
                    <CollapsibleTrigger
                        render={<Button size="sm" variant="outline" />}>
                        {value === "request"
                            ? "Request snapshot"
                            : "Reply snapshot"}
                    </CollapsibleTrigger>
                    <CollapsibleContent className="min-w-0 pt-2">
                        {part === value ? (
                            <LoadErrorBoundary
                                title="Snapshot unavailable"
                                description="We couldn’t load this snapshot. Try again.">
                                <Payload
                                    runId={runId}
                                    invocationId={invocationId}
                                    part={value}
                                />
                            </LoadErrorBoundary>
                        ) : null}
                    </CollapsibleContent>
                </Collapsible>
            ))}
        </div>
    );
}

function EventDetail({
    runId,
    eventId,
}: {
    runId: Id<"researchRuns">;
    eventId: Id<"agentExecutionEvents">;
}) {
    const detail = useQuery(api.adminOperations.inspectJournalEvent, {
        runId,
        eventId,
        bodyAccess: "separate",
    });
    if (!detail) return <p role="status">Loading event…</p>;
    const { event, invocation, request, providerCall } = detail;
    const structuredResult =
        invocation?.outputJson ??
        (invocation?.output ? undefined : invocation?.receivedOutputJson);
    const structuredReference =
        invocation?.output ??
        (invocation?.outputJson === undefined
            ? invocation?.receivedOutput
            : undefined);
    const received =
        invocation?.receivedOutputJson !== undefined ||
        invocation?.receivedOutput !== undefined;
    return (
        <div className="min-w-0 space-y-3 pt-2 text-sm">
            {invocation ? (
                <>
                    {invocation.provenance === "simulation" ? (
                        <AdminMarkBadge mark="simulation" />
                    ) : null}
                    {!invocation.journalVersion ? (
                        <p>Historical trace · partial journal</p>
                    ) : null}
                    <p>
                        Status: {invocation.status} · Generation{" "}
                        {invocation.generation}
                    </p>
                    {providerCall?.dispatchOutcome === "unknown" ? (
                        <p>Interrupted · outcome unknown</p>
                    ) : received &&
                      invocation.receivedWhileAuthorized === false ? (
                        <p>Response retained · adoption refused</p>
                    ) : received && invocation.status === "started" ? (
                        <p>Response retained · awaiting adoption</p>
                    ) : invocation.status === "started" ? (
                        <p>Outcome not recorded · unknown</p>
                    ) : null}
                    {event.invocationId ? (
                        <InvocationPayloads
                            runId={runId}
                            invocationId={event.invocationId}
                        />
                    ) : null}
                    {structuredResult ? (
                        <AdminDetailDisclosure label="Structured result">
                            <SnapshotText>{structuredResult}</SnapshotText>
                        </AdminDetailDisclosure>
                    ) : structuredReference && event.invocationId ? (
                        <AdminDetailDisclosure label="Structured result">
                            <LoadErrorBoundary
                                title="Snapshot unavailable"
                                description="We couldn’t load this snapshot. Try again.">
                                <FragmentedPayload
                                    runId={runId}
                                    invocationId={event.invocationId}
                                    part={
                                        invocation.output
                                            ? "adopted"
                                            : "received"
                                    }
                                    contentHash={
                                        structuredReference.contentHash
                                    }
                                />
                            </LoadErrorBoundary>
                        </AdminDetailDisclosure>
                    ) : null}
                </>
            ) : null}
            {request ? (
                <AdminDetailDisclosure label="Operation request and result">
                    <SnapshotText>
                        {JSON.stringify(request, null, 2)}
                    </SnapshotText>
                </AdminDetailDisclosure>
            ) : null}
            <AdminDetailDisclosure label="Correlation details">
                <SnapshotText>
                    {JSON.stringify({ event, providerCall }, null, 2)}
                </SnapshotText>
            </AdminDetailDisclosure>
        </div>
    );
}

function JournalEvents({ runId }: { runId: Id<"researchRuns"> }) {
    const events = usePaginatedQuery(
        api.adminOperations.listRunJournalEventsPage,
        { runId },
        { initialNumItems: CLIENT_PAGE_SIZE.adminJournalEvents },
    );
    const [selectedId, setSelectedId] =
        useState<Id<"agentExecutionEvents"> | null>(null);
    if (events.status === "LoadingFirstPage")
        return (
            <div
                role="status"
                aria-label="Loading execution journal"
                aria-busy="true"
                className="space-y-2">
                <Skeleton className="h-12" />
                <Skeleton className="h-12" />
            </div>
        );
    if (!events.results.length)
        return (
            <Empty className="p-4">
                <EmptyHeader>
                    <EmptyTitle>No execution events</EmptyTitle>
                    <EmptyDescription>
                        Older dossiers may have only provider receipts.
                        Historical prompts are not reconstructed.
                    </EmptyDescription>
                </EmptyHeader>
            </Empty>
        );
    return (
        <>
            <ol className="min-w-0 space-y-2">
                {events.results.map((event: JournalEvent) => (
                    <li
                        key={event._id}
                        className="min-w-0 rounded-lg border border-divider">
                        <Collapsible
                            open={selectedId === event._id}
                            onOpenChange={(open) =>
                                setSelectedId(open ? event._id : null)
                            }>
                            <CollapsibleTrigger
                                render={
                                    <Button
                                        variant="ghost"
                                        className="group h-auto w-full justify-start gap-3 rounded-lg px-3 py-2.5 text-left whitespace-normal hover:bg-muted aria-expanded:bg-muted/60"
                                    />
                                }>
                                <Icon
                                    iconNode={ArrowRight01Icon}
                                    className="size-4 shrink-0 text-muted-foreground transition-transform group-aria-expanded:rotate-90 motion-reduce:transition-none"
                                />
                                <span className="min-w-0 flex-1">
                                    <span className="block font-medium">
                                        {eventLabels[event.kind] ??
                                            event.kind.replaceAll("_", " ")}
                                    </span>
                                </span>
                                <span className="shrink-0 text-xs font-normal text-muted-foreground">
                                    {new Date(event.occurredAt).toLocaleString(
                                        "en",
                                        {
                                            dateStyle: "medium",
                                            timeStyle: "medium",
                                        },
                                    )}
                                </span>
                            </CollapsibleTrigger>
                            <CollapsibleContent className="border-t border-divider p-3">
                                {selectedId === event._id ? (
                                    <LoadErrorBoundary
                                        title="Event unavailable"
                                        description="We couldn’t load this event. Try again.">
                                        <EventDetail
                                            runId={runId}
                                            eventId={event._id}
                                        />
                                    </LoadErrorBoundary>
                                ) : null}
                            </CollapsibleContent>
                        </Collapsible>
                    </li>
                ))}
            </ol>
            <AdminListFooter page={events} label="Load more events" />
        </>
    );
}

/** Read-only causal timeline; large snapshots load individually and selection belongs to one dossier. */
export function AdminExecutionJournal({
    runId,
}: {
    runId: Id<"researchRuns">;
}) {
    return (
        <section className="min-w-0 space-y-3" aria-label="Execution journal">
            <h3 className="text-section">Execution journal</h3>
            <p className="text-xs text-muted-foreground">
                Oldest first. Observable requests, replies and operations;
                internal reasoning is excluded.
            </p>
            <LoadErrorBoundary
                key={runId}
                title="Journal unavailable"
                description="We couldn’t load this journal. Try again.">
                <JournalEvents runId={runId} />
            </LoadErrorBoundary>
        </section>
    );
}
