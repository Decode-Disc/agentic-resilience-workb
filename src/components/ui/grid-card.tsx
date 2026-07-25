import type { ComponentProps } from 'react';

import { GridPattern } from '@/components/ui/grid-pattern';
import { cn } from '@/lib/utils';

type GridCardProps = ComponentProps<'div'> & {
    tone?: 'primary' | 'accent';
};

/** A restrained content card with a semantic, decorative grid surface. */
function GridCard({
    children,
    className,
    tone = 'primary',
    ...props
}: GridCardProps) {
    return (
        <div
            data-slot="grid-card"
            data-tone={tone}
            className={cn(
                'relative isolate overflow-hidden rounded-xl border border-border bg-card/82 p-5 text-card-foreground shadow-sm backdrop-blur-md',
                className,
            )}
            {...props}
        >
            <GridPattern
                width={28}
                height={28}
                squares={[
                    [1, 1],
                    [3, 0],
                    [4, 2],
                ]}
                className={cn(
                    '[mask-image:linear-gradient(135deg,black,transparent_72%)]',
                    tone === 'primary'
                        ? 'fill-primary/9 stroke-primary/15'
                        : 'fill-accent/10 stroke-accent/18',
                )}
            />
            <div className="relative z-10">{children}</div>
        </div>
    );
}

export { GridCard, type GridCardProps };
