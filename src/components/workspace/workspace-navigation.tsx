import type { Id } from "@convex/_generated/dataModel";
import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { WorkspaceDock } from "@/components/workspace/workspace-dock";
import { useResponsive } from "@/hooks/use-responsive";
import { cn } from "@/lib/utils";
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
    actions,
}: {
    runId: Id<"researchRuns">;
    section: WorkspaceSection;
    subsection?: WorkspaceSubsection;
    /** Workspace-wide controls at the bar's end, such as the evidence inventory. */
    actions?: ReactNode;
}) {
    // On phones only the current section keeps its label, so the dock fits one row.
    const { isMobile } = useResponsive();
    const subTabs =
        section === "investigation"
            ? investigationTabs
            : section === "synthesis"
              ? synthesisTabs
              : [];
    return (
        <div
            data-workspace-bar
            className={cn(
                "flex min-w-0 flex-wrap items-center justify-between gap-3 pb-5",
                isMobile && "w-full",
            )}>
            <WorkspaceDock
                compact={isMobile}
                actions={actions}
                sections={workspaceSections.map((item) => ({
                    key: item.key,
                    label: item.label,
                    current: section === item.key,
                    unavailable: item.unavailable,
                    render: (
                        <Link
                            to="/workspace/$runId"
                            params={{ runId }}
                            search={{ section: item.key }}
                        />
                    ),
                }))}
            />
            {subTabs.length > 0 ? (
                <nav
                    aria-label={
                        section === "investigation"
                            ? "Investigation sections"
                            : "Synthesis sections"
                    }
                    className="segment-scroll">
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
