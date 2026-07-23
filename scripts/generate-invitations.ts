import { randomBytes } from 'node:crypto';

type InvitationRole = 'admin' | 'analyst';

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
    { slotKey: 'admin', role: 'admin' },
    { slotKey: 'analyst-1', role: 'analyst' },
    { slotKey: 'analyst-2', role: 'analyst' },
    { slotKey: 'analyst-3', role: 'analyst' },
    { slotKey: 'analyst-4', role: 'analyst' },
];

const invitations: GeneratedInvitation[] = slots.map((slot) => ({
    ...slot,
    code: randomBytes(32).toString('base64url'),
}));

const document: InvitationSeedDocument = {
    invitationCodePepper: randomBytes(32).toString('base64url'),
    invitationSeedConfig: JSON.stringify(invitations),
    invitations,
};

process.stdout.write(`${JSON.stringify(document, null, 2)}\n`);
