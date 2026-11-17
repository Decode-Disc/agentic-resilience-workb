import type { ComponentProps, ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { WorkbenchIcon } from "@/components/workbench-ui/glyphs";
import { CompanyResolutionCard } from "@/components/workspace/company-resolution-card";
import { StartDossierHeading } from "./start-dossier-heading";
import styles from "./start-screens.module.css";
/** Suggested angles are supplied by the caller, independently of company resolution. */
export function StartAngleSuggestions({
    angles,
    onSelect,
}: {
    angles: readonly { id: string; label: string }[];
    onSelect: (id: string) => void;
}) {
    return (
        <section
            className={styles.angles}
            aria-label="Suggested research angles">
            <span className={styles.label}>Try an angle</span>
            {angles.map((angle) => (
                <Button
                    variant="ghost"
                    key={angle.id}
                    onClick={() => onSelect(angle.id)}>
                    <WorkbenchIcon name="slashes" size={14} />
                    {angle.label}
                </Button>
            ))}
        </section>
    );
}
/** A single showcase action with the reference's identity, compact heading and metric footer. */
export function StartShowcaseCard({
    title,
    description,
    metrics,
    onOpen,
    avatar,
}: {
    title: string;
    description: string;
    metrics: readonly { value: string | number; label: string }[];
    onOpen: () => void;
    avatar?: ReactNode;
}) {
    return (
        <Button
            variant="ghost"
            className={styles.showcase}
            onClick={onOpen}
            aria-label={`Open showcase: ${title}`}>
            <span className={styles.showcaseHeader}>
                <span className={styles.curated}>Curated</span>
                <span className={styles.label}>Showcase dossier</span>
                <span className={styles.showcaseOpen}>
                    Open showcase
                    <WorkbenchIcon name="chevron" size={13} />
                </span>
            </span>
            <span className={styles.showcaseIdentity}>
                {avatar}
                <span>
                    <b>{title}</b>
                    <span className={styles.description}>{description}</span>
                </span>
            </span>
            <span className={styles.showcaseFooter}>
                {metrics.map((metric) => (
                    <span className={styles.stat} key={metric.label}>
                        <b>{metric.value}</b>
                        <span>{metric.label}</span>
                    </span>
                ))}
                <span className={styles.integrity}>
                    Illustrative analysis, clearly labelled
                </span>
            </span>
        </Button>
    );
}
/** The installed heading and composer form the entry surface; additional blocks remain composable. */
export function StartEntryScreen({
    composer,
    suggestions,
    showcase,
    title = "Start a research dossier",
}: {
    composer: ReactNode;
    suggestions?: ReactNode;
    showcase?: ReactNode;
    title?: string;
}) {
    return (
        <section className={styles.entry} aria-label={title}>
            <StartDossierHeading title={title} />
            <div className={`${styles.composer} @container/research-composer`}>
                {composer}
            </div>
            {suggestions}
            {showcase}
        </section>
    );
}
/** Composes company confirmation and research context; the caller owns selection and launch. */
export function CompanyMandatePanel({
    company,
    mandate,
    coverage,
    onChangeCompany,
    onConfirm,
    pending = false,
    checkingAccess = false,
    error,
}: {
    company: ComponentProps<typeof CompanyResolutionCard>["company"];
    mandate: ReactNode;
    coverage?: ReactNode;
    onChangeCompany?: () => void;
    onConfirm?: () => void;
    pending?: boolean;
    checkingAccess?: boolean;
    error?: string;
}) {
    return (
        <section
            className={styles.confirmation}
            aria-label="Confirm company and mandate">
            <div className={styles.confirmationIdentity}>
                <CompanyResolutionCard company={company} />
                {company.websiteUrl && (
                    <div className={styles.confirmationWebsite}>
                        <span>Website</span>
                        <a
                            href={company.websiteUrl}
                            target="_blank"
                            rel="noreferrer">
                            {company.websiteUrl
                                .replace(/^https?:\/\//, "")
                                .replace(/\/$/, "")}
                        </a>
                    </div>
                )}
            </div>
            {coverage}
            <div className={styles.mandate}>
                <span className={styles.label}>Mandate</span>
                <div>{mandate}</div>
            </div>
            {error && <p role="alert">{error}</p>}
            <div className={styles.actions}>
                <Button
                    variant="ghost"
                    disabled={pending || !onChangeCompany}
                    onClick={onChangeCompany}>
                    <WorkbenchIcon name="back" size={14} />
                    Back
                </Button>
                <Button
                    variant="launch"
                    disabled={pending || checkingAccess || !onConfirm}
                    onClick={onConfirm}>
                    {checkingAccess
                        ? "Checking access…"
                        : pending
                          ? "Preparing framing…"
                          : "Confirm and propose framing"}
                    <WorkbenchIcon name="chevron" size={14} />
                </Button>
            </div>
            <p className={styles.confirmationNote}>
                Website details help recognition only. The legal identity comes
                from the SEC registration.
            </p>
        </section>
    );
}
