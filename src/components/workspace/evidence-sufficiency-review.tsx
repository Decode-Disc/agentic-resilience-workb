'use client';

import type { api } from '@convex/_generated/api';
import { Plus } from '@hugeicons/core-free-icons';
import type { FunctionArgs } from 'convex/server';
import { useState } from 'react';

import Icon from '@/components/icon';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { AddSourceDialog } from '@/components/workspace/add-source-dialog';

type SufficiencyDecision = FunctionArgs<
    typeof api.evidenceSufficiency.decide
>['decision'];

/** Durable human checkpoint for a run with insufficient public evidence. */
export function EvidenceSufficiencyReview({
    onAddManualUrl,
    onDecide,
}: {
    onAddManualUrl: (url: string) => void | Promise<void>;
    onDecide: (decision: SufficiencyDecision) => void | Promise<void>;
}) {
    const [reason, setReason] = useState('');
    const [pendingDecision, setPendingDecision] = useState<
        SufficiencyDecision['kind'] | null
    >(null);
    const [error, setError] = useState<string | null>(null);
    const validReason = reason.trim().length >= 12;

    async function submit(decision: SufficiencyDecision) {
        setPendingDecision(decision.kind);
        setError(null);
        try {
            await onDecide(decision);
        } catch {
            setError("We couldn't save this evidence decision. Try again.");
        } finally {
            setPendingDecision(null);
        }
    }

    return (
        <section
            className="surface-floating mb-5 rounded-xl p-5"
            aria-label="Evidence sufficiency review"
        >
            <p className="text-micro text-brand-purple">
                Your review is required
            </p>
            <h2 className="mt-2 text-lg font-medium">
                Public evidence is insufficient
            </h2>
            <p className="mt-2 text-sm text-muted-foreground">
                Add another public source and check again, finish this dossier
                with limited evidence, or explain why you want to continue.
                Research waits for your decision.
            </p>
            <div className="mt-5">
                <AddSourceDialog
                    trigger={
                        <Button type="button" variant="outline">
                            <Icon iconNode={Plus} />
                            Add public source link
                        </Button>
                    }
                    onAdd={onAddManualUrl}
                />
            </div>
            <div className="mt-4">
                <Button
                    type="button"
                    variant="secondary"
                    disabled={pendingDecision !== null}
                    onClick={() =>
                        void submit({
                            kind: 'recheck',
                            decisionKey: crypto.randomUUID(),
                        })
                    }
                >
                    {pendingDecision === 'recheck'
                        ? 'Rechecking…'
                        : 'Recheck evidence'}
                </Button>
            </div>
            <div className="mt-5 space-y-2 border-t border-border/60 pt-5">
                <Label htmlFor="sufficiency-decision-reason">
                    Reason for this decision
                </Label>
                <Textarea
                    id="sufficiency-decision-reason"
                    value={reason}
                    onChange={(event) => setReason(event.target.value)}
                    placeholder="Explain why this research should finish or continue."
                />
                <p className="text-xs text-muted-foreground">
                    Briefly explain your reasoning so the decision record stays
                    clear.
                </p>
                <div className="flex flex-wrap gap-2">
                    <Button
                        type="button"
                        variant="outline"
                        disabled={!validReason || pendingDecision !== null}
                        onClick={() =>
                            void submit({
                                kind: 'complete_insufficient',
                                decisionKey: crypto.randomUUID(),
                                reason: reason.trim(),
                            })
                        }
                    >
                        {pendingDecision === 'complete_insufficient'
                            ? 'Completing…'
                            : 'Finish with limited evidence'}
                    </Button>
                    <Button
                        type="button"
                        disabled={!validReason || pendingDecision !== null}
                        onClick={() =>
                            void submit({
                                kind: 'force_continue',
                                decisionKey: crypto.randomUUID(),
                                reason: reason.trim(),
                            })
                        }
                    >
                        {pendingDecision === 'force_continue'
                            ? 'Continuing…'
                            : 'Continue with limited evidence'}
                    </Button>
                </div>
            </div>
            {error ? (
                <p role="alert" className="mt-4 text-sm text-destructive">
                    {error}
                </p>
            ) : null}
        </section>
    );
}
