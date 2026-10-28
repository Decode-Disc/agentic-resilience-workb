import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Chip } from "@/components/workbench-ui/chip";
import {
    EvidenceMatrix,
    type MatrixQuestion,
    type MatrixRow,
} from "@/components/workbench-ui/evidence-matrix";
import { WorkbenchUiRoot } from "@/components/workbench-ui/root";
import styles from "./evidence-matrix-illustration.module.css";

const questions: readonly MatrixQuestion[] = [
    { id: "q1", label: "Q1", title: "Does ExampleCo control coordination?" },
    { id: "q2", label: "Q2", title: "Is its operational context durable?" },
    { id: "q3", label: "Q3", title: "Could core platforms replace it?" },
    { id: "q4", label: "Q4", title: "Could an agent bypass it?" },
];
const supportedUse = (
    <Badge tone="ink">Supported within the examined scope</Badge>
);
const forReview = (
    <Badge tone="review">
        <span
            aria-hidden="true"
            className="size-[7px] rounded-full bg-review"
        />
        Illustrative appraisal · for review
    </Badge>
);
const rows: readonly MatrixRow[] = [
    {
        id: "A-014",
        kind: "fact",
        text: "ExampleCo reports insurer-configurable workflows connecting insurers and repair facilities.",
        meta: "Fictional annual report, p. 8",
        uses: { q1: "supports", q2: "context", q3: "context" },
        sourceStatus: "verified",
        passage: {
            text: "Insurers can configure workflows that route estimates and photos between their teams and repair facilities.",
            meta: "Fictional annual report · p. 8 ¶3",
            kind: "fact",
        },
        useDetails: {
            q1: {
                rationale:
                    "Shows one workflow spanning insurers and repair facilities, which is the coordination Q1 tests.",
                control: supportedUse,
                limitation:
                    "Says nothing about who sets the routing rules. A-021 opposes Q1 on that point.",
                judgment: forReview,
            },
            q2: {
                rationale:
                    "Identifies the shared workflow in which operational context is collected.",
                control: supportedUse,
                limitation:
                    "Does not establish whether this context remains useful after participants leave.",
                judgment: forReview,
            },
            q3: {
                rationale:
                    "Shows the integrations a core platform would need to replace.",
                control: supportedUse,
                limitation:
                    "Does not establish how difficult these integrations are to reproduce.",
                judgment: forReview,
            },
        },
    },
    {
        id: "A-021",
        kind: "fact",
        text: "Insurers set assignment and routing through their own rules.",
        meta: "Fictional annual report, pp. 8–9",
        uses: { q1: "opposes", q3: "supports", q4: "context" },
        sourceStatus: "verified",
        passage: {
            text: "Assignment decisions follow rules each insurer sets within the platform.",
            meta: "Fictional annual report · p. 9 ¶1",
            kind: "fact",
        },
        useDetails: {
            q1: {
                rationale:
                    "Insurer-owned routing rules oppose the claim that ExampleCo controls coordination decisions.",
                control: supportedUse,
                limitation:
                    "The platform may still control other operational steps.",
                judgment: forReview,
            },
            q3: {
                rationale:
                    "Locates decision rules outside ExampleCo, reducing one dependency a substitute would need to reproduce.",
                control: supportedUse,
                limitation:
                    "A substitute would still need interfaces and operational context.",
                judgment: forReview,
            },
            q4: {
                rationale:
                    "Identifies the decision boundary an external agent would encounter.",
                control: supportedUse,
                limitation:
                    "The passage does not establish whether agents can invoke or change these rules.",
                judgment: forReview,
            },
        },
    },
    {
        id: "A-027",
        kind: "inference",
        text: "Participants rely on the shared workflow to exchange estimate data.",
        meta: "Reasoned from fictional assertion A-014",
        uses: { q1: "supports", q2: "supports" },
        sourceStatus: "verified",
        passage: {
            text: "Participants exchange estimate information through a shared operational workflow.",
            meta: "Fictional annual report · p. 8 ¶4",
            kind: "fact",
        },
        useDetails: {
            q1: {
                rationale:
                    "Shared exchanges support a coordination role across participants.",
                control: supportedUse,
                limitation:
                    "A coordination role does not establish authority over every participant.",
                judgment: forReview,
            },
            q2: {
                rationale:
                    "Repeated exchanges could accumulate context that participants depend on.",
                control: supportedUse,
                limitation:
                    "The inference requires evidence that this context remains useful over time.",
                judgment: forReview,
            },
        },
    },
    {
        id: "A-033",
        kind: "hypothesis",
        text: "An external agent could coordinate a claim, using ExampleCo only for specific tasks.",
        meta: "Illustrative hypothesis · to be tested",
        uses: { q1: "opposes", q4: "supports" },
        sourceStatus: "disputed",
        passage: {
            text: "External tools can request estimates and submit assignments through the platform's interfaces.",
            meta: "Fictional API guide · p. 12 ¶2",
            kind: "fact",
        },
        useDetails: {
            q1: {
                rationale:
                    "An outside agent might coordinate the workflow while ExampleCo supplies individual tasks.",
                control: <Badge tone="review">To investigate</Badge>,
                limitation:
                    "An available interface does not prove that an agent can coordinate the complete workflow.",
                judgment: forReview,
            },
            q4: {
                rationale:
                    "Task-level interfaces provide a possible route for an external agent to bypass the coordination layer.",
                control: <Badge tone="review">To investigate</Badge>,
                limitation:
                    "Authorization, context and end-to-end execution remain untested.",
                judgment: forReview,
            },
        },
    },
    {
        id: "A-040",
        kind: "unknown",
        text: "Who can change the routing rules is not documented.",
        meta: "Not established by the fictional passages",
        uses: { q1: "context", q4: "context" },
        sourceStatus: "unestablished",
        passage: {
            text: "Routing endpoints execute the insurer's configured assignments.",
            meta: "Fictional API guide · p. 13 ¶1",
            kind: "fact",
        },
        useDetails: {
            q1: {
                rationale:
                    "The missing permission boundary limits a conclusion about who controls coordination.",
                control: <Badge tone="unknown">Not established</Badge>,
                limitation:
                    "The passage does not identify who can edit routing rules.",
                judgment: forReview,
            },
            q4: {
                rationale:
                    "The same permission boundary constrains whether an external agent could redirect the workflow.",
                control: <Badge tone="unknown">Not established</Badge>,
                limitation:
                    "Missing documentation does not prove that agents lack permission.",
                judgment: forReview,
            },
        },
    },
];

