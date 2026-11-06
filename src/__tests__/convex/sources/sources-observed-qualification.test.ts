import { sourcesDefinition } from "@convex/domain/sourcesAgent";
import { qualificationSubmissionInput } from "@convex/domain/sourcesContracts";
import { agentToolSchemas } from "@convex/execution/agentDefinition";
import { assert, expect, test } from "vitest";

test("Sources qualification tools expose semantic changes while canonical operations retain version guards", () => {
    const tool =
        agentToolSchemas(sourcesDefinition).submit_documentary_qualification;
    assert(tool?.inputValidator.kind === "object");
    expect(tool.inputValidator.fields).not.toHaveProperty("expectedTaskId");
    const changes = tool.inputValidator.fields.changes;
    assert(changes?.kind === "array" && changes.element.kind === "object");
    expect(changes.element.fields).not.toHaveProperty("expectedVersion");
    expect(changes.element.fields).toHaveProperty("contributionId");
    expect(qualificationSubmissionInput.fields).toHaveProperty(
        "expectedTaskId",
    );
    expect(
        qualificationSubmissionInput.fields.changes.element.fields,
    ).toHaveProperty("expectedVersion");
});

test("Sources selects the retained model contract from the admitted snapshot and rejects unknown formats", () => {
    const old = agentToolSchemas(sourcesDefinition, { activeWork: {} });
    expect(old.submit_documentary_qualification?.inputValidator).toBe(
        qualificationSubmissionInput,
    );
    const current = agentToolSchemas(sourcesDefinition, {
        contextRendering: "separated_v1",
        domain: { activeWork: { qualificationInputVersion: "observed_v1" } },
    }).submit_documentary_qualification;
    assert(current?.inputValidator.kind === "object");
    expect(current.inputValidator.fields).not.toHaveProperty("expectedTaskId");
    expect(() =>
        agentToolSchemas(sourcesDefinition, {
            activeWork: { qualificationInputVersion: "unrecognized" },
        }),
    ).toThrow(/qualification_input_version_unavailable/);
});
