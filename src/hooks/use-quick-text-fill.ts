import { useAnimate, useReducedMotion } from "motion/react";
import { useRef } from "react";

/** Fills and focuses an editable field, briefly revealing a selected text preset. */
export function useQuickTextFill<
    T extends HTMLInputElement | HTMLTextAreaElement,
>(onValueChange: (value: string) => void) {
    const [inputRef, animate] = useAnimate<T>();
    const reducedMotion = useReducedMotion();
    const playback = useRef<ReturnType<typeof animate> | null>(null);

    function fill(text: string) {
        playback.current?.stop();
        onValueChange(text);
        const input = inputRef.current;
        if (!input) return;
        input.focus();
        if (reducedMotion) {
            input.style.opacity = "";
            return;
        }
        playback.current = animate(
            input,
            { opacity: [0.25, 1] },
            { duration: 0.32, ease: "easeOut" },
        );
    }

    return { inputRef, fill };
}
