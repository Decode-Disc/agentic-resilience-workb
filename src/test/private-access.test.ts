import { convexTest } from "convex-test"
import { makeFunctionReference } from "convex/server"
import { expect, test } from "vitest"

import schema from "../../convex/schema"
import { digestInvitationCode } from "../../convex/domain/invitationCodes"

const modules = import.meta.glob("../../convex/**/*.ts")

type SeedEntry = {
  slotKey: string
  role: "admin" | "analyst"
  codeDigest: string
}

const seedInvitations = makeFunctionReference<
  "mutation",
  { invitations: Array<SeedEntry> },
  { created: number; total: number }
>("invitations:seedForSetup")
const bootstrapConfiguredInvitations = makeFunctionReference<
  "action",
  Record<string, never>,
  { created: number; total: number }
>("invitations:bootstrapConfigured")
const listInvitations = makeFunctionReference<"query", Record<string, never>, Array<unknown>>(
  "invitations:listForSetup",
)
const claimInvitation = makeFunctionReference<
  "action",
  { code: string },
  { visitorId: string; role: "admin" | "analyst" }
>("invitations:claim")
const currentVisitor = makeFunctionReference<"query", Record<string, never>, unknown>(
  "visitors:current",
)
const reserveAnalysis = makeFunctionReference<
  "mutation",
  { idempotencyKey: string },
  { runId: string; remainingAnalyses: number }
>("researchRuns:reserve")
const restoreQuota = makeFunctionReference<
  "mutation",
  { runId: string; reason: string },
  { restored: boolean }
>("admin:restoreQuota")
const listAuditEvents = makeFunctionReference<
  "query",
  { targetType: string; targetId: string },
  Array<unknown>
>("audit:listByTarget")
const rotateAdminInvitation = makeFunctionReference<"action", Record<string, never>, null>(
  "invitations:rotateAdminFromConfig",
)

const invitationCodes = [
  "admin-code",
  "analyst-code-1",
  "analyst-code-2",
  "analyst-code-3",
  "analyst-code-4",
]
const invitationPepper = "test-only-invitation-pepper"

async function buildInvitationSeed(): Promise<Array<SeedEntry>> {
  const roles = ["admin", "analyst", "analyst", "analyst", "analyst"] as const
  return Promise.all(
    invitationCodes.map(async (code, index) => ({
      slotKey: index === 0 ? "admin" : `analyst-${index}`,
      role: roles[index] ?? "analyst",
      codeDigest: await digestInvitationCode(code, invitationPepper),
    })),
  )
}

test("setup seeds exactly five invitation slots idempotently", async () => {
  const t = convexTest(schema, modules)
  const invitationSeed = await buildInvitationSeed()

  await expect(t.mutation(seedInvitations, { invitations: invitationSeed })).resolves.toEqual({
    created: 5,
    total: 5,
  })
  await expect(t.mutation(seedInvitations, { invitations: invitationSeed })).resolves.toEqual({
    created: 0,
    total: 5,
  })
  await expect(t.query(listInvitations, {})).resolves.toHaveLength(5)
})

test("the deployment bootstrap seeds configured invitations without exposing codes", async () => {
  const t = convexTest(schema, modules)
  process.env.INVITATION_CODE_PEPPER = invitationPepper
  process.env.INVITATION_SEED_CONFIG = JSON.stringify([
    { slotKey: "admin", role: "admin", code: "configured-admin-code" },
    { slotKey: "analyst-1", role: "analyst", code: "configured-analyst-code-1" },
    { slotKey: "analyst-2", role: "analyst", code: "configured-analyst-code-2" },
    { slotKey: "analyst-3", role: "analyst", code: "configured-analyst-code-3" },
    { slotKey: "analyst-4", role: "analyst", code: "configured-analyst-code-4" },
  ])

  await expect(t.action(bootstrapConfiguredInvitations, {})).resolves.toEqual({
    created: 5,
    total: 5,
  })
  await expect(t.action(bootstrapConfiguredInvitations, {})).resolves.toEqual({
    created: 0,
    total: 5,
  })
})

test("an authenticated user claims one invitation exactly once", async () => {
  const t = convexTest(schema, modules)
  process.env.INVITATION_CODE_PEPPER = invitationPepper
  const invitationSeed = await buildInvitationSeed()
  await t.mutation(seedInvitations, { invitations: invitationSeed })
  const firstUserId = await t.run((ctx) => ctx.db.insert("users", { isAnonymous: true }))
  const secondUserId = await t.run((ctx) => ctx.db.insert("users", { isAnonymous: true }))
  const firstUser = t.withIdentity({ subject: `${firstUserId}|session-1` })
  const secondUser = t.withIdentity({ subject: `${secondUserId}|session-2` })

  await expect(
    firstUser.action(claimInvitation, { code: invitationCodes[1] ?? "" }),
  ).resolves.toMatchObject({
    role: "analyst",
  })
  await expect(firstUser.query(currentVisitor, {})).resolves.toMatchObject({
    authUserId: firstUserId,
    role: "analyst",
    status: "active",
  })
  const resumedSession = t.withIdentity({ subject: `${firstUserId}|session-3` })
  await expect(resumedSession.query(currentVisitor, {})).resolves.toMatchObject({
    authUserId: firstUserId,
    status: "active",
  })
  await expect(
    secondUser.action(claimInvitation, { code: invitationCodes[1] ?? "" }),
  ).rejects.toThrow("Invitation is not available")
})

