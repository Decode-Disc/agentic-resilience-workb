import type { api } from '@convex/_generated/api';
import type { FunctionReturnType } from 'convex/server';

import { CompanyFaviconAvatar } from '@/components/company-favicon-avatar';

type ResolvedCompany = FunctionReturnType<
    typeof api.companyResolution.preflight
>['company'];

/** Shows the public company record the analyst is about to confirm. */
export function CompanyResolutionCard({
    company,
}: {
    company: ResolvedCompany;
}) {
    return (
        <article className="surface-panel rounded-xl p-4" aria-live="polite">
            <div className="flex min-w-0 gap-3">
                <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-accent text-accent-foreground">
                    <CompanyFaviconAvatar company={company} size="sm" />
                </span>
                <div className="min-w-0">
                    <p className="text-base font-medium text-foreground">
                        {company.legalName}
                    </p>
                    <p className="mt-1 font-mono text-xs text-muted-foreground">
                        {company.ticker} · {company.exchange}
                    </p>
                    <p className="mt-1 font-mono text-[10px] text-muted-foreground">
                        CIK {company.cik}
                    </p>
                </div>
            </div>
        </article>
    );
}
