import { randomBytes, randomInt } from "node:crypto";
import { writeFileSync } from "node:fs";

type InvitationRole = "admin" | "analyst";

interface InvitationSlot {
    slotKey: string;
    role: InvitationRole;
}

interface GeneratedInvitation extends InvitationSlot {
    code: string;
}

interface InvitationSeedDocument {
    invitationCodePepper: string;
    invitationSeedConfig: string;
    invitations: GeneratedInvitation[];
}

const slots: InvitationSlot[] = [
    { slotKey: "admin", role: "admin" },
    { slotKey: "analyst-1", role: "analyst" },
    { slotKey: "analyst-2", role: "analyst" },
    { slotKey: "analyst-3", role: "analyst" },
    { slotKey: "analyst-4", role: "analyst" },
];

const codes = new Set<string>();
while (codes.size < slots.length) {
    codes.add(randomInt(0, 10_000).toString().padStart(4, "0"));
}

const generatedCodes = Array.from(codes);
const invitations: GeneratedInvitation[] = slots.map((slot, index) => {
    const code = generatedCodes[index];
    if (!code) {
        throw new Error(
            `Invitation code generation failed for ${slot.slotKey}`,
        );
    }
    return { ...slot, code };
});

const document: InvitationSeedDocument = {
    invitationCodePepper: randomBytes(32).toString("base64url"),
    invitationSeedConfig: JSON.stringify(invitations),
    invitations,
};

const serializedDocument = `${JSON.stringify(document, null, 2)}\n`;
const outputArgument = process.argv.find((argument) =>
    argument.startsWith("--output="),
);
const outputPath = outputArgument?.slice("--output=".length);

if (outputArgument && !outputPath) {
    throw new Error("--output requires a file path");
}

if (outputPath) {
    writeFileSync(outputPath, serializedDocument, {
        encoding: "utf8",
        flag: "wx",
        mode: 0o600,
    });
    process.stdout.write(`Invitation material written to ${outputPath}\n`);
} else {
    process.stdout.write(serializedDocument);
}
