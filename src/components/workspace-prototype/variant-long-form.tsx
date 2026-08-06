import {
    BookOpenTextIcon,
    FileSearchIcon,
    MapsIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";

import {
    prototypeClaims,
    prototypeDimensions,
    prototypeSources,
} from "./prototype-data";
import {
    ClaimSurface,
    DossierHeading,
    EvidenceKey,
    PrototypeNotice,
} from "./prototype-primitives";

export function VariantLongForm() {
    return (
        <div className="min-h-svh bg-background text-foreground">
            <PrototypeNotice />
            <header className="px-5 py-10 sm:px-8 sm:py-14">
                <div className="mx-auto max-w-6xl">
                    <DossierHeading />
                    <nav
                        className="mt-8 flex gap-5 overflow-x-auto border-b pb-3 text-sm"
                        aria-label="Dossier sections">
                        <a href="#progress" className="font-medium">
                            Progress
                        </a>
                        <a href="#sources" className="text-muted-foreground">
                            Sources
                        </a>
                        <a href="#evidence" className="text-muted-foreground">
                            Evidence
                        </a>
                        <a href="#assessment" className="text-muted-foreground">
                            Assessment
                        </a>
                        <a href="#outputs" className="text-muted-foreground">
                            Outputs
                        </a>
                    </nav>
                </div>
            </header>

            <main className="mx-auto max-w-6xl px-5 pb-32 sm:px-8">
                <section
                    id="progress"
                    className="scroll-mt-6 py-10"
                    aria-labelledby="progress-title">
                    <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_20rem]">
                        <div>
                            <p className="text-xs font-medium tracking-[0.12em] text-muted-foreground uppercase">
                                Current checkpoint
                            </p>
                            <h2
                                id="progress-title"
                                className="mt-2 text-2xl font-medium">
                                Evidence extracted, analyst decisions pending
                            </h2>
                            <p className="mt-3 max-w-2xl text-sm leading-7 text-muted-foreground">
                                Twelve accepted sources produced eighteen atomic
                                claims. Three require attention before dimension
                                proposals can be approved.
                            </p>
                        </div>
                        <Card size="sm">
                            <CardHeader>
                                <CardTitle>Workflow state</CardTitle>
                            </CardHeader>
                            <CardContent className="flex flex-col gap-2 text-sm">
                                <p>Workflow v2 · Generation 1</p>
                                <p className="text-muted-foreground">
                                    Last persisted event · Claim extraction
                                </p>
                            </CardContent>
                        </Card>
                    </div>
                </section>

                <Separator />

                <section
                    id="sources"
                    className="scroll-mt-6 py-12"
                    aria-labelledby="sources-title">
                    <div className="mb-6 flex items-center gap-3">
                        <HugeiconsIcon icon={FileSearchIcon} />
                        <h2 id="sources-title" className="text-2xl font-medium">
                            Approved corpus
                        </h2>
                    </div>
                    <div className="divide-y">
                        {prototypeSources.map((source) => (
                            <div
                                key={source.name}
                                className="grid gap-2 py-4 sm:grid-cols-[minmax(0,1fr)_10rem_7rem] sm:items-center">
                                <p className="text-sm font-medium">
                                    {source.name}
                                </p>
                                <p className="text-sm text-muted-foreground">
                                    {source.type}
                                </p>
                                <Badge
                                    variant={
                                        source.decision === "Rejected"
                                            ? "outline"
                                            : "secondary"
                                    }>
                                    {source.decision}
                                </Badge>
                            </div>
                        ))}
                    </div>
                </section>

                <Separator />

                <section
                    id="evidence"
                    className="scroll-mt-6 py-12"
                    aria-labelledby="evidence-title">
                    <p className="text-xs font-medium tracking-[0.12em] text-muted-foreground uppercase">
                        Primary artifact
                    </p>
                    <h2
                        id="evidence-title"
                        className="mt-2 text-3xl font-medium">
                        Evidence matrix
                    </h2>
                    <div className="mt-5">
                        <EvidenceKey />
                    </div>
                    <div className="mt-7 flex flex-col gap-4">
                        {prototypeClaims.map((claim) => (
                            <ClaimSurface key={claim.id} claim={claim} />
                        ))}
                    </div>
                </section>

                <Separator />

                <section
                    id="assessment"
                    className="scroll-mt-6 py-12"
                    aria-labelledby="assessment-title">
                    <h2 id="assessment-title" className="text-3xl font-medium">
                        Architectural assessment
                    </h2>
                    <div className="mt-7 divide-y border-y">
                        {prototypeDimensions.map((dimension) => (
                            <div
                                key={dimension.name}
                                className="grid gap-3 py-5 md:grid-cols-[minmax(0,1fr)_12rem_8rem_9rem]">
                                <p className="font-medium">{dimension.name}</p>
                                <p className="text-sm">{dimension.position}</p>
                                <p className="text-sm text-muted-foreground">
                                    {dimension.confidence}
                                </p>
                                <p className="text-sm text-muted-foreground">
                                    {dimension.direction}
                                </p>
                            </div>
                        ))}
                    </div>
                </section>

                <Separator />

                <section
                    id="outputs"
                    className="scroll-mt-6 py-12"
                    aria-labelledby="outputs-title">
                    <h2 id="outputs-title" className="text-3xl font-medium">
                        Derived outputs
                    </h2>
                    <div className="mt-7 grid gap-4 md:grid-cols-2">
                        <Card>
                            <CardHeader>
                                <HugeiconsIcon icon={MapsIcon} />
                                <CardTitle>Architecture map</CardTitle>
                            </CardHeader>
                            <CardContent>
                                <p className="text-sm leading-6 text-muted-foreground">
                                    Four validated relationships with visible
                                    coverage and uncertainty cues.
                                </p>
                                <Button variant="outline" className="mt-5">
                                    Inspect map
                                </Button>
                            </CardContent>
                        </Card>
                        <Card>
                            <CardHeader>
                                <HugeiconsIcon icon={BookOpenTextIcon} />
                                <CardTitle>Draft brief</CardTitle>
                            </CardHeader>
                            <CardContent>
                                <p className="text-sm leading-6 text-muted-foreground">
                                    Locked until the remaining claim decisions
                                    are recorded.
                                </p>
                                <Button
                                    variant="outline"
                                    className="mt-5"
                                    disabled>
                                    Generate brief
                                </Button>
                            </CardContent>
                        </Card>
                    </div>
                </section>
            </main>
        </div>
    );
}
