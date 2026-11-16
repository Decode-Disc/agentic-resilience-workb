import { AGENT_IDENTITIES, agentName } from "@convex/domain/agentIdentities";
import { registeredAgentDefinitions } from "@convex/execution/agentCatalog";
import { expect, test } from "vitest";
import {
    DEFAULT_CONVERSATION_AGENTS,
    SOURCES_AGENT,
    WORKBENCH_AGENT,
} from "@/components/chat/conversation-agent";

test("every registered agent definition names a known identity", () => {
    const definitions = registeredAgentDefinitions();
    expect(definitions.length).toBeGreaterThan(0);
    for (const definition of definitions) {
        expect(AGENT_IDENTITIES[definition.identity]).toBeDefined();
        expect(agentName(definition.identity)).toBe(
            AGENT_IDENTITIES[definition.identity].name,
        );
    }
});

test("the chat agents take their names and ids from the shared identities", () => {
    expect(WORKBENCH_AGENT.id).toBe("workbench");
    expect(WORKBENCH_AGENT.name).toBe("Workbench Agent");
    expect(SOURCES_AGENT.id).toBe("sources");
    expect(SOURCES_AGENT.name).toBe("Sources Agent");
    expect(DEFAULT_CONVERSATION_AGENTS.workbench.name).toBe(
        AGENT_IDENTITIES.workbench.name,
    );
    expect(DEFAULT_CONVERSATION_AGENTS.sources.name).toBe(
        AGENT_IDENTITIES.sources.name,
    );
    expect(DEFAULT_CONVERSATION_AGENTS.investigation.name).toBe(
        AGENT_IDENTITIES.investigation.name,
    );
    expect(DEFAULT_CONVERSATION_AGENTS.synthesis.name).toBe(
        AGENT_IDENTITIES.synthesis.name,
    );
});
