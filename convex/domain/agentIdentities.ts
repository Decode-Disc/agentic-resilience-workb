/** Display identity for an analytical or conversational agent, independent of execution providers. */
export type AgentIdentity = { readonly id: string; readonly name: string };

/** Canonical registry of agent display identities shared across Convex definitions and UI surfaces. */
export const AGENT_IDENTITIES = {
    workbench: { id: "workbench", name: "Workbench Agent" },
    sources: { id: "sources", name: "Sources Agent" },
    investigation: { id: "investigation", name: "Investigation Agent" },
    synthesis: { id: "synthesis", name: "Synthesis Agent" },
} as const satisfies Record<string, AgentIdentity>;

export type AgentIdentityId = keyof typeof AGENT_IDENTITIES;

/** Returns the canonical display name for a registered agent identity. */
export function agentName(id: AgentIdentityId): string {
    return AGENT_IDENTITIES[id].name;
}
