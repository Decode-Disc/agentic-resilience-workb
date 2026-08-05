import { createFileRoute } from '@tanstack/react-router';

import { WorkbenchShell } from '@/components/workbench-shell/workbench-shell';
import { ProtoSourceReview } from '@/components/prototype/proto-source-review';

export const Route = createFileRoute('/prototype/source-review')({
    component: () => (
        <WorkbenchShell>
            <ProtoSourceReview />
        </WorkbenchShell>
    ),
});
