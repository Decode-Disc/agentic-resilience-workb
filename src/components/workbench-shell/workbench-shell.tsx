const workflowStages = [
    {
        number: '01',
        title: 'Discover',
        description:
            'Resolve a public company and assemble a reviewable source corpus.',
    },
    {
        number: '02',
        title: 'Verify',
        description:
            'Inspect precise passages, counter-evidence, and unresolved questions.',
    },
    {
        number: '03',
        title: 'Assess',
        description:
            'Review dimension-level proposals without an aggregate score.',
    },
] as const;

export function WorkbenchShell() {
    return (
        <div className="min-h-svh bg-background text-foreground">
            <header className="border-b">
                <div className="mx-auto flex w-full max-w-7xl items-center justify-between px-5 py-4 sm:px-8">
                    <div className="flex min-w-0 items-baseline gap-3">
                        <p className="truncate text-sm font-medium">
                            Agentic Resilience
                        </p>
                        <span className="hidden text-xs text-muted-foreground sm:inline">
                            Evidence Workbench
                        </span>
                    </div>
                    <p className="text-xs text-muted-foreground">
                        Research prototype
                    </p>
                </div>
            </header>

            <main className="mx-auto grid w-full max-w-7xl gap-16 px-5 py-14 sm:px-8 sm:py-20 lg:grid-cols-[minmax(0,1fr)_20rem] lg:gap-24 lg:py-28">
                <section
                    className="flex min-w-0 flex-col gap-12"
                    aria-labelledby="workbench-title"
                >
                    <div className="flex max-w-3xl flex-col gap-6">
                        <p className="text-xs font-medium tracking-[0.18em] text-muted-foreground uppercase">
                            Evidence-first architectural research
                        </p>
                        <h1
                            id="workbench-title"
                            className="max-w-3xl text-4xl leading-[1.05] font-medium tracking-[-0.035em] text-balance sm:text-6xl"
                        >
                            Agentic Resilience Evidence Workbench
                        </h1>
                        <p className="max-w-2xl text-base leading-7 text-muted-foreground sm:text-lg sm:leading-8">
                            Inspectable evidence for architectural resilience in
                            the agentic economy, with provenance, uncertainty,
                            and analyst judgment kept visible.
                        </p>
                    </div>

                    <section
                        className="border-y"
                        aria-label="Designed research workflow"
                    >
                        {workflowStages.map((stage) => (
                            <div
                                key={stage.number}
                                className="grid gap-2 border-b py-5 last:border-b-0 sm:grid-cols-[3rem_8rem_minmax(0,1fr)] sm:items-baseline sm:gap-4"
                            >
                                <p className="font-mono text-xs text-muted-foreground">
                                    {stage.number}
                                </p>
                                <h2 className="text-sm font-medium">
                                    {stage.title}
                                </h2>
                                <p className="max-w-xl text-sm leading-6 text-muted-foreground">
                                    {stage.description}
                                </p>
                            </div>
                        ))}
                    </section>
                </section>

                <aside className="flex flex-col gap-8 border-t pt-6 lg:border-t-0 lg:border-l lg:pt-0 lg:pl-8">
                    <div className="flex flex-col gap-3">
                        <p className="text-xs font-medium tracking-[0.14em] text-muted-foreground uppercase">
                            Operating principle
                        </p>
                        <p className="text-sm leading-6">
                            The evidence matrix is the primary artifact. Maps
                            and briefs remain derived views.
                        </p>
                    </div>
                    <div className="flex flex-col gap-3">
                        <p className="text-xs font-medium tracking-[0.14em] text-muted-foreground uppercase">
                            Human authority
                        </p>
                        <p className="text-sm leading-6">
                            Source approval and analytical decisions stay under
                            explicit analyst control.
                        </p>
                    </div>
                    <p className="mt-auto text-xs leading-5 text-muted-foreground">
                        Foundation initialized. No research output is presented
                        as live or complete.
                    </p>
                </aside>
            </main>
        </div>
    );
}
