import { agentOperationInputSchema } from "@convex/integrations/modelInput";
import { v } from "convex/values";
import { expect, test } from "vitest";

test("canonical nested and nullable Convex IDs serialize for every agent without a custom-schema allowlist", () => {
    const inputValidator = v.object({
        changes: v.array(
            v.object({
                captureId: v.id("sourceCaptures"),
                previous: v.union(v.id("aiTaskResults"), v.null()),
            }),
        ),
    });
    const schema = agentOperationInputSchema({ inputValidator }).jsonSchema;
    expect(schema).toMatchObject({
        type: "object",
        required: ["changes"],
        additionalProperties: false,
        properties: {
            changes: {
                type: "array",
                items: {
                    type: "object",
                    required: ["captureId", "previous"],
                    additionalProperties: false,
                    properties: {
                        captureId: {
                            type: "string",
                            description:
                                expect.stringContaining("Id<sourceCaptures>"),
                        },
                        previous: {
                            anyOf: expect.arrayContaining([
                                {
                                    type: "string",
                                    description:
                                        expect.stringContaining(
                                            "Id<aiTaskResults>",
                                        ),
                                },
                                { type: "null" },
                            ]),
                        },
                    },
                },
            },
        },
    });
});
