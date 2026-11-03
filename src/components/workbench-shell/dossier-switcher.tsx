import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import {
    ArrowDown01Icon,
    ArrowRight01Icon,
    XIcon,
} from "@hugeicons/core-free-icons";
import { Link, useNavigate } from "@tanstack/react-router";
import { useAction, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import type { ReactNode } from "react";
import { useEffect, useRef, useState } from "react";
import { CompanyFaviconAvatar } from "@/components/company-favicon-avatar";
import Icon from "@/components/icon";
import { LoadErrorBoundary } from "@/components/load-error-boundary";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { SmoothDropdwon } from "@/components/ui/smooth-dropdown";
import { useWorkspaceDossiers } from "@/hooks/use-workspace-dossiers";
import {
    dossierStatus,
    lifecycleLabel,
} from "@/lib/presentation/research-copy";
import { cn } from "@/lib/utils";
import { NewDossierButton } from "./new-dossier-button";

type Props = {
    activeRunId?: string;
    enabled?: boolean;
    isAdmissionLoading?: boolean;
    className?: string;
};
/** One dossier context on every viewport; selection never mutates research state. */
export function DossierSwitcher(props: Props) {
    return (
        <LoadErrorBoundary
            title="Research dossiers are temporarily unavailable"
            description="The dossier navigation could not be loaded."
            retryLabel="Retry"
            variant="compact"
            className={props.className}>
            <DossierSwitcherContent {...props} />
        </LoadErrorBoundary>
    );
}
function DossierSwitcherContent({
    activeRunId,
    enabled = true,
    isAdmissionLoading = false,
    className,
}: Props) {
    const navigate = useNavigate();
    const [input, setInput] = useState("");
    const [search, setSearch] = useState("");
    useEffect(() => {
        const timer = setTimeout(() => setSearch(input), 200);
        return () => clearTimeout(timer);
    }, [input]);
    const { results, workspace, isLoading, status, loadMore } =
        useWorkspaceDossiers(enabled, search);
    const active = useQuery(
        api.researchRuns.getMine,
        enabled && activeRunId
            ? { runId: activeRunId as Id<"researchRuns"> }
            : "skip",
    );
    const backfill = useAction(api.companyResolution.ensureRunCompanyWebsite);
    const requested = useRef(new Set<string>());
    useEffect(() => {
        if (
            !enabled ||
            isAdmissionLoading ||
            isLoading ||
            workspace?.isTestData
        )
            return;
        const run = results.find(
            (run) =>
                run.company &&
                !run.company.websiteUrl &&
                !requested.current.has(run.runId),
        );
        if (run) {
            requested.current.add(run.runId);
            void backfill({ runId: run.runId }).catch(() => {
                /* Company recognition keeps its existing fallback when enrichment is unavailable. */
            });
        }
    }, [
        results,
        enabled,
        isAdmissionLoading,
        isLoading,
        workspace?.isTestData,
        backfill,
    ]);
    if (!enabled) return null;
    return (
        <DossierSwitcherView
            results={results}
            active={active}
            activeRunId={activeRunId}
            input={input}
            onInputChange={setInput}
            pending={isLoading || input !== search}
            loadingContext={
                isAdmissionLoading ||
                (!input && isLoading && !active) ||
                Boolean(activeRunId && active === undefined)
            }
            searching={Boolean(search)}
            status={status}
            loadMore={() => loadMore(12)}
            className={className}
            onSelect={(runId) => {
                if (runId !== activeRunId)
                    void navigate({
                        to: "/workspace/$runId",
                        params: { runId },
                        search: { section: "progress" },
                    });
            }}
            actions={
                <>
                    {workspace?.canStartDossier && (
                        <NewDossierButton variant="link" />
                    )}
                    <Button
                        render={<Link to="/workspace/dossiers" />}
                        nativeButton={false}
                        variant="link"
                        size="sm"
                        className="ml-auto gap-1 px-1 text-primary">
                        All dossiers{" "}
                        <Icon iconNode={ArrowRight01Icon} size={14} />
                    </Button>
                </>
            }
        />
    );
}

type Dossier = FunctionReturnType<
    typeof api.researchRuns.listMine
>["page"][number];
/** Shared responsive selection surface; its consumer owns queries and navigation. */
export function DossierSwitcherView({
    results,
    active,
    activeRunId,
    input,
    onInputChange,
    pending,
    loadingContext,
    searching,
    status,
    loadMore,
    className,
    onSelect,
    actions,
}: {
    results: Dossier[];
    active?: Dossier | null;
    activeRunId?: string;
    input: string;
    onInputChange: (value: string) => void;
    pending: boolean;
    loadingContext: boolean;
    searching: boolean;
    status: string;
    loadMore: () => void;
    className?: string;
    onSelect: (runId: Dossier["runId"]) => void;
    actions: ReactNode;
}) {
    const [open, setOpen] = useState(false);
    const host = useRef<HTMLDivElement>(null);
    const [closedWidth, setClosedWidth] = useState(140);
    const hasActive = Boolean(active);
    useEffect(() => {
        const node = host.current;
        if (!node) return;
        const measure = () => {
            if (node.clientWidth)
                setClosedWidth(
                    Math.min(hasActive ? 448 : 140, node.clientWidth),
                );
        };
        measure();
        const observer = new ResizeObserver(measure);
        observer.observe(node);
        return () => observer.disconnect();
    }, [hasActive]);
    const badge = active ? dossierStatus(active) : null;
    return (
        <div ref={host} className={cn("min-w-0", className)}>
            <SmoothDropdwon
                open={open}
                onOpenChange={setOpen}
                portalContainer={
                    typeof document !== "undefined" ? document.body : null
                }
                closedWidth={closedWidth}
                closedHeight={36}
                closedRadius={0}
                openWidth={520}
                activeItemId={activeRunId}
                triggerAriaLabel="Switch research dossier"
                triggerClassName={cn(
                    "border-accent-foreground/50",
                    open ? "rounded-t-xl!" : "",
                )}
                itemsAriaLabel="Research dossiers"
                menuClassName="[&_[role=listbox]]:max-h-[min(26rem,45dvh)] [&_[role=listbox]]:overflow-y-auto [&_[role=option]>span]:min-w-0 [&_[role=option]]:pr-2"
                trigger={
                    <span className="flex w-full min-w-0 items-center gap-2 px-3 text-sm">
                        {loadingContext ? (
                            <span
                                role="status"
                                aria-label="Loading research dossiers"
                                aria-busy="true">
                                <Skeleton className="h-5 w-36" />
                            </span>
                        ) : (
                            <>
                                {active?.company && (
                                    <CompanyFaviconAvatar
                                        company={active.company}
                                        size="xs"
                                    />
                                )}
                                <span className="min-w-0 max-w-[34ch] flex-1 truncate text-left md:max-w-80">
                                    {active
                                        ? `${active.company?.legalName ?? "Research dossier"} · ${active.framingScope ?? active.researchAngle ?? "Scope being prepared"}`
                                        : "Recent Dossiers"}
                                </span>
                                {badge && (
                                    <Badge
                                        tone={badge.tone}
                                        showDot={
                                            badge.running ? "running" : false
                                        }>
                                        {badge.label}
                                    </Badge>
                                )}
                            </>
                        )}
                        <Icon
                            iconNode={ArrowDown01Icon}
                            size={14}
                            className="shrink-0"
                        />
                    </span>
                }
                header={
                    <div className="space-y-2">
                        <div className="flex justify-between items-center px-2 py-1">
                            <p className="text-sm font-medium text-muted-foreground">
                                {searching
                                    ? "Matching dossiers"
                                    : "Recent dossiers"}
                            </p>
                            <button
                                type="button"
                                onClick={() => setOpen(false)}
                                className="text-muted-foreground hover:text-foreground">
                                <Icon iconNode={XIcon} size={20} />
                            </button>
                        </div>
                        <Input
                            aria-label="Find a dossier"
                            placeholder="Find a dossier…"
                            maxLength={200}
                            value={input}
                            onChange={(event) =>
                                onInputChange(event.target.value)
                            }
                        />
                        {pending && (
                            <div
                                role="status"
                                aria-label="Loading dossiers"
                                className="p-2">
                                <Skeleton className="h-16 w-full" />
                            </div>
                        )}
                    </div>
                }
                items={
                    pending
                        ? []
                        : results.map((run) => ({
                              id: run.runId,
                              label: `${run.company?.legalName ?? "Research dossier"} ${run.framingScope ?? run.researchAngle ?? ""}`,
                              onSelect: () => onSelect(run.runId),
                              renderLabel: () => {
                                  const state = dossierStatus(run);
                                  return (
                                      <div className="flex min-w-0 flex-1 items-start gap-3">
                                          {run.company && (
                                              <CompanyFaviconAvatar
                                                  company={run.company}
                                                  size="xs"
                                              />
                                          )}
                                          <div className="min-w-0 flex-1">
                                              <div className="flex items-start justify-between gap-3">
                                                  <span className="min-w-0 font-medium">
                                                      {run.company?.legalName ??
                                                          "Research dossier"}
                                                  </span>
                                                  <time
                                                      dateTime={new Date(
                                                          run.updatedAt,
                                                      ).toISOString()}
                                                      className="shrink-0 text-xs font-normal text-muted-foreground">
                                                      {new Intl.DateTimeFormat(
                                                          "en",
                                                          {
                                                              dateStyle:
                                                                  "medium",
                                                          },
                                                      ).format(run.updatedAt)}
                                                  </time>
                                              </div>
                                              <p className="mt-1 text-sm whitespace-normal font-normal">
                                                  {run.framingScope ??
                                                      run.researchAngle ??
                                                      "Scope being prepared"}
                                              </p>
                                              <div className="mt-2 flex flex-wrap items-center gap-2">
                                                  <Badge
                                                      tone={state.tone}
                                                      showDot={
                                                          state.running
                                                              ? "running"
                                                              : false
                                                      }>
                                                      {state.label}
                                                  </Badge>
                                                  {run.lifecycleState !==
                                                      "framing" ||
                                                  state.label !== "Framing" ? (
                                                      <Badge tone="ink">
                                                          {lifecycleLabel(
                                                              run.lifecycleState,
                                                          )}
                                                      </Badge>
                                                  ) : null}
                                              </div>
                                              {run.runId === activeRunId && (
                                                  <span className="sr-only">
                                                      Current dossier
                                                  </span>
                                              )}
                                          </div>
                                      </div>
                                  );
                              },
                          }))
                }
                footer={
                    <>
                        {!pending && !results.length && (
                            <p
                                role="status"
                                className="p-3 text-sm text-muted-foreground">
                                {status === "Exhausted"
                                    ? searching
                                        ? "No matching dossiers."
                                        : "No research dossiers yet."
                                    : "Continue searching to examine more dossiers."}
                            </p>
                        )}
                        {(status === "CanLoadMore" ||
                            status === "LoadingMore") && (
                            <Button
                                variant="ghost"
                                size="sm"
                                disabled={status === "LoadingMore"}
                                onClick={loadMore}>
                                {status === "LoadingMore"
                                    ? "Loading…"
                                    : "Load more"}
                            </Button>
                        )}
                        <div className="mt-2 flex items-center justify-between gap-2 border-t border-divider bg-fill-quiet px-3 py-2">
                            {actions}
                        </div>
                    </>
                }
            />
        </div>
    );
}
