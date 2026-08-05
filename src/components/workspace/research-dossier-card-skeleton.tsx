import {
    CutoutCardContent,
    CutoutCardFooter,
    CutoutCardInsetLabel,
    CutoutCardMedia,
    CutoutCardPin,
    cutoutCardSurfaceClassName,
    CutoutCorner,
} from '@/components/ui/cutout-card';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

/**
 * Preserves the complete dossier-card silhouette while its data loads.
 */
export function ResearchDossierCardSkeleton() {
    return (
        <div
            aria-hidden="true"
            className={cn(
                cutoutCardSurfaceClassName,
                'pointer-events-none h-full w-full max-w-md cursor-default',
            )}
            data-slot="research-dossier-card-skeleton"
        >
            <CutoutCardMedia className="h-72">
                <Skeleton className="h-full w-full rounded-none" />

                <CutoutCardInsetLabel className="bottom-0 left-0 rounded-tr-[20px] bg-card px-5 py-3">
                    <Skeleton className="h-3 w-28 rounded-sm" />
                    <CutoutCorner className="absolute -right-[31px] -bottom-px rotate-90 text-card" />
                    <CutoutCorner className="absolute -top-[31px] -left-px rotate-90 text-card" />
                </CutoutCardInsetLabel>

                <CutoutCardPin className="top-0 right-0 rounded-bl-[16px] bg-primary px-4 py-2 shadow-foreground/10 shadow-md ring-1 ring-border/30">
                    <Skeleton className="h-4 w-24 bg-primary-foreground/25" />
                    <CutoutCorner
                        className="absolute top-0 -left-[23px] -rotate-90 text-primary"
                        size={24}
                    />
                    <CutoutCorner
                        className="absolute right-0 -bottom-[23px] -rotate-90 text-primary"
                        size={24}
                    />
                </CutoutCardPin>
            </CutoutCardMedia>

            <CutoutCardContent>
                <Skeleton className="mb-3 h-6 w-3/5 rounded-md" />
                <div className="mb-5 space-y-2">
                    <Skeleton className="h-4 w-full rounded-sm" />
                    <Skeleton className="h-4 w-4/5 rounded-sm" />
                </div>
                <CutoutCardFooter className="border-border/80 border-t pt-4">
                    <div className="flex items-center gap-3">
                        <Skeleton className="h-8 w-8 rounded-full" />
                        <Skeleton className="h-4 w-24 rounded-sm" />
                    </div>
                    <Skeleton className="h-3 w-20 rounded-sm" />
                </CutoutCardFooter>
            </CutoutCardContent>
        </div>
    );
}
