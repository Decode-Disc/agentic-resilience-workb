import {
    createContext,
    type Dispatch,
    type SetStateAction,
    useContext,
    useEffect,
} from "react";
export const WorkbenchViewportContext = createContext<Dispatch<
    SetStateAction<boolean>
> | null>(null);
/** Requests the shell's bounded conversation viewport; ordinary dossier pages keep document scrolling. */
export function useWorkbenchViewport(enabled: boolean) {
    const setViewport = useContext(WorkbenchViewportContext);
    useEffect(() => {
        setViewport?.(enabled);
        return () => setViewport?.(false);
    }, [enabled, setViewport]);
}
