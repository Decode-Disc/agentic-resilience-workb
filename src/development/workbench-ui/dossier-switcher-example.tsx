import { ArrowRight01Icon } from "@hugeicons/core-free-icons";
import Icon from "@/components/icon";
import { NewDossierButton } from "@/components/workbench-shell/new-dossier-button";
import { AppLogo } from "@/components/logo-icon";
import { useState, type ComponentProps } from "react";
import type { Id } from "@convex/_generated/dataModel";
import { DossierSwitcherView } from "@/components/workbench-shell/dossier-switcher";
import { Button } from "@/components/ui/button";
type Dossier = ComponentProps<typeof DossierSwitcherView>["results"][number];
const dossiers: Dossier[] = [0, 1, 2].map((i) => ({
    startMode: undefined,
    sourcesProtocol: undefined,
    coveragePreset: undefined,
    researchAngle: undefined,
    activeCorpusRevisionId: undefined,
    completionOutcome: undefined,
    runId: `illustrative-${i}` as Id<"researchRuns">,
    company: {
        legalName: i === 0 ? "CCC Intelligent Solutions" : "ServiceNow",
        ticker: i === 0 ? "CCCS" : "NOW",
        exchange: "NYSE",
        cik: i === 0 ? "1818201" : "1373715",
        investorRelationsUrl: undefined,
        websiteUrl: undefined,
        websiteUrlSource: undefined,
    },
    framingScope:
        [
            "Photo-led claims coordination",
            "IT service request orchestration",
            "Customer service case routing",
        ][i] ?? null,
    lifecycleState: i === 1 ? "framing" : "discovering_sources",
    executionStatus: i === 0 ? "running" : i === 1 ? "idle" : "paused",
    pauseReason: i === 2 ? "analyst" : undefined,
    updatedAt: Date.UTC(2026, 10, 3),
    providerFailures: [],
}));
/** Uses the production selection surface with local illustrative data and callbacks. */
export function DossierSwitcherExample() {
    const [active, setActive] = useState(dossiers[0]);
    const [search, setSearch] = useState("");
    const [notice, setNotice] = useState("");
    const words = search.toLowerCase().trim().split(/\s+/);
    return (
        <section className="space-y-6">
            <p className="text-sm text-muted-foreground">
                Illustrative navigation · no research executed
            </p>
            <header className="flex min-w-0 items-center gap-3 border-b border-divider py-3">
                <AppLogo />
                <DossierSwitcherView
                    results={dossiers.filter((d) =>
                        words.every((w) =>
                            `${d.company?.legalName} ${d.framingScope}`
                                .toLowerCase()
                                .includes(w),
                        ),
                    )}
                    active={active}
                    activeRunId={active?.runId}
                    input={search}
                    onInputChange={setSearch}
                    pending={false}
                    loadingContext={false}
                    searching={Boolean(search)}
                    status="Exhausted"
                    loadMore={() => {}}
                    className="min-w-0 flex-1"
                    onSelect={(id) =>
                        setActive(dossiers.find((d) => d.runId === id))
                    }
                    actions={
                        <>
                            <NewDossierButton
                                variant="link"
                                onClick={() =>
                                    setNotice(
                                        "New dossier selected in this illustrative example.",
                                    )
                                }
                            />
                            <Button
                                variant="link"
                                size="sm"
                                className="ml-auto px-1"
                                onClick={() =>
                                    setNotice(
                                        "All dossiers selected in this illustrative example.",
                                    )
                                }>
                                All dossiers{" "}
                                <Icon iconNode={ArrowRight01Icon} size={14} />
                            </Button>
                        </>
                    }
                />
            </header>
            <output aria-live="polite">{notice}</output>
        </section>
    );
}