test("an admitted visitor atomically reserves at most three analyses", async () => {
  const t = convexTest(schema, modules)
  process.env.INVITATION_CODE_PEPPER = invitationPepper
  const invitationSeed = await buildInvitationSeed()
  await t.mutation(seedInvitations, { invitations: invitationSeed })
  const userId = await t.run((ctx) => ctx.db.insert("users", { isAnonymous: true }))
  const visitor = t.withIdentity({ subject: `${userId}|session` })
  await visitor.action(claimInvitation, { code: invitationCodes[2] ?? "" })

  const reservations = await Promise.all(
    ["run-a", "run-b", "run-c"].map((idempotencyKey) =>
      visitor.mutation(reserveAnalysis, { idempotencyKey }),
    ),
  )

  expect(reservations.map((reservation) => reservation.remainingAnalyses).sort()).toEqual([0, 1, 2])
  await expect(visitor.mutation(reserveAnalysis, { idempotencyKey: "run-a" })).resolves.toEqual({
    runId: reservations[0]?.runId,
    remainingAnalyses: 0,
  })
  await expect(visitor.mutation(reserveAnalysis, { idempotencyKey: "run-d" })).rejects.toThrow(
    "Analysis limit reached",
  )
})

test("the invited admin restores an unused reservation with an audited reason", async () => {
  const t = convexTest(schema, modules)
  process.env.INVITATION_CODE_PEPPER = invitationPepper
  const invitationSeed = await buildInvitationSeed()
  await t.mutation(seedInvitations, { invitations: invitationSeed })
  const adminUserId = await t.run((ctx) => ctx.db.insert("users", { isAnonymous: true }))
  const analystUserId = await t.run((ctx) => ctx.db.insert("users", { isAnonymous: true }))
  const admin = t.withIdentity({ subject: `${adminUserId}|admin-session` })
  const analyst = t.withIdentity({ subject: `${analystUserId}|analyst-session` })
  await admin.action(claimInvitation, { code: invitationCodes[0] ?? "" })
  await analyst.action(claimInvitation, { code: invitationCodes[3] ?? "" })
  const reserved = await analyst.mutation(reserveAnalysis, { idempotencyKey: "restorable-run" })

  await expect(
    admin.mutation(restoreQuota, {
      runId: reserved.runId,
      reason: "The run was abandoned before workflow launch",
    }),
  ).resolves.toEqual({ restored: true })
  await expect(
    t.query(listAuditEvents, { targetType: "research_run", targetId: reserved.runId }),
  ).resolves.toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        action: "quota_restored",
        reason: "The run was abandoned before workflow launch",
      }),
    ]),
  )
  await expect(
    analyst.mutation(reserveAnalysis, { idempotencyKey: "replacement-run" }),
  ).resolves.toMatchObject({ remainingAnalyses: 2 })
})

test("the break-glass path revokes a lost admin session before reissuing its slot", async () => {
  const t = convexTest(schema, modules)
  process.env.INVITATION_CODE_PEPPER = invitationPepper
  process.env.INVITATION_ADMIN_RECOVERY_CODE = "replacement-admin-code-with-enough-entropy"
  const invitationSeed = await buildInvitationSeed()
  await t.mutation(seedInvitations, { invitations: invitationSeed })
  const oldAdminUserId = await t.run((ctx) => ctx.db.insert("users", { isAnonymous: true }))
  const newAdminUserId = await t.run((ctx) => ctx.db.insert("users", { isAnonymous: true }))
  const oldAdmin = t.withIdentity({ subject: `${oldAdminUserId}|old-admin-session` })
  const newAdmin = t.withIdentity({ subject: `${newAdminUserId}|new-admin-session` })
  await oldAdmin.action(claimInvitation, { code: invitationCodes[0] ?? "" })

  await t.action(rotateAdminInvitation, {})

  await expect(oldAdmin.query(currentVisitor, {})).resolves.toMatchObject({ status: "revoked" })
  await expect(
    newAdmin.action(claimInvitation, { code: "replacement-admin-code-with-enough-entropy" }),
  ).resolves.toMatchObject({ role: "admin" })
})
