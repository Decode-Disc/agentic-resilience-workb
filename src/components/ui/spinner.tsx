import { Loading03Icon } from '@hugeicons/core-free-icons';
import { HugeiconsIcon } from '@hugeicons/react';
import { cn } from '@/lib/utils';

function Spinner({ className, ...props }: React.ComponentProps<'svg'>) {
    return (
        <HugeiconsIcon
            icon={Loading03Icon}
            // @ts-expect-error - HugeiconsIcon is a React component, but it doesn't have the correct type for the props. We can ignore this error for now.
            strokeWidth={2}
            data-slot="spinner"
            role="status"
            aria-label="Loading"
            className={cn('size-4 animate-spin', className)}
            {...props}
        />
    );
}

export { Spinner };
