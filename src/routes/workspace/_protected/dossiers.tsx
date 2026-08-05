import { createFileRoute } from '@tanstack/react-router';

import { ResearchDossiersPage } from '@/components/workspace/research-dossiers-page';

export const Route = createFileRoute('/workspace/_protected/dossiers')({
    component: ResearchDossiersPage,
});
