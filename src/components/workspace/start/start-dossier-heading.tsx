/** The installed START heading, reused without changing its visual treatment. */
export function StartDossierHeading({
    title = "Start a research dossier",
}: {
    title?: string;
}) {
    return (
        <div className="mb-6 flex items-baseline gap-3">
            <div className="flex items-baseline rounded-none bg-muted-foreground/10 px-2 py-0.5">
                <span
                    aria-hidden="true"
                    className="text-[32px] start-double-slash">
                    {"//"}
                </span>
                <h1 className="text-2xl font-medium tracking-tight text-muted-foreground/90">
                    {title}
                </h1>
            </div>
        </div>
    );
}
