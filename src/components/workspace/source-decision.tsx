import type { api } from '@convex/_generated/api';
import {
    Cancel01Icon,
    CheckmarkCircle02Icon,
    Clock01Icon,
} from '@hugeicons/core-free-icons';
import type { FunctionArgs } from 'convex/server';
import Icon from '@/components/icon';
import { sourceDecisionLabel } from '@/lib/presentation/research-copy';
import { cn } from '@/lib/utils';

type SourceDecision = FunctionArgs<typeof api.sources.decide>['decision'];
type SourceDecisionStatusTone = 'success' | 'danger' | 'warning';

type SourceDecisionDefinition = {
    decision: SourceDecision;
    actionLabel: string;
    label: string;
    status: SourceDecisionStatusTone;
    icon: typeof CheckmarkCircle02Icon;
};

const sourceDecisionDefinitionsByDecision: Record<
    SourceDecision,
    SourceDecisionDefinition
> = {
    accepted: {
        decision: 'accepted',
        actionLabel: 'Accept',
        label: sourceDecisionLabel('accepted'),
        status: 'success',
        icon: CheckmarkCircle02Icon,
    },
    rejected: {
        decision: 'rejected',
        actionLabel: 'Reject',
        label: sourceDecisionLabel('rejected'),
        status: 'danger',
        icon: Cancel01Icon,
    },
    pending: {
        decision: 'pending',
        actionLabel: 'Keep pending',
        label: sourceDecisionLabel('pending'),
        status: 'warning',
        icon: Clock01Icon,
    },
};

const sourceDecisionStatusClassNames: Record<
    SourceDecisionStatusTone,
    string
> = {
    success: 'border-success/25 bg-success/10 text-success',
    danger: 'border-danger/25 bg-danger/10 text-danger',
    warning: 'border-warning/25 bg-warning/10 text-warning',
};

const sourceDecisionIconClassNames: Record<
    SourceDecisionStatusTone,
    string
> = {
    success: 'text-success',
    danger: 'text-danger',
    warning: 'text-warning',
};

const sourceDecisionActiveButtonClassNames: Record<
    SourceDecisionStatusTone,
    string
> = {
    success:
        'border-success/30 bg-success/10 text-success hover:bg-success/15',
    danger: 'border-danger/30 bg-danger/10 text-danger hover:bg-danger/15',
    warning:
        'border-warning/30 bg-warning/10 text-warning hover:bg-warning/15',
};

export const sourceDecisionDefinitions = [
    sourceDecisionDefinitionsByDecision.accepted,
    sourceDecisionDefinitionsByDecision.rejected,
    sourceDecisionDefinitionsByDecision.pending,
] as const;

const sourceReviewQueueRank: Record<SourceDecision, number> = {
    pending: 0,
    accepted: 1,
    rejected: 2,
};

export function compareSourceReviewDecisions(
    left: SourceDecision,
    right: SourceDecision,
): number {
    return sourceReviewQueueRank[left] - sourceReviewQueueRank[right];
}

export function getSourceDecisionDefinition(
    decision: SourceDecision,
): SourceDecisionDefinition {
    return sourceDecisionDefinitionsByDecision[decision];
}

export function getSourceDecisionIconClassName(decision: SourceDecision): string {
    return sourceDecisionIconClassNames[
        getSourceDecisionDefinition(decision).status
    ];
}

export function getSourceDecisionActiveButtonClassName(
    decision: SourceDecision,
): string {
    return sourceDecisionActiveButtonClassNames[
        getSourceDecisionDefinition(decision).status
    ];
}

export function getSourceDecisionButtonLabel(
    decision: SourceDecision,
    selected: boolean,
): string {
    const definition = getSourceDecisionDefinition(decision);
    return selected ? definition.label : definition.actionLabel;
}

export function SourceDecisionStatus({
    decision,
    className,
}: {
    decision: SourceDecision;
    className?: string;
}) {
    const definition = getSourceDecisionDefinition(decision);

    return (
        <span
            data-slot="source-decision-status"
            data-status={definition.status}
            className={cn(
                'inline-flex items-center gap-1 rounded-badge border px-2 py-0.5 text-xs font-medium',
                sourceDecisionStatusClassNames[definition.status],
                className,
            )}
        >
            <span data-slot="source-decision-icon" aria-hidden="true">
                <Icon iconNode={definition.icon} size={14} className={sourceDecisionIconClassNames[definition.status]} />
            </span>
            {definition.label}
        </span>
    );
}
