import { useIsMobile } from '@/hooks/use-mobile';

export function useResponsive() {
    const isMobile = useIsMobile();

    return {
        isMobile,
        isDesktop: !isMobile,
    } as const;
}
