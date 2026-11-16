import { useMemo } from "react";
import { illustrativeActivity } from "./fixture-data";
import { PastaActivityStudy } from "./pasta-activity-study";
import styles from "./pasta-activity-study.module.css";

/** The selected PastaUI activity direction, kept as an illustrative development example. */
export function AgentActivityExample() {
    const retained = useMemo(
        () =>
            Array.from({ length: 200 }, (_, index) =>
                illustrativeActivity(index + 1),
            ),
        [],
    );
    return (
        <div className={styles.root}>
            <PastaActivityStudy retained={retained} />
        </div>
    );
}
