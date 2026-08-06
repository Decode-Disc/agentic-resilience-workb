"use client";

import { api } from "@convex/_generated/api";
import { ArrowRight01Icon, Cancel01Icon } from "@hugeicons/core-free-icons";
import { useAction } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { REGEXP_ONLY_DIGITS } from "input-otp";
import { type FormEvent, useState } from "react";

import Icon from "@/components/icon";
import { Button } from "@/components/ui/button";
import {
    Drawer,
    DrawerClose,
    DrawerContent,
    DrawerDescription,
    DrawerFooter,
    DrawerHeader,
    DrawerTitle,
} from "@/components/ui/drawer";
import {
    InputOTP,
    InputOTPGroup,
    InputOTPSlot,
} from "@/components/ui/input-otp";
import { Label } from "@/components/ui/label";
import { accessCodeErrorMessage } from "@/lib/presentation/research-copy";

type Admission = FunctionReturnType<typeof api.invitations.claim>;
const invitationOtpSlots = [0, 1, 2, 3] as const;

export interface InvitationAccessDrawerProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onAdmitted: (admission: Admission) => void | Promise<void>;
}

/** Collects a reusable workspace access code without displacing route state. */
export function InvitationAccessDrawer({
    open,
    onOpenChange,
    onAdmitted,
}: InvitationAccessDrawerProps) {
    const claimInvitation = useAction(api.invitations.claim);
    const [code, setCode] = useState("");
    const [error, setError] = useState<string | null>(null);
    const [isSubmitting, setIsSubmitting] = useState(false);

    const submit = async (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        const normalizedCode = code.trim();
        if (!/^\d{4}$/.test(normalizedCode)) {
            setError("Enter the four-digit access code.");
            return;
        }

        setError(null);
        setIsSubmitting(true);
        try {
            const admission = await claimInvitation({ code: normalizedCode });
            await onAdmitted(admission);
            setCode("");
            onOpenChange(false);
        } catch (caughtError) {
            setError(accessCodeErrorMessage(caughtError));
        } finally {
            setIsSubmitting(false);
        }
    };

    return (
        <Drawer
            open={open}
            onOpenChange={onOpenChange}
            swipeDirection="up"
            showSwipeHandle>
            <DrawerContent className="mx-auto w-full max-w-3xl">
                <DrawerHeader className="mx-auto w-full max-w-xl px-5 pt-6 text-left">
                    <DrawerTitle className="text-micro">
                        Protected access
                    </DrawerTitle>
                    <DrawerDescription>
                        Enter your access code to continue to the research
                        workspace.
                    </DrawerDescription>
                </DrawerHeader>

                <form
                    aria-label="Workspace access"
                    className="mx-auto w-full max-w-xl space-y-4 px-5 pt-5"
                    onSubmit={submit}>
                    <div className="flex flex-col gap-1 items-center">
                        <Label htmlFor="invitation-code" className="text-sm">
                            Access code
                        </Label>
                        <InputOTP
                            id="invitation-code"
                            value={code}
                            onChange={(nextCode) => {
                                setCode(nextCode);
                                setError(null);
                            }}
                            maxLength={4}
                            pattern={REGEXP_ONLY_DIGITS}
                            inputMode="numeric"
                            autoComplete="one-time-code"
                            aria-invalid={Boolean(error)}
                            aria-describedby={
                                error ? "invitation-code-error" : undefined
                            }
                            containerClassName="justify-start">
                            <InputOTPGroup>
                                {invitationOtpSlots.map((slot) => (
                                    <InputOTPSlot
                                        key={`invitation-otp-${slot}`}
                                        index={slot}
                                        className="size-14 font-mono text-2xl"
                                    />
                                ))}
                            </InputOTPGroup>
                        </InputOTP>
                        {error ? (
                            <p
                                id="invitation-code-error"
                                role="alert"
                                className="text-xs text-destructive">
                                {error}
                            </p>
                        ) : (
                            <p className="text-xs text-muted-foreground">
                                Use your four-digit workspace code.
                            </p>
                        )}
                    </div>

                    <DrawerFooter className="flex-row justify-between gap-2 p-0 pb-6">
                        <DrawerClose
                            render={
                                <Button
                                    type="button"
                                    size="lg"
                                    variant="ghost"
                                    disabled={isSubmitting}
                                />
                            }>
                            <Icon iconNode={Cancel01Icon} />
                            Cancel
                        </DrawerClose>
                        <Button type="submit" size="lg" disabled={isSubmitting}>
                            {isSubmitting ? "Verifying…" : "Continue"}
                            <Icon
                                iconNode={ArrowRight01Icon}
                                data-icon="inline-end"
                            />
                        </Button>
                    </DrawerFooter>
                </form>
            </DrawerContent>
        </Drawer>
    );
}
