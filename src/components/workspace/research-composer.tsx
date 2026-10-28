"use client";

import { api } from "@convex/_generated/api";
import {
    ArrowLeft01Icon,
    ArrowRight01Icon,
    Plus,
} from "@hugeicons/core-free-icons";
import { useNavigate } from "@tanstack/react-router";
import { useAction, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useRef, useState } from "react";
import Icon from "@/components/icon";
import { LoadErrorBoundary } from "@/components/load-error-boundary";
import { PaginationControls } from "@/components/pagination-controls";
import { Button } from "@/components/ui/button";
import { LoadErrorAlert } from "@/components/ui/load-error-alert";
import { SmoothDropdwon } from "@/components/ui/smooth-dropdown";
import { AddSourceDialog } from "@/components/workspace/add-source-dialog";
import { CompanyResolutionCard } from "@/components/workspace/company-resolution-card";
import {
    MoreOptionsButton,
    ToolbarIconButton,
} from "@/components/workspace/composer-toolbar-actions";
import {
    type CoveragePreset,
    CoveragePresetPicker,
} from "@/components/workspace/coverage-preset-picker";
import { useInvitationAccess } from "@/components/workspace/invitation-access-context";
import {
    CompanyCandidateLabel,
    CompanyContextBadge,
    CompanyLookup,
    CompanyPickerTrigger,
    ResearchComposerToolbar,
    ResearchComposerView,
} from "@/components/workspace/start/research-composer-view";
import { useAnonymousSession } from "@/hooks/use-anonymous-session";
import { usePagination } from "@/hooks/use-pagination";
import { useResponsive } from "@/hooks/use-responsive";
import {
    companyLookupErrorMessage,
    sourceAddErrorMessage,
} from "@/lib/presentation/research-copy";
import { cn } from "@/lib/utils";

type PreflightResult = FunctionReturnType<
    typeof api.companyResolution.preflight
>;
type CompanyCandidate = FunctionReturnType<
    typeof api.companyResolution.search
>[number];
type ManualSourceResult = FunctionReturnType<
    typeof api.sourceActions.submitManualUrl
>;
type PreparedManualSource = Extract<ManualSourceResult, { kind: "prepared" }>;

const viewEnterTransition = {
    type: "spring" as const,
    stiffness: 360,
    damping: 30,
    mass: 0.8,
};
const viewExitTransition = {
    duration: 0.14,
    ease: [0.32, 0.72, 0, 1] as const,
};

const COMPANY_SEARCH_PAGE_SIZE = 5;
const COMPANY_SEARCH_RESULT_LIMIT = 40;

export interface ResearchComposerProps {
    className?: string;
    placeholderText?: string;
}

/**
 * Preserves the established research composer while owning the real two-step
 * company resolution and launch boundary.
 */
export function ResearchComposer({
    className,
    placeholderText,
}: ResearchComposerProps) {
    const { isSessionReady, sessionError, retrySession } =
        useAnonymousSession();

    if (sessionError) {
        return (
            <LoadErrorAlert
                className={className}
                title="Research workspace unavailable"
                description="We couldn’t prepare your research workspace."
                onRetry={retrySession}
            />
        );
    }

    return (
        <ResearchComposerContent
            className={className}
            placeholderText={placeholderText}
            isSessionReady={isSessionReady}
        />
    );
}

