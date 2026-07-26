import { createFileRoute, Outlet } from '@tanstack/react-router'
import { WorkbenchShell } from '@/components/workbench-shell/workbench-shell';

export const Route = createFileRoute('/workspace')({
  component: RouteComponent,
})

function RouteComponent() {
  return (
    <WorkbenchShell>
      <Outlet />
    </WorkbenchShell>
  );
}
