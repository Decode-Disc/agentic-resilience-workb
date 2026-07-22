import { convexTest } from "convex-test"
import { makeFunctionReference } from "convex/server"
import { expect, test, vi } from "vitest"

import { digestInvitationCode } from "../../convex/domain/invitationCodes"
import schema from "../../convex/schema"
import workflowTest from "./workflow-test-register.js"

const modules = import.meta.glob("../../convex/**/*.ts")

const seedInvitations = makeFunctionReference<
  "mutation",
  { invitations: Array<{ slotKey: string; role: "admin" | "analyst"; codeDigest: string }> },
  { created: number; total: number }
>("invitations:seedForSetup")
const claimInvitation = makeFunctionReference<
  "action",
  { code: string },
  { visitorId: string; role: "admin" | "analyst" }
>("invitations:claim")
const reserveAnalysis = makeFunctionReference<
  "mutation",
  { idempotencyKey: string },
  { runId: string; remainingAnalyses: number }
>("researchRuns:reserve")
const startReserved = makeFunctionReference<"mutation", { runId: string }, string>(
  "workflowControls:startReserved",
)
const approveCheckpoint = makeFunctionReference<
  "mutation",
  { runId: string; checkpoint: "source_review" | "assessment_review"; decisionKey: string },
  { accepted: boolean }
>("workflowControls:approveCheckpoint")
const cancelRun = makeFunctionReference<"mutation", { runId: string }, { cancelled: boolean }>(
  "workflowControls:cancel",
)
const failCheckpoint = makeFunctionReference<
  "mutation",
  { runId: string; checkpoint: "source_review" | "assessment_review"; error: string },
  null
>("workflowControls:failCheckpoint")
const retryRun = makeFunctionReference<"mutation", { runId: string }, { retryCount: number }>(
  "workflowControls:retry",
)
const getRun = makeFunctionReference<"query", { runId: string }, unknown>("researchRuns:get")
const listMyEvents = makeFunctionReference<"query", { runId: string }, Array<unknown>>(
  "researchRuns:listMyEvents",
)

test("a reserved workflow pauses and resumes through both human checkpoints", async () => {
  vi.useFakeTimers()
  const t = convexTest(schema, modules)
  workflowTest.register(t)
  process.env.INVITATION_CODE_PEPPER = "workflow-test-pepper"
  const code = "workflow-analyst-code"
  const invitations = await Promise.all(
    ["admin", "analyst-1", "analyst-2", "analyst-3", "analyst-4"].map(async (slotKey, index) => ({
      slotKey,
      role: index === 0 ? ("admin" as const) : ("analyst" as const),
      codeDigest: await digestInvitationCode(
        index === 1 ? code : `unused-${index}`,
        "workflow-test-pepper",
      ),
    })),
  )
  await t.mutation(seedInvitations, { invitations })
  const userId = await t.run((ctx) => ctx.db.insert("users", { isAnonymous: true }))
  const analyst = t.withIdentity({ subject: `${userId}|workflow-session` })
  await analyst.action(claimInvitation, { code })
  const { runId } = await analyst.mutation(reserveAnalysis, { idempotencyKey: "workflow-run" })

  await t.mutation(startReserved, { runId })
  await t.finishAllScheduledFunctions(vi.runAllTimers)
  await expect(t.query(getRun, { runId })).resolves.toMatchObject({
    lifecycleState: "awaiting_source_review",
    executionStatus: "paused",
  })
  await expect(analyst.query(listMyEvents, { runId })).resolves.toEqual(
    expect.arrayContaining([
      expect.objectContaining({ type: "run_created" }),
      expect.objectContaining({ lifecycleState: "awaiting_source_review" }),
    ]),
  )

  await expect(
    analyst.mutation(approveCheckpoint, {
      runId,
      checkpoint: "source_review",
      decisionKey: "source-decision-1",
    }),
  ).resolves.toEqual({ accepted: true })
  await expect(
    analyst.mutation(approveCheckpoint, {
      runId,
      checkpoint: "source_review",
      decisionKey: "source-decision-1",
    }),
  ).resolves.toEqual({ accepted: false })
  await t.finishAllScheduledFunctions(vi.runAllTimers)
  await expect(t.query(getRun, { runId })).resolves.toMatchObject({
    lifecycleState: "awaiting_assessment_review",
    executionStatus: "paused",
  })

  await analyst.mutation(approveCheckpoint, {
    runId,
    checkpoint: "assessment_review",
    decisionKey: "assessment-decision-1",
  })
  await t.finishAllScheduledFunctions(vi.runAllTimers)
  await expect(t.query(getRun, { runId })).resolves.toMatchObject({
    lifecycleState: "completed",
    executionStatus: "completed",
  })
  vi.useRealTimers()
})

