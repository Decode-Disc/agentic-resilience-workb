import { type ComponentProps, type ReactNode, useState } from "react";
import {
    EvidenceMatrix,
    InventorySheet,
    InventoryUse,
} from "@/components/workbench-ui";
import { matrixUseLabels } from "@/components/workbench-ui/evidence-matrix";
import { matrixQuestions, matrixRows } from "./fixture-data";

function notify(message: string) {
    window.dispatchEvent(
        new CustomEvent("workbench-example-action", { detail: message }),
    );
}

/** Illustrative inventory content shared by the component specimen and workflow previews. */
export function IllustrativeInventorySheet({
    open,
    onOpenChange,
    trigger,
    finalFocus,
}: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    trigger?: ReactNode;
    finalFocus?: ComponentProps<typeof InventorySheet>["finalFocus"];
}) {
    const [query, setQuery] = useState("");
    const [filter, setFilter] = useState("all");
    const [recent, setRecent] = useState(true);
    const [assertion, setAssertion] = useState("A-014");
    const [question, setQuestion] = useState("Q1");
    const filteredRows = matrixRows
        .filter(
            (row) =>
                (filter === "all" || row.kind === filter) &&
                `${row.id} ${row.text} ${row.meta}`
                    .toLowerCase()
                    .includes(query.toLowerCase()),
        )
        .sort((a, b) =>
            recent ? b.changedAt - a.changedAt : a.id.localeCompare(b.id),
        );
    const selectedRow = filteredRows.find((row) => row.id === assertion);
    const selectedUses = matrixQuestions.flatMap((q) => {
        const use = selectedRow?.uses[q.id];
        return use ? [{ question: q, use }] : [];
    });
    return (
        <InventorySheet
            open={open}
            onOpenChange={onOpenChange}
            total={126}
            trigger={trigger}
            finalFocus={finalFocus}
            query={query}
            onQueryChange={setQuery}
            selectedFilter={filter}
            onFilterChange={setFilter}
            filters={[
                { id: "all", label: "All", count: 126 },
                { id: "fact", label: "Fact", kind: "fact", count: 64 },
                {
                    id: "inference",
                    label: "Inference",
                    kind: "inference",
                    count: 31,
                },
                {
                    id: "counter",
                    label: "Counter",
                    kind: "counter",
                    count: 8,
                },
            ]}
            recentFirst={recent}
            onRecentFirstChange={setRecent}
            footer={
                selectedRow && (
                    <>
                        <span
                            className="wb-label"
                            style={{
                                color: "var(--accent-foreground)",
                                flexShrink: 0,
                            }}>
                            {selectedRow.id} · {selectedUses.length} uses
                        </span>
                        <span className="inventory-example-uses">
                            {selectedUses.map(({ question: q, use }) => (
                                <InventoryUse
                                    key={q.id}
                                    question={q.label}
                                    selected={question === q.id}
                                    onSelect={() => setQuestion(q.id)}>
                                    {matrixUseLabels[use]} · {q.title}
                                </InventoryUse>
                            ))}
                        </span>
                    </>
                )
            }>
            {filteredRows.length ? (
                <div className="inventory-example-matrix">
                    <EvidenceMatrix
                        questions={matrixQuestions}
                        rows={filteredRows}
                        introduction={
                            <span className="wb-meta">
                                {recent
                                    ? "Sorted by recent change"
                                    : "Sorted by assertion"}
                            </span>
                        }
                        selectedQuestion={question}
                        selectedAssertion={selectedRow?.id}
                        onSelectQuestion={setQuestion}
                        onSelectUse={(a, q) => {
                            setAssertion(a);
                            setQuestion(q);
                        }}
                        onChallengeUse={(a, q) =>
                            notify(
                                `Illustrative action: challenge ${a} for ${q}`,
                            )
                        }
                        onOpenPassage={(a) =>
                            notify(`Illustrative action: open passage for ${a}`)
                        }
                        onOpenQuestionReasoning={(q) =>
                            notify(
                                `Illustrative action: inspect ${q} reasoning`,
                            )
                        }
                    />
                </div>
            ) : (
                <p style={{ padding: 24 }}>
                    No assertions match these filters.
                </p>
            )}
        </InventorySheet>
    );
}
