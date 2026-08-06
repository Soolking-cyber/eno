import { db } from '@/lib/db'
import { loadDisputeForParty, notifyDispute, respondentProfileId } from '@/lib/dispute'
import { ApiError, route } from '@/lib/api/handler'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// The reporter withdraws their own open case (Binance's "Cancel Appeal"): parties
// worked it out, or the report was a mistake. Closes as 'dismissed' with a marker
// resolvedBy so the UI can label it "withdrawn" — deliberately NOT a trust event
// in either direction (dismiss has no side effects). Idempotent via the atomic
// open→dismissed updateMany claim.
//
// ⚠️ WS6 MIGRATION — auth preamble only; this route never read a body (the target is the path id)
// and was never rate-limited, so nothing else moves. `auth: 'userId'` = the getCurrentProfileId()
// it replaces; the party/role decision stays here because it is a dispute-membership check, not one
// of the wrapper's four modes. Branches unchanged, all four: 401 `auth_required`, 404 `not_found`,
// 403 `forbidden` (LOWERCASE — the wrapper's admin mode emits `Forbidden`, this is not that and must
// not drift), 409 `already_resolved`, 200 `{"ok":true}`.
//
// ⚠️ FAILURE-PATH WIRE CHANGE, DELIBERATE: updateMany/notifyDispute have no .catch(), so a DB error
// was Next's default 500 and is now `{"error":"internal_error"}` 500.
export const POST = route({ auth: 'userId' }, async ({ userId: meId, params }) => {
  const { id } = params

  const loaded = await loadDisputeForParty(id, meId)
  if (!loaded) throw new ApiError('not_found', 404)
  if (loaded.role !== 'reporter') throw new ApiError('forbidden', 403)

  const upd = await db.report.updateMany({
    where: { id, status: 'open', reporterProfileId: meId },
    data: { status: 'dismissed', resolvedBy: 'withdrawn-by-reporter', resolvedAt: new Date() },
  })
  if (upd.count === 0) throw new ApiError('already_resolved', 409)

  // Close the loop for the respondent (they were notified at open; tell them it's over).
  const respondent = await respondentProfileId(loaded.report)
  if (respondent && respondent !== meId) await notifyDispute(respondent, id, 'withdrawn_respondent')

  return { ok: true }
})
