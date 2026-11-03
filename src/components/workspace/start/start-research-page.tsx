"use client";

import { ComposerToolbar } from "@/components/composer/composer";

import { api } from "@convex/_generated/api";
import { ArrowRight01Icon, Attachment01Icon } from "@hugeicons/core-free-icons";
import { useNavigate } from "@tanstack/react-router";
import { useAction, useMutation, useQuery } from "convex/react";
import type { FunctionReturnType, FunctionArgs } from "convex/server";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { ComposerToolsMenu } from "@/components/composer/tools-menu";
import { ResearchModelPicker } from "@/components/workspace/start/research-model-picker";
import { CompanyFaviconAvatar } from "@/components/company-favicon-avatar";
import Icon from "@/components/icon";
import { LoadErrorBoundary } from "@/components/load-error-boundary";
import { PaginationControls } from "@/components/pagination-controls";
import { Button } from "@/components/ui/button";
import { LoadErrorAlert } from "@/components/ui/load-error-alert";
import { SmoothDropdwon } from "@/components/ui/smooth-dropdown";
import { AddSourceDialog } from "@/components/workspace/add-source-dialog";
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
    ResearchComposerView,
} from "@/components/workspace/start/research-composer-view";
import { StartDossierHeading } from "@/components/workspace/start/start-dossier-heading";
import {
    CompanyMandatePanel,
    StartAngleSuggestions,
    StartEntryScreen,
    StartShowcaseCard,
} from "@/components/workspace/start/start-entry-screens";
import {
    prototypeClaims,
    prototypeSources,
} from "@/components/workspace-prototype/prototype-data";
import { useAnonymousSession } from "@/hooks/use-anonymous-session";
import { usePagination } from "@/hooks/use-pagination";
import { useQuickTextFill } from "@/hooks/use-quick-text-fill";
import { useResponsive } from "@/hooks/use-responsive";
import {
    companyLookupErrorMessage,
    sourceAddErrorMessage,
} from "@/lib/presentation/research-copy";
import { WorkbenchUiRoot } from "@/components/workbench-ui/root";
import { cn } from "@/lib/utils";
import styles from "./start-screens.module.css";

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

/** Owns the initial dossier journey; the composer view owns only input presentation. */
export function StartResearchPage() {
    const { isSessionReady, sessionError, retrySession } =
        useAnonymousSession();
    return (
        <WorkbenchUiRoot>
            {sessionError ? (
                <LoadErrorAlert
                    title="Research workspace unavailable"
                    description="We couldn’t prepare your research workspace."
                    onRetry={retrySession}
                />
            ) : (
                <StartResearchContent isSessionReady={isSessionReady} />
            )}
        </WorkbenchUiRoot>
    );
}