test("cancellation is terminal and idempotent", async () => {
  vi.useFakeTimers()
  const t = convexTest(schema, modules)
  workflowTest.register(t)
  process.env.INVITATION_CODE_PEPPER = "cancel-test-pepper"
  const code = "cancel-analyst-code"
  const invitations = await Promise.all(
    ["admin", "analyst-1", "analyst-2", "analyst-3", "analyst-4"].map(async (slotKey, index) => ({
      slotKey,
      role: index === 0 ? ("admin" as const) : ("analyst" as const),
      codeDigest: await digestInvitationCode(
        index === 1 ? code : `unused-${index}`,
        "cancel-test-pepper",
      ),
    })),
  )
  await t.mutation(seedInvitations, { invitations })
  const userId = await t.run((ctx) => ctx.db.insert("users", { isAnonymous: true }))
  const analyst = t.withIdentity({ subject: `${userId}|cancel-session` })
  await analyst.action(claimInvitation, { code })
  const { runId } = await analyst.mutation(reserveAnalysis, { idempotencyKey: "cancel-run" })
  await t.mutation(startReserved, { runId })
  await t.finishAllScheduledFunctions(vi.runAllTimers)

  await expect(analyst.mutation(cancelRun, { runId })).resolves.toEqual({ cancelled: true })
  await expect(analyst.mutation(cancelRun, { runId })).resolves.toEqual({ cancelled: false })
  await expect(
    analyst.mutation(approveCheckpoint, {
      runId,
      checkpoint: "source_review",
      decisionKey: "late-source-decision",
    }),
  ).rejects.toThrow("not awaiting this checkpoint")
  await expect(t.query(getRun, { runId })).resolves.toMatchObject({ executionStatus: "cancelled" })
  vi.useRealTimers()
})

test("a failed workflow can be retried only twice", async () => {
  vi.useFakeTimers()
  const t = convexTest(schema, modules)
  workflowTest.register(t)
  process.env.INVITATION_CODE_PEPPER = "retry-test-pepper"
  const code = "retry-analyst-code"
  const invitations = await Promise.all(
    ["admin", "analyst-1", "analyst-2", "analyst-3", "analyst-4"].map(async (slotKey, index) => ({
      slotKey,
      role: index === 0 ? ("admin" as const) : ("analyst" as const),
      codeDigest: await digestInvitationCode(
        index === 1 ? code : `unused-${index}`,
        "retry-test-pepper",
      ),
    })),
  )
  await t.mutation(seedInvitations, { invitations })
  const userId = await t.run((ctx) => ctx.db.insert("users", { isAnonymous: true }))
  const analyst = t.withIdentity({ subject: `${userId}|retry-session` })
  await analyst.action(claimInvitation, { code })
  const { runId } = await analyst.mutation(reserveAnalysis, { idempotencyKey: "retry-run" })
  await t.mutation(startReserved, { runId })
  await t.finishAllScheduledFunctions(vi.runAllTimers)

  for (let retryCount = 1; retryCount <= 2; retryCount += 1) {
    await t.mutation(failCheckpoint, {
      runId,
      checkpoint: "source_review",
      error: `Deterministic source checkpoint failure ${retryCount}`,
    })
    await t.finishAllScheduledFunctions(vi.runAllTimers)
    await expect(analyst.mutation(retryRun, { runId })).resolves.toEqual({ retryCount })
    await t.finishAllScheduledFunctions(vi.runAllTimers)
  }

  await t.mutation(failCheckpoint, {
    runId,
    checkpoint: "source_review",
    error: "Deterministic terminal failure",
  })
  await t.finishAllScheduledFunctions(vi.runAllTimers)
  await expect(analyst.mutation(retryRun, { runId })).rejects.toThrow("Retry limit reached")
  vi.useRealTimers()
})
