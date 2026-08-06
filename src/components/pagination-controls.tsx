import {
    ArrowLeft01Icon,
    ArrowRight01Icon,
} from '@hugeicons/core-free-icons';

import Icon from '@/components/icon';
import {
    Pagination,
    PaginationButton,
    PaginationContent,
    PaginationEllipsis,
    PaginationItem,
} from '@/components/ui/pagination';
import { cn } from '@/lib/utils';

type PaginationEntry = number | 'ellipsis-start' | 'ellipsis-end';

export interface PaginationControlsProps {
    page: number;
    pageCount: number;
    onPageChange: (page: number) => void;
    disabled?: boolean;
    ariaLabel?: string;
    className?: string;
    siblingCount?: number;
}

function paginationEntries(
    page: number,
    pageCount: number,
    siblingCount: number,
): Array<PaginationEntry> {
    if (pageCount <= siblingCount * 2 + 5) {
        return Array.from({ length: pageCount }, (_, index) => index + 1);
    }

    const entries: Array<PaginationEntry> = [1];
    const start = Math.max(2, page - siblingCount);
    const end = Math.min(pageCount - 1, page + siblingCount);

    if (start > 2) {
        entries.push('ellipsis-start');
    }
    for (let candidate = start; candidate <= end; candidate += 1) {
        entries.push(candidate);
    }
    if (end < pageCount - 1) {
        entries.push('ellipsis-end');
    }
    entries.push(pageCount);
    return entries;
}

export function PaginationControls({
    page,
    pageCount,
    onPageChange,
    disabled = false,
    ariaLabel = 'Pagination',
    className,
    siblingCount = 1,
}: PaginationControlsProps) {
    if (pageCount <= 1) {
        return null;
    }

    const currentPage = Math.min(Math.max(page, 1), pageCount);
    const entries = paginationEntries(
        currentPage,
        pageCount,
        Math.max(0, siblingCount),
    );

    return (
        <Pagination aria-label={ariaLabel} className={cn(className)}>
            <PaginationContent>
                <PaginationItem>
                    <PaginationButton
                        aria-label="Go to previous page"
                        disabled={disabled || currentPage === 1}
                        onClick={() => onPageChange(currentPage - 1)}
                    >
                        <Icon iconNode={ArrowLeft01Icon} strokeWidth={2} />
                    </PaginationButton>
                </PaginationItem>
                {entries.map((entry) =>
                    typeof entry === 'number' ? (
                        <PaginationItem key={entry}>
                            <PaginationButton
                                isActive={entry === currentPage}
                                aria-label={`Page ${entry}`}
                                disabled={disabled}
                                onClick={() => onPageChange(entry)}
                            >
                                {entry}
                            </PaginationButton>
                        </PaginationItem>
                    ) : (
                        <PaginationItem key={entry}>
                            <PaginationEllipsis />
                        </PaginationItem>
                    ),
                )}
                <PaginationItem>
                    <PaginationButton
                        aria-label="Go to next page"
                        disabled={disabled || currentPage === pageCount}
                        onClick={() => onPageChange(currentPage + 1)}
                    >
                        <Icon iconNode={ArrowRight01Icon} strokeWidth={2} />
                    </PaginationButton>
                </PaginationItem>
            </PaginationContent>
        </Pagination>
    );
}
