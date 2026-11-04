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
    expect(JSON.stringify(schema)).toContain("Id<sourceCaptures>");
    expect(JSON.stringify(schema)).toContain('"additionalProperties":false');
});