function ResearchComposerContent({
    className,
    placeholderText = "How can I help? Describe the resilience question to investigate.",
    isSessionReady,
}: ResearchComposerProps & { isSessionReady: boolean }) {
    const navigate = useNavigate();
    const searchCompanies = useAction(api.companyResolution.search);
    const preflight = useAction(api.companyResolution.preflight);
    const confirmAndStart = useAction(api.researchLaunch.confirmAndStart);
    const submitManualUrl = useAction(api.sourceActions.submitManualUrl);
    const reduceMotion = useReducedMotion();
    const [researchAngle, setResearchAngle] = useState("");
    const [companyQuery, setCompanyQuery] = useState("");
    const [coveragePreset, setCoveragePreset] =
        useState<CoveragePreset>("balanced");
    const [resolution, setResolution] = useState<PreflightResult | null>(null);
    const [companyCandidates, setCompanyCandidates] = useState<
        Array<CompanyCandidate>
    >([]);
    const [companySearchRevision, setCompanySearchRevision] = useState(0);
    const {
        page: companyPage,
        pageCount: companyPageCount,
        pageItems: visibleCompanyCandidates,
        setPage: setCompanyPage,
    } = usePagination({
        items: companyCandidates,
        pageSize: COMPANY_SEARCH_PAGE_SIZE,
        resetKey: `${companyQuery}:${companySearchRevision}`,
    });
    const { isMobile } = useResponsive();
    const [hasSearched, setHasSearched] = useState(false);
    const [view, setView] = useState<"compose" | "confirm">("compose");
    const [pickerOpen, setPickerOpen] = useState(false);
    const [isSearching, setIsSearching] = useState(false);
    const [selectingCik, setSelectingCik] = useState<string | null>(null);
    const [isLaunching, setIsLaunching] = useState(false);
    const [lookupError, setLookupError] = useState<string | null>(null);
    const [launchError, setLaunchError] = useState<string | null>(null);
    const [referencesOpen, setReferencesOpen] = useState(false);
    const [manualSources, setManualSources] = useState<
        Array<PreparedManualSource>
    >([]);
    const launchKey = useRef<string | null>(null);

    const searchForCompanies = async () => {
        if (!isSessionReady) {
            setLookupError("Preparing your research workspace…");
            setPickerOpen(true);
            return;
        }

        const query = companyQuery.trim();
        if (!query) {
            setLookupError("Enter a company name, ticker, CIK, or SEC URL.");
            setPickerOpen(true);
            return;
        }

        setLookupError(null);
        setLaunchError(null);
        setIsSearching(true);
        setHasSearched(false);
        setCompanySearchRevision((revision) => revision + 1);

        try {
            const results = await searchCompanies({ query });
            setCompanyCandidates([...results]);
            setHasSearched(true);
            setPickerOpen(true);
        } catch {
            setCompanyCandidates([]);
            setLookupError("We couldn't search for companies. Try again.");
            setHasSearched(true);
        } finally {
            setIsSearching(false);
        }
    };

    const selectCompany = async (candidate: CompanyCandidate) => {
        if (selectingCik) {
            return;
        }
        setLookupError(null);
        setSelectingCik(candidate.cik);
        try {
            const result = await preflight({ cik: candidate.cik });
            setResolution(result);
            setPickerOpen(false);
            launchKey.current = null;
        } catch (error) {
            setLookupError(companyLookupErrorMessage(error));
            setPickerOpen(true);
        } finally {
            setSelectingCik(null);
        }
    };

    const clearResolution = () => {
        setResolution(null);
        setCompanyQuery("");
        setCompanyCandidates([]);
        setCompanySearchRevision((revision) => revision + 1);
        setHasSearched(false);
        setView("compose");
        setLookupError(null);
        setLaunchError(null);
        launchKey.current = null;
    };

    const startResearch = async () => {
        if (!resolution || isLaunching) {
            if (!resolution) {
                setPickerOpen(true);
            }
            return;
        }

        setIsLaunching(true);
        setLaunchError(null);
        launchKey.current ??= crypto.randomUUID();

        try {
            const result = await confirmAndStart({
                preflightId: resolution.preflightId,
                idempotencyKey: launchKey.current,
                coveragePreset,
                researchAngle: researchAngle.trim() || undefined,
                manualSourcePreparationIds:
                    manualSources.length > 0
                        ? manualSources.map(
                              ({ preparationId }) => preparationId,
                          )
                        : undefined,
            });
            await navigate({
                to: "/workspace/$runId",
                params: { runId: result.runId },
                search: { section: "progress" },
            });
        } catch (error) {
            const sourceErrorMessage = sourceAddErrorMessage(error);
            setLaunchError(
                sourceErrorMessage === "We couldn't add that source. Try again."
                    ? "We couldn't start this research dossier. Try again."
                    : sourceErrorMessage,
            );
            setIsLaunching(false);
        }
    };

    return (
        <>
            <section
                className={cn(
                    "@container/research-composer w-full overflow-visible",
                    className,
                )}
                aria-label="Research launch">
                <AnimatePresence initial={false} mode="wait">
                    {view === "compose" ? (
                        <motion.div
                            key="compose"
                            className="rounded-2xl bg-card shadow-raised"
                            initial={
                                reduceMotion
                                    ? false
                                    : { opacity: 0, scale: 0.97 }
                            }
                            animate={{ opacity: 1, scale: 1 }}
                            exit={
                                reduceMotion
                                    ? {
                                          opacity: 1,
                                          transition: { duration: 0 },
                                      }
                                    : {
                                          opacity: 0,
                                          scale: 0.985,
                                          transition: viewExitTransition,
                                      }
                            }
                            transition={
                                reduceMotion
                                    ? { duration: 0 }
                                    : viewEnterTransition
                            }
                            style={{ transformOrigin: "50% 45%" }}>
                            <ResearchComposerView
                                id="research-angle"
                                value={researchAngle}
                                onValueChange={setResearchAngle}
                                placeholder={placeholderText}
                                companyAdornment={
                                    resolution ? (
                                        <CompanyContextBadge
                                            company={resolution.company}
                                            onRemove={clearResolution}
                                        />
                                    ) : undefined
                                }
                                toolbar={
                                    <ResearchComposerToolbar
                                        tools={
                                            <>
                                                <SmoothDropdwon
                                                    items={visibleCompanyCandidates.map(
                                                        (candidate) => ({
                                                            id: `${candidate.cik}-${candidate.ticker}`,
                                                            label: `${candidate.legalName} ${candidate.ticker} ${candidate.exchange} CIK ${candidate.cik}`,
                                                            closeOnSelect: false,
                                                            onSelect: () =>
                                                                void selectCompany(
                                                                    candidate,
                                                                ),
                                                            renderLabel: () => (
                                                                <CompanyCandidateLabel
                                                                    company={
                                                                        candidate
                                                                    }
                                                                    selecting={
                                                                        selectingCik ===
                                                                        candidate.cik
                                                                    }
                                                                />
                                                            ),
                                                        }),
                                                    )}
                                                    open={pickerOpen}
                                                    onOpenChange={setPickerOpen}
                                                    openWidth={
                                                        isMobile ? 300 : 400
                                                    }
                                                    closedWidth={215}
                                                    closedHeight={36}
                                                    itemsAriaLabel="Company search results"
                                                    className={cn(
                                                        "min-w-0 max-w-[calc(100cqw-10.25rem)] [&:not([data-open])>div]:max-w-full",
                                                        pickerOpen && "z-10",
                                                    )}
                                                    trigger={
                                                        <CompanyPickerTrigger
                                                            label={
                                                                resolution
                                                                    ? resolution
                                                                          .company
                                                                          .legalName
                                                                    : "Company to investigate"
                                                            }
                                                            ticker={
                                                                resolution
                                                                    ?.company
                                                                    .ticker
                                                            }
                                                            highlighted={
                                                                resolution !==
                                                                null
                                                            }
                                                        />
                                                    }
                                                    header={
                                                        <CompanyLookup
                                                            companyQuery={
                                                                companyQuery
                                                            }
                                                            isSearching={
                                                                isSearching
                                                            }
                                                            lookupError={
                                                                lookupError
                                                            }
                                                            hasResolution={
                                                                resolution !==
                                                                null
                                                            }
                                                            hasSearched={
                                                                hasSearched
                                                            }
                                                            resultCount={
                                                                companyCandidates.length
                                                            }
                                                            onCompanyQueryChange={(
                                                                next,
                                                            ) => {
                                                                setCompanyQuery(
                                                                    next,
                                                                );
                                                                setHasSearched(
                                                                    false,
                                                                );
                                                                setCompanyCandidates(
                                                                    [],
                                                                );
                                                                setLookupError(
                                                                    null,
                                                                );
                                                            }}
                                                            onClear={
                                                                clearResolution
                                                            }
                                                            onSearch={() =>
                                                                void searchForCompanies()
                                                            }
                                                            sessionReady={
                                                                isSessionReady
                                                            }
                                                        />
                                                    }
                                                    footer={
                                                        companyCandidates.length >
                                                        0 ? (
                                                            <CompanyPaginationFooter
                                                                page={
                                                                    companyPage
                                                                }
                                                                pageCount={
                                                                    companyPageCount
                                                                }
                                                                resultCount={
                                                                    companyCandidates.length
                                                                }
                                                                disabled={
                                                                    isSearching ||
                                                                    selectingCik !==
                                                                        null
                                                                }
                                                                onPageChange={
                                                                    setCompanyPage
                                                                }
                                                            />
                                                        ) : null
                                                    }
                                                />
                                                <ToolbarIconButton
                                                    label="Attach references"
                                                    icon={Plus}
                                                    count={manualSources.length}
                                                    onClick={() =>
                                                        setReferencesOpen(true)
                                                    }
                                                />
                                                <MoreOptionsButton />
                                            </>
                                        }
                                        action={
                                            <Button
                                                type="button"
                                                aria-label={
                                                    resolution
                                                        ? "Continue"
                                                        : "Send request"
                                                }
                                                onClick={() =>
                                                    resolution
                                                        ? setView("confirm")
                                                        : setPickerOpen(true)
                                                }
                                                variant="round"
                                                className="size-10">
                                                <Icon
                                                    iconNode={ArrowRight01Icon}
                                                    size={18}
                                                />
                                            </Button>
                                        }
                                    />
                                }
                            />
                        </motion.div>
                    ) : resolution ? (
                        <motion.div
                            key="confirm"
                            className="rounded-b-2xl space-y-5 bg-tint-violet/40 px-4 py-5"
                            initial={
                                reduceMotion
                                    ? false
                                    : { opacity: 0, scale: 0.96 }
                            }
                            animate={{ opacity: 1, scale: 1 }}
                            exit={
                                reduceMotion
                                    ? {
                                          opacity: 1,
                                          transition: { duration: 0 },
                                      }
                                    : {
                                          opacity: 0,
                                          scale: 0.985,
                                          transition: viewExitTransition,
                                      }
                            }
                            transition={
                                reduceMotion
                                    ? { duration: 0 }
                                    : viewEnterTransition
                            }
                            style={{ transformOrigin: "50% 45%" }}>
                            <CompanyResolutionCard
                                company={resolution.company}
                            />
                            <CoveragePresetPicker
                                value={coveragePreset}
                                onChange={setCoveragePreset}
                            />
                            {launchError ? (
                                <p
                                    role="alert"
                                    className="text-sm text-destructive">
                                    {launchError}
                                </p>
                            ) : null}
                            <div className="flex items-center justify-between gap-3 border-t border-border/40 pt-4">
                                <Button
                                    type="button"
                                    variant="ghost"
                                    onClick={() => setView("compose")}
                                    disabled={isLaunching}>
                                    <Icon iconNode={ArrowLeft01Icon} />
                                    Back
                                </Button>
                                <LoadErrorBoundary
                                    title="Workspace access unavailable"
                                    description="We couldn’t verify your workspace access."
                                    variant="compact">
                                    <ResearchLaunchButton
                                        isSessionReady={isSessionReady}
                                        isLaunching={isLaunching}
                                        onStart={startResearch}
                                    />
                                </LoadErrorBoundary>
                            </div>
                        </motion.div>
                    ) : null}
                </AnimatePresence>
            </section>

            <AddSourceDialog
                open={referencesOpen}
                onOpenChange={setReferencesOpen}
                urls={manualSources.map(({ canonicalUrl }) => canonicalUrl)}
                onUrlsChange={(urls) =>
                    setManualSources((current) =>
                        current.filter(({ canonicalUrl }) =>
                            urls.includes(canonicalUrl),
                        ),
                    )
                }
                onAdd={async (url) => {
                    const result = await submitManualUrl({
                        requestKey: crypto.randomUUID(),
                        url,
                        target: {
                            kind: "prelaunch",
                            collectionKey: "research-composer",
                        },
                    });
                    if (result.kind !== "prepared") {
                        throw new Error("Unexpected manual source result");
                    }
                    setManualSources((current) =>
                        current.some(
                            ({ canonicalUrl }) =>
                                canonicalUrl === result.canonicalUrl,
                        )
                            ? current
                            : [...current, result],
                    );
                }}
            />
        </>
    );
}

