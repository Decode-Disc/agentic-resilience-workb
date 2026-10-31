/** Display identity supplied by the consumer, independent from message roles and execution providers. */
export type ConversationAgent = { id: string; name: string };
export type ConversationAgents = Readonly<Record<string, ConversationAgent>>;

export const WORKBENCH_AGENT: ConversationAgent = {
    id: "workbench",
    name: "Workbench Agent",
};
export const DEFAULT_CONVERSATION_AGENTS: ConversationAgents = {
    [WORKBENCH_AGENT.id]: WORKBENCH_AGENT,
};
