import type { Id } from "@convex/_generated/dataModel";
import { Link } from "@tanstack/react-router";
import { useId } from "react";
import {
    Tooltip,
    TooltipContent,
    TooltipTrigger,
} from "@/components/ui/tooltip";
import {
    type WorkspaceSection,
    type WorkspaceSubsection,
    workspaceSections,
} from "@/lib/workspace/navigation";

const investigationTabs = [
    ["questions", "Questions"],
    ["hypotheses", "Hypotheses"],
    ["requests", "Requests"],
    ["review", "Review"],
] as const;
const synthesisTabs = [
    ["mechanism", "Mechanism"],
    ["full-brief", "Full brief"],
] as const;

/** Durable workspace destinations; unavailable missions never imply unfinished analytical work. */
export function WorkspaceNavigation({
    runId,
    section,
    subsection,
}: {
    runId: Id<"researchRuns">;
    section: WorkspaceSection;
    subsection?: WorkspaceSubsection;
}) {
    const id = useId();
    const subTabs =
        section === "investigation"
            ? investigationTabs
            : section === "synthesis"
              ? synthesisTabs
              : [];
    return (
        <div className="flex min-w-0 flex-wrap items-center justify-between gap-3 pb-5">
            <nav
                aria-label="Research workspace sections"
                className="max-w-full overflow-x-auto p-0.5">
                <div className="segment-track">
                    {workspaceSections.map((item) =>
                        item.unavailable ? (
                            <Tooltip key={item.key}>
                                <TooltipTrigger
                                    render={
                                        <button
                                            type="button"
                                            aria-disabled="true"
                                            aria-current={
                                                section === item.key
                                                    ? "page"
                                                    : undefined
                                            }
                                            aria-describedby={`${id}-${item.key}`}
                                            className="segment-item"
                                        />
                                    }>
                                    {section === item.key ? (
                                        <span
                                            aria-hidden="true"
                                            className="text-brand-purple tracking-[-.06em]">
                                            {"//"}
                                        </span>
                                    ) : null}
                                    {item.label}
                                </TooltipTrigger>
                                <span
                                    id={`${id}-${item.key}`}
                                    className="sr-only">
                                    {item.unavailable}
                                </span>
                                <TooltipContent>
                                    {item.unavailable}
                                </TooltipContent>
                            </Tooltip>
                        ) : (
                            <Link
                                key={item.key}
                                to="/workspace/$runId"
                                params={{ runId }}
                                search={{ section: item.key }}
                                aria-current={
                                    section === item.key ? "page" : undefined
                                }
                                className="segment-item">
                                {section === item.key ? (
                                    <span
                                        aria-hidden="true"
                                        className="text-brand-purple tracking-[-.06em]">
                                        {"//"}
                                    </span>
                                ) : null}
                                {item.label}
                            </Link>
                        ),
                    )}
                </div>
            </nav>
            {subTabs.length > 0 ? (
                <nav
                    aria-label={
                        section === "investigation"
                            ? "Investigation sections"
                            : "Synthesis sections"
                    }
                    className="max-w-full overflow-x-auto p-0.5">
                    <div className="segment-track">
                        {subTabs.map(([key, label]) => (
                            <span
                                key={key}
                                className="segment-item"
                                aria-current={
                                    subsection === key ? "page" : undefined
                                }>
                                {label}
                            </span>
                        ))}
                    </div>
                </nav>
            ) : null}
        </div>
    );
}
