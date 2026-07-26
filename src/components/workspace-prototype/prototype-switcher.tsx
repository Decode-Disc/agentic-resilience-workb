import { ArrowLeft01Icon, ArrowRight01Icon } from '@hugeicons/core-free-icons';
import { useEffect } from 'react';

import Icon from '@/components/icon';
import { Button } from '@/components/ui/button';

import {
    type PrototypeVariant,
    prototypeVariantLabels,
} from './prototype-data';

const variants = ['a', 'b', 'c'] as const satisfies readonly PrototypeVariant[];

function isInteractiveTarget(target: EventTarget | null) {
    return (
        target instanceof HTMLElement &&
        (target.matches(
            'a[href], button, input, textarea, select, [role="separator"]',
        ) ||
            target.isContentEditable)
    );
}

export function PrototypeSwitcher({
    current,
    onSelect,
}: {
    current: PrototypeVariant;
    onSelect: (variant: PrototypeVariant) => void;
}) {
    const currentIndex = variants.indexOf(current);
    const previous =
        variants[(currentIndex - 1 + variants.length) % variants.length] ?? 'a';
    const next = variants[(currentIndex + 1) % variants.length] ?? 'a';

    useEffect(() => {
        function handleKeyDown(event: KeyboardEvent) {
            if (isInteractiveTarget(event.target)) {
                return;
            }

            if (event.key === 'ArrowLeft') {
                event.preventDefault();
                onSelect(previous);
            }

            if (event.key === 'ArrowRight') {
                event.preventDefault();
                onSelect(next);
            }
        }

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [next, onSelect, previous]);

    return (
        <div className="fixed inset-x-0 bottom-5 z-20 flex justify-center px-4">
            <div className="flex items-center gap-2 rounded-full bg-foreground p-1.5 text-background shadow-xl ring-1 ring-background/20">
                <Button
                    variant="ghost"
                    size="icon-sm"
                    className="text-background hover:bg-background/15 hover:text-background"
                    aria-label={`Show ${prototypeVariantLabels[previous]}`}
                    onClick={() => onSelect(previous)}
                >
                    <Icon iconNode={ArrowLeft01Icon} size={16} />
                </Button>
                <div className="min-w-40 px-2 text-center">
                    <p className="text-xs font-medium">
                        {current.toUpperCase()} —{' '}
                        {prototypeVariantLabels[current]}
                    </p>
                    <p className="text-[10px] text-background/60">
                        Use ← and → to compare
                    </p>
                </div>
                <Button
                    variant="ghost"
                    size="icon-sm"
                    className="text-background hover:bg-background/15 hover:text-background"
                    aria-label={`Show ${prototypeVariantLabels[next]}`}
                    onClick={() => onSelect(next)}
                >
                    <Icon iconNode={ArrowRight01Icon} size={16} />
                </Button>
            </div>
        </div>
    );
}
