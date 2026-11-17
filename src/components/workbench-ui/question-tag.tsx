import { HelpTip } from "./help-tip";
import styles from "./question-tag.module.css";

/**
 * A question label (Q1, Q2…) that reveals the full question on hover,
 * keyboard focus or tap. Without a supplied question it stays a plain label.
 */
export function QuestionTag({
    label,
    question,
}: {
    label: string;
    question?: string;
}) {
    if (!question) return <span className={styles.tag}>{label}</span>;
    return (
        <HelpTip
            trigger={
                <button
                    type="button"
                    className={styles.tag}
                    data-explained
                    aria-label={`${label}: ${question}`}>
                    {label}
                </button>
            }>
            <span className={styles.tip}>
                <b>{label}</b>
                {question}
            </span>
        </HelpTip>
    );
}
