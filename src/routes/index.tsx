import { createFileRoute } from "@tanstack/react-router"

import { WorkbenchShell } from "@/components/workbench-shell/workbench-shell"

export const Route = createFileRoute("/")({
  component: WorkbenchShell,
})
