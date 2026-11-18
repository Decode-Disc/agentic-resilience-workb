import {
    type ConversationAgent,
    DEFAULT_CONVERSATION_AGENTS,
    WORKBENCH_AGENT,
} from "@/components/chat/conversation-agent";
import Icon from "@/components/icon";
import { cn } from "@/lib/utils";

/** Keeps an agent's label and glyph together across conversation and work surfaces. */
export function AgentIdentity({
    agent,
    className,
}: {
    agent: ConversationAgent;
    className?: string;
}) {
    return (
        <span
            data-slot="agent-identity"
            data-agent-id={agent.id}
            className={cn(
                "inline-flex min-w-0 items-center gap-2 font-sans normal-case tracking-normal",
                className,
            )}>
            <span aria-hidden="true" className="inline-flex shrink-0">
                <Icon
                    iconNode={
                        agent.icon ??
                        DEFAULT_CONVERSATION_AGENTS[agent.id]?.icon ??
                        WORKBENCH_AGENT.icon
                    }
                    size={17}
                    className="shrink-0 text-brand-purple"
                />
            </span>
            <span>{agent.name}</span>
        </span>
    );
}

/** Quiet attribution of work to the agent that produced it, in the neutral text tone. */
export function AgentByline({
    agent,
    className,
}: {
    agent: ConversationAgent;
    className?: string;
}) {
    return (
        <span
            data-slot="agent-byline"
            className={cn(
                "inline-flex min-w-0 items-center gap-1.5 text-[12.5px] text-muted-foreground",
                className,
            )}>
            Prepared by
            <span className="inline-flex min-w-0 items-center gap-1.5 text-foreground">
                <Icon
                    iconNode={
                        agent.icon ??
                        DEFAULT_CONVERSATION_AGENTS[agent.id]?.icon ??
                        WORKBENCH_AGENT.icon
                    }
                    size={14}
                    className="shrink-0"
                />
                {agent.name}
            </span>
        </span>
    );
}
