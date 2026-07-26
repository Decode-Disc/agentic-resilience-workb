import {
    ArrowRight01Icon,
    CheckmarkCircle02Icon,
} from '@hugeicons/core-free-icons';
import { HugeiconsIcon } from '@hugeicons/react';
import { useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';

import {
    type PrototypeClaim,
    prototypeClaims,
    prototypeDimensions,
} from './prototype-data';
import { DossierHeading, PrototypeNotice } from './prototype-primitives';

export function VariantMasterDetail() {
    const [selectedClaimId, setSelectedClaimId] = useState<
        PrototypeClaim['id']
    >(prototypeClaims[1].id);
    const selectedClaim =
        prototypeClaims.find((claim) => claim.id === selectedClaimId) ??
        prototypeClaims[0];

    return (
        <div className="min-h-svh bg-background text-foreground">
            <PrototypeNotice />
            <header className="border-b px-5 py-5 sm:px-8">
                <div className="mx-auto flex max-w-[100rem] flex-col justify-between gap-5 lg:flex-row lg:items-end">
                    <DossierHeading compact />
                    <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                        <span>Progress</span>
                        <HugeiconsIcon
                            icon={ArrowRight01Icon}
                            aria-hidden="true"
                            className="size-3"
                        />
                        <span>Sources</span>
                        <HugeiconsIcon
                            icon={ArrowRight01Icon}
                            aria-hidden="true"
                            className="size-3"
                        />
                        <span className="font-medium text-foreground">
                            Evidence review
                        </span>
                    </div>
                </div>
            </header>

            <main className="mx-auto grid max-w-[100rem] lg:min-h-[calc(100svh-11rem)] lg:grid-cols-[22rem_minmax(0,1fr)_18rem]">
                <section
                    className="border-b px-4 py-6 lg:border-r lg:border-b-0"
                    aria-labelledby="claim-list"
                >
                    <div className="mb-4 flex items-center justify-between gap-3">
                        <h2 id="claim-list" className="text-sm font-medium">
                            Claims requiring attention
                        </h2>
                        <Badge variant="secondary">3</Badge>
                    </div>
                    <div className="flex flex-col gap-2">
                        {prototypeClaims.map((claim) => {
                            const selected = claim.id === selectedClaim.id;

                            return (
                                <button
                                    key={claim.id}
                                    type="button"
                                    className={
                                        selected
                                            ? 'rounded-xl bg-muted p-3 text-left ring-1 ring-foreground/10'
                                            : 'rounded-xl p-3 text-left hover:bg-muted/60'
                                    }
                                    onClick={() => setSelectedClaimId(claim.id)}
                                >
                                    <div className="mb-2 flex items-center justify-between gap-2">
                                        <Badge variant="outline">
                                            {claim.classification}
                                        </Badge>
                                        <span className="text-xs text-muted-foreground">
                                            {claim.status}
                                        </span>
                                    </div>
                                    <p className="line-clamp-3 text-sm leading-5">
                                        {claim.statement}
                                    </p>
                                </button>
                            );
                        })}
                    </div>
                </section>

                <article className="min-w-0 border-b px-5 py-8 sm:px-8 lg:border-b-0">
                    <div className="mx-auto flex max-w-3xl flex-col gap-8">
                        <div>
                            <div className="mb-4 flex flex-wrap gap-2">
                                <Badge variant="outline">
                                    {selectedClaim.classification}
                                </Badge>
                                <Badge variant="secondary">
                                    {selectedClaim.dimension}
                                </Badge>
                            </div>
                            <h2 className="text-2xl leading-9 font-medium sm:text-3xl">
                                {selectedClaim.statement}
                            </h2>
                        </div>

                        <section aria-labelledby="passage-heading">
                            <p
                                id="passage-heading"
                                className="text-xs font-medium tracking-[0.12em] text-muted-foreground uppercase"
                            >
                                Supporting passage
                            </p>
                            <blockquote className="mt-3 border-l-2 pl-5 text-base leading-8">
                                “Our cloud platform connects participants across
                                the property and casualty insurance economy and
                                supports mission-critical workflows from initial
                                claim through repair resolution.”
                            </blockquote>
                            <p className="mt-3 text-xs text-muted-foreground">
                                {selectedClaim.evidence} ·{' '}
                                {selectedClaim.locator}
                            </p>
                        </section>

                        <Separator />

                        <section aria-labelledby="counter-heading">
                            <p
                                id="counter-heading"
                                className="text-xs font-medium tracking-[0.12em] text-muted-foreground uppercase"
                            >
                                Counter-evidence and limits
                            </p>
                            <p className="mt-3 text-sm leading-7">
                                {selectedClaim.counterEvidence}
                            </p>
                        </section>

                        <div className="flex flex-wrap gap-2">
                            <Button>
                                <HugeiconsIcon
                                    icon={CheckmarkCircle02Icon}
                                    data-icon="inline-start"
                                />
                                Approve claim
                            </Button>
                            <Button variant="outline">Request revision</Button>
                        </div>
                    </div>
                </article>

                <aside className="bg-muted/30 px-5 py-7 lg:border-l">
                    <h2 className="text-sm font-medium">Assessment impact</h2>
                    <p className="mt-2 text-xs leading-5 text-muted-foreground">
                        This panel exposes the analytical consequence before a
                        decision is recorded.
                    </p>
                    <div className="mt-6 flex flex-col gap-5">
                        {prototypeDimensions.slice(0, 3).map((dimension) => (
                            <div key={dimension.name}>
                                <p className="text-sm font-medium">
                                    {dimension.name}
                                </p>
                                <p className="mt-1 text-xs text-muted-foreground">
                                    {dimension.position} ·{' '}
                                    {dimension.confidence} confidence
                                </p>
                            </div>
                        ))}
                    </div>
                </aside>
            </main>
        </div>
    );
}
