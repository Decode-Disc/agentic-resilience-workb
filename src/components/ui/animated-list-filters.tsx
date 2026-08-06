import { FilterIcon, Tick01Icon } from "@hugeicons/core-free-icons";
import { MotionConfig, motion } from "motion/react";
import { type ReactNode, useId, useMemo, useState } from "react";
import Icon from "@/components/icon";
import { cn } from "@/lib/utils";

type AnimatedListFilterOption<TValue extends string> = {
    value: TValue;
    label: string;
    renderIcon: (size: number) => ReactNode;
};

type AnimatedListFilterProps<TValue extends string> = {
    label: string;
    value: TValue;
    options: ReadonlyArray<AnimatedListFilterOption<TValue>>;
    onChange: (value: TValue) => void;
    className?: string;
};

type AnimatedOptionItemProps<TValue extends string> = {
    index: number;
    option: AnimatedListFilterOption<TValue>;
    isSelected: boolean;
    onSelect: (value: TValue) => void;
};

/**
 * One animated filter option row used by the expandable list selector.
 */
function AnimatedOptionItem<TValue extends string>({
    index,
    option,
    isSelected,
    onSelect,
}: AnimatedOptionItemProps<TValue>) {
    const delay = (index + 8) * 0.025;

    return (
        <motion.button
            type="button"
            initial={{ opacity: 0, y: 40 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{
                type: "spring",
                bounce: 0.1,
                duration: 0.25,
                delay,
                ease: [0.215, 0.61, 0.355, 1],
            }}
            onClick={() => {
                onSelect(option.value);
            }}
            className="flex w-full cursor-pointer items-center justify-between rounded-2xl px-3 py-2 text-foreground hover:bg-accent">
            <div className="flex items-center gap-x-3">
                <span className="text-muted-foreground">
                    {option.renderIcon(20)}
                </span>
                <span className="text-sm capitalize">{option.label}</span>
            </div>
            <div
                className={cn(
                    "relative h-5 w-5 overflow-hidden rounded-full border border-border",
                    isSelected
                        ? "border-primary bg-primary text-primary-foreground"
                        : "bg-background",
                )}>
                {isSelected ? (
                    <div className="absolute inset-0 flex items-center justify-center">
                        <Icon iconNode={Tick01Icon} size={14} />
                    </div>
                ) : null}
            </div>
        </motion.button>
    );
}

/**
 * Reusable animated list filter selector with expanding options popover panel.
 */
export default function AnimatedListFilter<TValue extends string>({
    label,
    value,
    options,
    onChange,
    className,
}: AnimatedListFilterProps<TValue>) {
    const [isOpened, setIsOpened] = useState(false);
    const layoutId = useId();
    const selectedOption = useMemo(
        () => options.find((option) => option.value === value) ?? options[0],
        [options, value],
    );

    return (
        <section
            className={cn(
                "relative flex items-center fill-muted-foreground/70",
                className,
            )}>
            <MotionConfig
                transition={{ type: "spring", duration: 0.85, bounce: 0.35 }}>
                <button
                    type="button"
                    onClick={() => {
                        setIsOpened(true);
                    }}
                    className="relative left-2.5 flex h-10 w-10 items-center justify-center"
                    aria-label={label}
                    title={label}>
                    <Icon
                        iconNode={FilterIcon}
                        className="relative z-10 text-foreground"
                        size={18}
                    />
                    <motion.div
                        layoutId={`wrapper-${layoutId}`}
                        className="absolute inset-0 z-[2] border border-border bg-background"
                        style={{ borderRadius: 9999 }}
                    />
                </button>

                <motion.button
                    type="button"
                    initial={{ x: 0 }}
                    animate={{ x: isOpened ? 30 : 0 }}
                    transition={{ type: "spring", bounce: 0.3, duration: 1.5 }}
                    className="relative right-2.5 flex h-10 min-w-28 items-center justify-center gap-2 rounded-full border border-border bg-background px-3 text-xs text-muted-foreground"
                    onClick={() => {
                        setIsOpened((open) => !open);
                    }}
                    aria-label={`${label}: ${selectedOption?.label ?? ""}`}>
                    <span>{selectedOption?.renderIcon(16)}</span>
                    <span className="truncate capitalize">
                        {selectedOption?.label}
                    </span>
                </motion.button>

                {isOpened ? (
                    <motion.section
                        layoutId={`wrapper-${layoutId}`}
                        className="absolute top-12 z-20 w-64 overflow-hidden rounded-2xl border border-border bg-card px-1 py-1 shadow-lg">
                        <div className="mb-1 flex items-center justify-between px-2 py-1.5 text-xs text-muted-foreground">
                            <span>{label}</span>
                            <button
                                type="button"
                                className="rounded px-1.5 py-0.5 hover:bg-accent"
                                onClick={() => {
                                    setIsOpened(false);
                                }}>
                                Confirmer
                            </button>
                        </div>

                        <div className="flex flex-col gap-1">
                            {options.map((option, index) => (
                                <AnimatedOptionItem
                                    key={option.value}
                                    index={index}
                                    option={option}
                                    isSelected={option.value === value}
                                    onSelect={(nextValue) => {
                                        onChange(nextValue);

                                        window.setTimeout(() => {
                                            setIsOpened(false);
                                        }, 150);
                                    }}
                                />
                            ))}
                        </div>
                    </motion.section>
                ) : null}
            </MotionConfig>
        </section>
    );
}
