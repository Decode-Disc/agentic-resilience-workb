import assert from "node:assert/strict";

export type DecisionQuestion = {
    type: "choice";
    instructions: string;
    criteria: Record<string, string>;
};

function object(value: unknown): Record<string, unknown> {
    assert(
        value && typeof value === "object" && !Array.isArray(value),
        "Expected object",
    );
    return value as Record<string, unknown>;
}

/** Rejects missing, invented or malformed choices before accuracy is computed. */
export function validateAnswers(
    response: Record<string, unknown>,
    questions: Record<string, DecisionQuestion>,
    native: boolean,
): Record<string, string> {
    let answers: Record<string, unknown>;
    if (native) {
        answers = object(response.answers);
    } else {
        assert(
            Array.isArray(response.choices) && response.choices.length === 1,
        );
        const choice = object(response.choices[0]);
        assert.equal(
            choice.finish_reason,
            "stop",
            "Incomplete generated response",
        );
        const content = object(choice.message).content;
        assert.equal(typeof content, "string");
        answers = object(JSON.parse(content as string));
    }
    assert.deepEqual(
        Object.keys(answers).sort(),
        Object.keys(questions).sort(),
    );
    const selected: Record<string, string> = {};
    for (const [id, question] of Object.entries(questions)) {
        const answer = native ? object(answers[id]) : undefined;
        const value = native ? answer?.choice : answers[id];
        assert.equal(typeof value, "string");
        assert(
            Object.hasOwn(question.criteria, value as string),
            "Unknown choice",
        );
        if (answer) {
            assert.equal(answer.type, "choice");
            assert(
                typeof answer.confidence === "number" &&
                    answer.confidence >= 0 &&
                    answer.confidence <= 1,
            );
            const probabilities = object(answer.probabilities);
            assert.deepEqual(
                Object.keys(probabilities).sort(),
                Object.keys(question.criteria).sort(),
            );
            const values = Object.values(probabilities);
            assert(
                values.every(
                    (p) =>
                        typeof p === "number" &&
                        Number.isFinite(p) &&
                        p >= 0 &&
                        p <= 1,
                ),
            );
            assert(
                Math.abs((values as number[]).reduce((a, b) => a + b, 0) - 1) <
                    0.02,
            );
        }
        selected[id] = value as string;
    }
    return selected;
}

export function evaluationTransport(id: string) {
    const typesafe = id.startsWith("jev-");
    const native =
        typesafe ||
        id === "microsoft/microsoft-decision-1" ||
        id === "openai/gpt-6-luna-decisions";
    return {
        native,
        endpoint: typesafe
            ? "https://api.typesafe.ai/v1/systemone"
            : native
              ? "https://openrouter.ai/api/alpha/decisions"
              : "https://openrouter.ai/api/v1/chat/completions",
        key: typesafe ? "TYPESAFE_API_KEY" : "OPENROUTER_API_KEY",
    };
}
