import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { useState } from "react";
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
import { WorkbenchIcon } from "@/components/workbench-ui/glyphs";
import { eventLabel, lifecycleLabel } from "@/lib/presentation/research-copy";

type RunEvents = FunctionReturnType<typeof api.researchRuns.listMyEvents>;

/** The recorded steps of a dossier, oldest first; it renders persisted events only. */
export function RunHistory({ events }: { events: RunEvents }) {
    if (events.length === 0)
        return (
            <Empty className="surface-panel min-h-40 p-6">
                <EmptyHeader>
                    <EmptyTitle>No progress events yet</EmptyTitle>
                    <EmptyDescription>
                        Updates will appear here after the research run starts.
                    </EmptyDescription>
                </EmptyHeader>
            </Empty>
        );
    return (
        <ol className="space-y-2">
            {events.map((event) => (
                <li
                    key={event._id}
                    className="border-l border-border/70 py-1 pl-4 text-sm">
                    <span className="font-medium">
                        {lifecycleLabel(event.lifecycleState)}
                    </span>
                    <span className="ml-2 text-xs text-muted-foreground">
                        {eventLabel(event.type)}
                    </span>
                </li>
            ))}
        </ol>
    );
}

/** History in the Progress stage panel; events load only once it is opened. */
export function RunHistoryDisclosure({
    runId,
    defaultOpen = false,
}: {
    runId: Id<"researchRuns">;
    /** Opens History on arrival, as old timeline links do. */
    defaultOpen?: boolean;
}) {
    const [open, setOpen] = useState(defaultOpen);
    const events = useQuery(
        api.researchRuns.listMyEvents,
        open ? { runId } : "skip",
    );
    return (
        <Collapsible
            open={open}
            onOpenChange={setOpen}
            className="border-t border-border">
            <CollapsibleTrigger
                render={
                    <Button
                        variant="ghost"
                        className="h-auto w-full justify-start gap-2 rounded-[10px] px-1 py-3 text-sm font-medium [&[data-panel-open]_[data-chevron]]:rotate-90"
                    />
                }>
                <span
                    data-chevron
                    className="inline-flex text-muted-foreground transition-transform duration-200 motion-reduce:transition-none">
                    <WorkbenchIcon name="chevron" size={14} strokeWidth={2} />
                </span>
                History
                {events && (
                    <span className="font-normal text-muted-foreground">
                        · {events.length}{" "}
                        {events.length === 1
                            ? "recorded step"
                            : "recorded steps"}
                    </span>
                )}
            </CollapsibleTrigger>
            <CollapsibleContent className="px-1 pb-4">
                {events === undefined ? (
                    <div
                        role="status"
                        aria-label="Loading history"
                        aria-busy="true"
                        className="space-y-2">
                        {[0, 1, 2].map((row) => (
                            <Skeleton
                                key={row}
                                className="h-6 w-64 rounded-md"
                            />
                        ))}
                    </div>
                ) : (
                    <RunHistory events={events} />
                )}
            </CollapsibleContent>
        </Collapsible>
    );
}