function StartResearchContent({ isSessionReady }: { isSessionReady: boolean }) {
    const placeholderText =
        "Describe the resilience question to focus on for research. Or choose a company to start.";
    const navigate = useNavigate();
    const searchCompanies = useAction(api.companyResolution.search);
    const preflight = useAction(api.companyResolution.preflight);
    const confirmCompany = useMutation(api.framing.confirmCompany);
    const submitManualUrl = useAction(api.sourceActions.submitManualUrl);
    const reduceMotion = useReducedMotion();
    const [modelChoice, setModelChoice] =
        useState<
            NonNullable<
                FunctionArgs<
                    typeof api.framing.confirmCompany
                >["modelSelection"]
            >
        >();
    const [researchAngle, setResearchAngle] = useState("");
    const { inputRef: angleRef, fill: fillAngle } =
        useQuickTextFill<HTMLTextAreaElement>(setResearchAngle);
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
    const [isCreatingDossier, setIsCreatingDossier] = useState(false);
    const [lookupError, setLookupError] = useState<string | null>(null);
    const [creationError, setCreationError] = useState<string | null>(null);
    const [referencesOpen, setReferencesOpen] = useState(false);
    const [manualSources, setManualSources] = useState<
        Array<PreparedManualSource>
    >([]);
    const creationKey = useRef<string | null>(null);

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
        setCreationError(null);
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
            creationKey.current = null;
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
        setCreationError(null);
        creationKey.current = null;
    };

    const createDossier = async () => {
        if (!resolution || isCreatingDossier) {
            if (!resolution) {
                setPickerOpen(true);
            }
            return;
        }

        setIsCreatingDossier(true);
        setCreationError(null);
        creationKey.current ??= crypto.randomUUID();

        try {
            const result = await confirmCompany({
                preflightId: resolution.preflightId,
                idempotencyKey: creationKey.current,
                coveragePreset,
                ...(modelChoice ? { modelSelection: modelChoice } : {}),
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
            setCreationError(
                sourceErrorMessage === "We couldn't add that source. Try again."
                    ? "We couldn't start this research dossier. Try again."
                    : sourceErrorMessage,
            );
            setIsCreatingDossier(false);
        }
    };

    const form = (
        <section
            className="@container/research-composer w-full overflow-visible"
            aria-label="Research launch">
            <AnimatePresence initial={false} mode="wait">
                {view === "compose" ? (
                    <motion.div
                        key="compose"
                        className="min-w-0"
                        initial={
                            reduceMotion ? false : { opacity: 0, scale: 0.97 }
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
                            reduceMotion ? { duration: 0 } : viewEnterTransition
                        }
                        style={{ transformOrigin: "50% 45%" }}>
                        <ResearchComposerView
                            id="research-angle"
                            textareaRef={angleRef}
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
                                <ComposerToolbar
                                    context={
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
                                                            company={candidate}
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
                                            openWidth={isMobile ? 300 : 400}
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
                                                            ? resolution.company
                                                                  .legalName
                                                            : "Company to investigate"
                                                    }
                                                    ticker={
                                                        resolution?.company
                                                            .ticker
                                                    }
                                                    highlighted={
                                                        resolution !== null
                                                    }
                                                />
                                            }
                                            header={
                                                <CompanyLookup
                                                    companyQuery={companyQuery}
                                                    isSearching={isSearching}
                                                    lookupError={lookupError}
                                                    hasResolution={
                                                        resolution !== null
                                                    }
                                                    hasSearched={hasSearched}
                                                    resultCount={
                                                        companyCandidates.length
                                                    }
                                                    onCompanyQueryChange={(
                                                        next,
                                                    ) => {
                                                        setCompanyQuery(next);
                                                        setHasSearched(false);
                                                        setCompanyCandidates(
                                                            [],
                                                        );
                                                        setLookupError(null);
                                                    }}
                                                    onClear={clearResolution}
                                                    onSearch={() =>
                                                        void searchForCompanies()
                                                    }
                                                    sessionReady={
                                                        isSessionReady
                                                    }
                                                />
                                            }
                                            footer={
                                                companyCandidates.length > 0 ? (
                                                    <CompanyPaginationFooter
                                                        page={companyPage}
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
                                    }
                                    tools={
                                        <>
                                            <ComposerToolsMenu
                                                count={manualSources.length}
                                                items={[
                                                    {
                                                        label: "Attach references",
                                                        icon: Attachment01Icon,
                                                        description:
                                                            "Add public HTTPS links as research inputs",
                                                        onSelect: () =>
                                                            setReferencesOpen(
                                                                true,
                                                            ),
                                                    },
                                                ]}
                                            />
                                            <LoadErrorBoundary
                                                variant="compact"
                                                title="Model choices unavailable"
                                                description="Your research draft is kept. Retry to choose a model.">
                                                <ResearchModelPicker
                                                    ready={isSessionReady}
                                                    pending={isCreatingDossier}
                                                    choice={modelChoice}
                                                    onSelect={setModelChoice}
                                                />
                                            </LoadErrorBoundary>
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
                        className="w-full"
                        initial={
                            reduceMotion ? false : { opacity: 0, scale: 0.96 }
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
                            reduceMotion ? { duration: 0 } : viewEnterTransition
                        }
                        style={{ transformOrigin: "50% 45%" }}>
                        <LoadErrorBoundary
                            title="Workspace access unavailable"
                            description="We couldn’t verify your workspace access."
                            variant="compact">
                            <ResearchCompanyConfirmation
                                company={resolution.company}
                                coverage={
                                    <CoveragePresetPicker
                                        value={coveragePreset}
                                        onChange={setCoveragePreset}
                                    />
                                }
                                error={creationError ?? undefined}
                                onBack={() => setView("compose")}
                                isSessionReady={isSessionReady}
                                isCreatingDossier={isCreatingDossier}
                                onConfirm={createDossier}
                            />
                        </LoadErrorBoundary>
                    </motion.div>
                ) : null}
            </AnimatePresence>
        </section>
    );
    return (
        <>
            {view === "compose" ? (
                <StartEntryScreen
                    composer={form}
                    suggestions={
                        <StartAngleSuggestions
                            angles={[
                                {
                                    id: "coordination",
                                    label: "Who controls the workflow once agents handle the intake?",
                                },
                                {
                                    id: "integration",
                                    label: "Which integrations would an agent have to replace?",
                                },
                                {
                                    id: "value",
                                    label: "Where could value move if agents coordinate the work?",
                                },
                            ]}
                            onSelect={(id) =>
                                fillAngle(
                                    id === "coordination"
                                        ? "Who controls the workflow once agents handle the intake?"
                                        : id === "integration"
                                          ? "Which integrations would an agent have to replace?"
                                          : "Where could value move if agents coordinate the work?",
                                )
                            }
                        />
                    }
                    showcase={
                        <StartShowcaseCard
                            title="Who holds the photo-led claim workflow?"
                            description="CCC Intelligent Solutions · illustrative workspace, not live research"
                            metrics={[
                                {
                                    value: prototypeSources.length,
                                    label: "example sources",
                                },
                                {
                                    value: prototypeClaims.length,
                                    label: "illustrative assertions",
                                },
                            ]}
                            onOpen={() =>
                                void navigate({
                                    to: "/prototype/workspace",
                                    search: { variant: "a" },
                                })
                            }
                            avatar={
                                <CompanyFaviconAvatar
                                    company={{
                                        legalName:
                                            "CCC Intelligent Solutions Holdings Inc.",
                                        ticker: "CCCS",
                                    }}
                                    size="lg"
                                />
                            }
                        />
                    }
                />
            ) : (
                <div className={styles.entry}>
                    <StartDossierHeading />
                    {form}
                </div>
            )}

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

function ResearchCompanyConfirmation({
    isSessionReady,
    isCreatingDossier,
    onConfirm,
    company,
    coverage,
    error,
    onBack,
}: {
    isSessionReady: boolean;
    isCreatingDossier: boolean;
    onConfirm: () => Promise<void>;
    company: PreflightResult["company"];
    coverage: import("react").ReactNode;
    error?: string;
    onBack: () => void;
}) {
    const visitor = useQuery(
        api.visitors.current,
        isSessionReady ? {} : "skip",
    );
    const { openInvitationDrawer, resolveInvitationDrawer, isOpen } =
        useInvitationAccess();
    useEffect(() => {
        if (isOpen && visitor?.status === "active") {
            void resolveInvitationDrawer(
                { visitorId: visitor._id, role: visitor.role },
                "session",
            ).catch(() => {
                toast.error(
                    "Access is available, but we couldn’t continue. Try again.",
                );
            });
        }
    }, [visitor, isOpen, resolveInvitationDrawer]);

    const confirm = () => {
        if (isCreatingDossier || !isSessionReady || visitor === undefined) {
            return;
        }
        if (visitor?.status !== "active") {
            openInvitationDrawer({
                onSuccess: () => {
                    void onConfirm();
                },
            });
            return;
        }
        void onConfirm();
    };

    return (
        <CompanyMandatePanel
            company={company}
            coverage={coverage}
            pending={isCreatingDossier}
            checkingAccess={!isSessionReady || visitor === undefined}
            error={error}
            onChangeCompany={onBack}
            onConfirm={confirm}
            mandate={
                <>
                    <p>
                        Primary sources first: SEC filings and company material,
                        then public third-party sources.
                    </p>
                    <p>
                        Counter-evidence is always sought. Every claim stays
                        traceable to a passage.
                    </p>
                    <p className="text-muted-foreground">
                        Bounded effort. You are asked only for important
                        exceptions.
                    </p>
                </>
            }
        />
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
