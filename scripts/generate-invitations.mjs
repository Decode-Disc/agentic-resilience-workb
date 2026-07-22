import { randomBytes } from "node:crypto"

const slots = [
  { slotKey: "admin", role: "admin" },
  { slotKey: "analyst-1", role: "analyst" },
  { slotKey: "analyst-2", role: "analyst" },
  { slotKey: "analyst-3", role: "analyst" },
  { slotKey: "analyst-4", role: "analyst" },
]

const invitations = slots.map((slot) => ({
  ...slot,
  code: randomBytes(32).toString("base64url"),
}))

process.stdout.write(
  `${JSON.stringify(
    {
      invitationCodePepper: randomBytes(32).toString("base64url"),
      invitationSeedConfig: JSON.stringify(invitations),
      invitations,
    },
    null,
    2,
  )}\n`,
)
