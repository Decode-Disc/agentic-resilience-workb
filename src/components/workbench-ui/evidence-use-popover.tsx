import { Popover as PopoverPrimitive } from "@base-ui/react/popover";
import { Cancel01Icon } from "@hugeicons/core-free-icons";
import type { ReactElement, ReactNode } from "react";
import Icon from "@/components/icon";
import { Button } from "@/components/ui/button";
import {
    Popover,
    PopoverContent,
    PopoverDescription,
    PopoverTitle,
    PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import type { MatrixUse } from "./evidence-matrix";
import useStyles from "./evidence-use.module.css";
import styles from "./evidence-use-popover.module.css";
import {
    ClaimGlyph,
    type ClaimTone,
    EvidenceBadge,
    WorkbenchIcon,
} from "./glyphs";
import { WorkbenchUiRoot } from "./root";

export interface MatrixPassage {
    text: string;
    meta: string;
    kind: ClaimTone;
}
export interface MatrixUseDetails {
    rationale: string;
    control?: ReactNode;
    limitation?: ReactNode;
    judgment?: ReactNode;
}

/** Inspects a supplied assertion use; the consumer owns evidence, judgments and action outcomes. */
export function EvidenceUsePopover({
    trigger,
    assertionId,
    questionLabel,
    use,
    useLabel,
    passage,
    details,
    onChallenge,
    onOpenPassage,
    onOpenReasoning,
}: {
    trigger: ReactElement;
    assertionId: string;
    questionLabel: string;
    use: MatrixUse;
    useLabel: string;
    passage?: MatrixPassage;
    details?: MatrixUseDetails;
    onChallenge?: () => void;
    onOpenPassage?: () => void;
    onOpenReasoning?: () => void;
}) {
    return (
        <Popover>
            <PopoverTrigger render={trigger} />
            <PopoverContent
                side="right"
                align="start"
                sideOffset={14}
                alignOffset={-34}
                render={<WorkbenchUiRoot />}
                className={styles.popup}>
                <PopoverPrimitive.Arrow className={styles.arrow} />
                <div className={styles.header}>
                    <PopoverTitle
                        className={styles.identity}
                        aria-label={`${assertionId} used for ${questionLabel}`}>
                        {assertionId} → {questionLabel}
                    </PopoverTitle>
                    <span
                        className={cn(useStyles.treatment, styles.useTag)}
                        data-use={use}>
                        {use === "supports" && (
                            <WorkbenchIcon
                                name="check"
                                size={11}
                                strokeWidth={2.6}
                            />
                        )}
                        {use === "opposes" && <ClaimGlyph kind="counter" />}
                        {useLabel}
                    </span>
                    <PopoverPrimitive.Close
                        render={
                            <Button
                                variant="quiet"
                                size="icon-xs"
                                className={styles.close}
                                aria-label="Close use details"
                            />
                        }>
                        <Icon iconNode={Cancel01Icon} className="size-3" />
                    </PopoverPrimitive.Close>
                </div>
                <div className={styles.body}>
                    <PopoverDescription className={styles.rationale}>
                        {details?.rationale ??
                            "No rationale is available for this use."}
                    </PopoverDescription>
                    {passage ? (
                        <blockquote className={styles.quote}>
                            <p>“{passage.text}”</p>
                            <footer>
                                <EvidenceBadge kind={passage.kind} />
                                <cite>{passage.meta}</cite>
                            </footer>
                        </blockquote>
                    ) : (
                        <p className={styles.missing}>
                            No passage is available for this assertion.
                        </p>
                    )}
                    <dl className={styles.facts}>
                        {details?.control && (
                            <>
                                <dt>Control</dt>
                                <dd>{details.control}</dd>
                            </>
                        )}
                        <dt>Limit</dt>
                        <dd className={styles.limitation}>
                            <ClaimGlyph kind="counter" />
                            <span>
                                {details?.limitation ??
                                    "Limits have not been documented for this use."}
                            </span>
                        </dd>
                        {details?.judgment && (
                            <>
                                <dt>Judgment</dt>
                                <dd>{details.judgment}</dd>
                            </>
                        )}
                    </dl>
                    {(onChallenge || onOpenPassage || onOpenReasoning) && (
                        <div className={styles.actions}>
                            {onChallenge && (
                                <Button
                                    variant="ghost"
                                    size="compact"
                                    className={styles.challenge}
                                    onClick={onChallenge}>
                                    Challenge this use
                                </Button>
                            )}
                            {onOpenPassage && (
                                <Button
                                    variant="outline"
                                    size="compact"
                                    className={styles.action}
                                    onClick={onOpenPassage}>
                                    Open passage
                                </Button>
                            )}
                            {onOpenReasoning && (
                                <Button
                                    size="compact"
                                    className={styles.action}
                                    onClick={onOpenReasoning}>
                                    See {questionLabel} reasoning
                                </Button>
                            )}
                        </div>
                    )}
                </div>
            </PopoverContent>
        </Popover>
    );
}
