import { createFileRoute } from "@tanstack/react-router";
import { StartResearchPage } from "@/components/workspace/start/start-research-page";

export const Route = createFileRoute("/workspace/start")({
    component: StartResearchPage,
});
