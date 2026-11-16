import {
    MAX_AUDIT_REASON_CHARS,
    MIN_AUDIT_REASON_CHARS,
} from "@convex/resourcePolicy";
import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

/**
 * Confirms an audited administrative action. The reason is required within the server's audit limits and is
 * trimmed before submission; the dialog stays open, with the reason kept, when the action fails.
 */
export function AdminReasonDialog({
    open,
    title,
    description,
    reasonLabel,
    confirmLabel,
    pendingLabel,
    destructive = false,
    onConfirm,
    onClose,
}: {
    open: boolean;
    title: string;
    description: string;
    reasonLabel: string;
    confirmLabel: string;
    pendingLabel: string;
    destructive?: boolean;
    /** Resolves to whether the action succeeded; a failure keeps the dialog and its reason. */
    onConfirm: (reason: string) => Promise<boolean>;
    onClose: () => void;
}) {
    const id = useId();
    const [reason, setReason] = useState("");
    const [pending, setPending] = useState(false);
    const [wasOpen, setWasOpen] = useState(open);
    if (open !== wasOpen) {
        setWasOpen(open);
        if (open) setReason("");
    }
    const trimmed = reason.trim();
    const valid =
        trimmed.length >= MIN_AUDIT_REASON_CHARS &&
        trimmed.length <= MAX_AUDIT_REASON_CHARS;
    return (
        <Dialog
            open={open}
            onOpenChange={(next) => {
                if (!next && !pending) onClose();
            }}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>{title}</DialogTitle>
                    <DialogDescription>{description}</DialogDescription>
                </DialogHeader>
                <div className="space-y-2">
                    <Label htmlFor={`${id}-reason`}>{reasonLabel}</Label>
                    <Textarea
                        id={`${id}-reason`}
                        aria-describedby={`${id}-help`}
                        value={reason}
                        maxLength={MAX_AUDIT_REASON_CHARS}
                        onChange={(event) => setReason(event.target.value)}
                    />
                    <p
                        id={`${id}-help`}
                        className="text-xs text-muted-foreground">
                        Recorded in the audit trail. At least{" "}
                        {MIN_AUDIT_REASON_CHARS} characters.
                    </p>
                </div>
                <DialogFooter>
                    <Button
                        variant="outline"
                        disabled={pending}
                        onClick={onClose}>
                        Cancel
                    </Button>
                    <Button
                        variant={destructive ? "destructive" : "default"}
                        disabled={pending || !valid}
                        onClick={async () => {
                            setPending(true);
                            try {
                                if (await onConfirm(trimmed)) onClose();
                            } finally {
                                setPending(false);
                            }
                        }}>
                        {pending ? pendingLabel : confirmLabel}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
