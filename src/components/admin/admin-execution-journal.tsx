"use client";

import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { usePaginatedQuery, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { useState } from "react";
import { AdminDetailDisclosure } from "@/components/admin/admin-detail-disclosure";
import { AdminLoadMore } from "@/components/admin/admin-pager";
import { LoadErrorBoundary } from "@/components/load-error-boundary";
import { Badge } from "@/components/ui/badge";
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

function SnapshotText({ children }: { children: string }) {
    return (
        <pre
            // biome-ignore lint/a11y/noNoninteractiveTabindex: Bounded snapshots need keyboard scrolling and text selection.
            tabIndex={0}
            className="max-h-80 max-w-full overflow-auto whitespace-pre-wrap break-all rounded-lg bg-muted p-3 font-mono text-xs">
            {children}
        </pre>
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
    });
    if (!detail) return <p role="status">Loading event…</p>;
    const { event, invocation, request, providerCall } = detail;
    const structuredResult =
        invocation?.outputJson ?? invocation?.receivedOutputJson;
    return (
        <div className="min-w-0 space-y-3 pt-2 text-sm">
            {invocation ? (
                <>
                    {invocation.provenance === "simulation" ? (
                        <Badge>Simulation · Not live</Badge>
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
                    ) : invocation.receivedOutputJson &&
                      invocation.receivedWhileAuthorized === false ? (
                        <p>Response retained · adoption refused</p>
                    ) : invocation.receivedOutputJson &&
                      invocation.status === "started" ? (
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
        { initialNumItems: 20 },
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
                        className="min-w-0 rounded-lg border p-3">
                        <Collapsible
                            open={selectedId === event._id}
                            onOpenChange={(open) =>
                                setSelectedId(open ? event._id : null)
                            }>
                            <CollapsibleTrigger
                                render={
                                    <Button
                                        variant="ghost"
                                        className="h-auto w-full justify-start whitespace-normal text-left"
                                    />
                                }>
                                <span className="min-w-0">
                                    <span className="block">
                                        {eventLabels[event.kind] ??
                                            event.kind.replaceAll("_", " ")}
                                    </span>
                                    <span className="text-xs font-normal text-muted-foreground">
                                        {new Date(
                                            event.occurredAt,
                                        ).toLocaleString("en")}
                                    </span>
                                </span>
                            </CollapsibleTrigger>
                            <CollapsibleContent>
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
            <AdminLoadMore page={events} label="Load more events" />
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
