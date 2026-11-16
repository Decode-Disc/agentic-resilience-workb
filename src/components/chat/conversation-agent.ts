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
    id: "workbench",
    name: "Workbench Agent",
    icon: AiChat02Icon,
} satisfies ConversationAgent;
export const SOURCES_AGENT = {
    id: "sources",
    name: "Sources Agent",
    icon: FileSearchIcon,
} satisfies ConversationAgent;

export const DEFAULT_CONVERSATION_AGENTS: ConversationAgents = {
    [WORKBENCH_AGENT.id]: WORKBENCH_AGENT,
    sources: SOURCES_AGENT,
    investigation: {
        id: "investigation",
        name: "Investigation Agent",
        icon: AiSearch02Icon,
    },
    synthesis: {
        id: "synthesis",
        name: "Synthesis Agent",
        icon: WorkflowSquare01Icon,
    },
};
