import {
    BubbleChatIcon,
    LibraryIcon,
    MicroscopeIcon,
    Note01Icon,
} from "@hugeicons/core-free-icons";
import type { PlatformIcon } from "@/types/ui";
import type { WorkspaceSection } from "@/lib/workspace/navigation";

/**
 * One icon per dossier stage, shared by the workspace dock and the agent that
 * works the stage: gather (Library), examine (Microscope), write (Note).
 */
export const stageIcons = {
    overview: BubbleChatIcon,
    sources: LibraryIcon,
    investigation: MicroscopeIcon,
    synthesis: Note01Icon,
} as const satisfies Record<WorkspaceSection, PlatformIcon>;
