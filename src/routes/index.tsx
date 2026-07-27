import { createFileRoute } from '@tanstack/react-router';

import { IndexPage } from '@/components/landing/index-page';

export const Route = createFileRoute('/')({
    component: IndexPage,
});