/** An interactive illustration with fictional evidence; selection never starts or saves research. */
export function EvidenceMatrixIllustration() {
    const [question, setQuestion] = useState("q1");
    const [assertion, setAssertion] = useState("A-014");
    return (
        <WorkbenchUiRoot className={styles.preview}>
            <header className={styles.header}>
                <div className={styles.title}>
                    <Chip>{"// Examine the evidence"}</Chip>
                    <h2>
                        Which evidence bears
                        <br />
                        on which question
                    </h2>
                </div>
                <div className={styles.explanation}>
                    <Chip kind="illustrative">Illustrative preview</Chip>
                    <p>
                        Read across for one piece of evidence.
                        <br />
                        Read down for one question.
                    </p>
                </div>
            </header>
            <div className={styles.frame}>
                <section
                    className={styles.scroller}
                    aria-label="Illustrative evidence matrix">
                    <EvidenceMatrix
                        className={styles.matrix}
                        questions={questions}
                        rows={rows}
                        introduction={
                            <span className={styles.introduction}>
                                5 fictional assertions
                                <br />
                                ExampleCo · Claims coordination
                            </span>
                        }
                        selectedQuestion={question}
                        selectedAssertion={assertion}
                        onSelectQuestion={setQuestion}
                        onSelectUse={(a, q) => {
                            setAssertion(a);
                            setQuestion(q);
                        }}
                    />
                </section>
                <div className={styles.legend}>
                    <span>
                        <i className={styles.supports} />
                        Supports
                    </span>
                    <span>
                        <i className={styles.opposes} />
                        Opposes
                    </span>
                    <span>
                        <i className={styles.context} />
                        Context
                    </span>
                    <span>
                        <i className={styles.unused} />
                        Not used
                    </span>
                    <p>A tile shows relevance, not the answer.</p>
                </div>
            </div>
            <p className={styles.disclosure}>
                Fictional company, assertions and sources. This illustration
                does not represent live research or an assessment of a real
                company.
            </p>
        </WorkbenchUiRoot>
    );
}
