import {
    AGENT_IDENTITIES,
    type AgentIdentityId,
} from "@convex/domain/agentIdentities";
import {
    AiChat02Icon,
    AiSearch02Icon,
    FileSearchIcon,
    WorkflowSquare01Icon,
} from "@hugeicons/core-free-icons";
import type { PlatformIcon } from "@/types/ui";

/** Display identity, independent from message roles and execution providers. */
export type ConversationAgent = {
    id: string;
    name: string;
    icon?: PlatformIcon;
};
export type ConversationAgents = Readonly<Record<string, ConversationAgent>>;

export const WORKBENCH_AGENT = {
    ...AGENT_IDENTITIES.workbench,
    icon: AiChat02Icon,
} satisfies ConversationAgent;
export const SOURCES_AGENT = {
    ...AGENT_IDENTITIES.sources,
    icon: FileSearchIcon,
} satisfies ConversationAgent;

export const DEFAULT_CONVERSATION_AGENTS: ConversationAgents &
    Readonly<Record<AgentIdentityId, ConversationAgent>> = {
    [WORKBENCH_AGENT.id]: WORKBENCH_AGENT,
    [SOURCES_AGENT.id]: SOURCES_AGENT,
    investigation: {
        ...AGENT_IDENTITIES.investigation,
        icon: AiSearch02Icon,
    },
    synthesis: {
        ...AGENT_IDENTITIES.synthesis,
        icon: WorkflowSquare01Icon,
    },
};
