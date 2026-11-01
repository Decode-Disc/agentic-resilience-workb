import { createFileRoute } from "@tanstack/react-router";
import { WorkbenchUiRoot } from "@/components/workbench-ui/root";
import { ResearchComposer } from "@/components/workspace/research-composer";
export const Route = createFileRoute("/workspace/start")({
    component: StartAnalysisRoute,
});
function StartAnalysisRoute() {
    return (
        <WorkbenchUiRoot>
            <ResearchComposer
                showStartScreen
                placeholderText="Describe the resilience question to focus on for research. Or choose a company to start."
            />
        </WorkbenchUiRoot>
    );
}