function ResearchLaunchButton({
    isSessionReady,
    isLaunching,
    onStart,
}: {
    isSessionReady: boolean;
    isLaunching: boolean;
    onStart: () => Promise<void>;
}) {
    const visitor = useQuery(
        api.visitors.current,
        isSessionReady ? {} : "skip",
    );
    const { openInvitationDrawer } = useInvitationAccess();

    const launch = () => {
        if (isLaunching) {
            return;
        }
        if (visitor?.status !== "active") {
            openInvitationDrawer({
                onSuccess: () => {
                    void onStart();
                },
            });
            return;
        }
        void onStart();
    };

    return (
        <Button
            type="button"
            aria-label="Confirm and start"
            onClick={launch}
            disabled={isLaunching}
            variant="launch"
            size="lg">
            {isLaunching ? "Starting…" : "Confirm and start"}
            <Icon iconNode={ArrowRight01Icon} size={18} />
        </Button>
    );
}

function CompanyPaginationFooter({
    page,
    pageCount,
    resultCount,
    disabled,
    onPageChange,
}: {
    page: number;
    pageCount: number;
    resultCount: number;
    disabled: boolean;
    onPageChange: (page: number) => void;
}) {
    const resultLabel =
        resultCount === COMPANY_SEARCH_RESULT_LIMIT
            ? `Top ${COMPANY_SEARCH_RESULT_LIMIT} matches`
            : `${resultCount} ${resultCount === 1 ? "match" : "matches"}`;

    return (
        <div className="space-y-2 border-t border-border/60 pt-2">
            <p className="px-1 text-xs text-muted-foreground">{resultLabel}</p>
            <PaginationControls
                page={page}
                pageCount={pageCount}
                onPageChange={onPageChange}
                disabled={disabled}
                ariaLabel="Company search result pages"
                className="justify-start"
            />
        </div>
    );
}
