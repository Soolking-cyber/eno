import 'server-only'
import { db } from './db'
import { appendAudit } from './compliance/audit'
import { notifyDispute } from './dispute'
import { hasVerifiedIdentity, sanctionedProfilesSharingIdentity } from './kyc/identity'
import { logError } from './log'
import { computeTrustV2, recomputeTrust, recordChargeReversals } from './trust'
import { ENFORCEMENT_REASON, forgetPulledListings, getEnforcement, liftAction, syncEnforcement, type EnforcementState } from './enforcement'
import { isFlagReason } from './enforcement-machine'
import { SCAM_RELEASE_PREFIX, scamReleaseEligibleAtMs, type ScamCharge, type ScamStage } from './trust-math'

/**
 * THE TWO HUMAN EXITS FROM A SCAM HOLD — the admin RELEASE and the admin OVERTURN (owner, 2026-09-23:
 * "stopgap now, automate later").
 *
 * A scam hold (reason `scam_hold`, state `held`: listings pulled, posting blocked) is DERIVED: trust.ts
 * sets `hasScamHold` while a standing severe charge has no release marker (scamStage), and the daily
 * sync re-applies whatever it derives. So an exit that only moved the enforcement row was undone by
 * the next sync — which is exactly what the console's plain "lift"/"overturn" did on a scam hold: the
 * seller was told "everything is restored" and was held again within a day. Both exits here therefore
 * write the LEDGER first (the thing the derivation reads) and then re-derive at once.
 *
 *   RELEASE  — the charge stands (full weight, frozen decay); only the hold ends. Refused unless
 *              ≥14 days since confirmation, NO open report against the account, a live verified
 *              identity not shared with another held or suspended account, and a written plan.
 *              Writes `scam_release:<chargeKey>` markers.
 *   OVERTURN — the charge was wrong. The report(s) the admin CHOSE go to 'overturned' and get the
 *              existing reversal markers (recordChargeReversals), so those charges disappear from C
 *              entirely; any other charge keeps the hold.
 *
 * Neither exit republishes the listing a charge's report was about: it is forgotten from the hold's
 * restore list (forgetPulledListings) before anything is restored.
 *
 * Every path appends to the hash-chained compliance audit log with the admin's email — who decided,
 * and for a release the plan they accepted.
 *
 * FUTURE: buyer-confirmed, independent-buyer graduation will be a THIRD exit that thaws the charge's
 * decay (trust-math decayFactor's daysSinceDuesPaid). It is deliberately not here: nothing a seller
 * can do alone ends or shortens a hold today.
 */

export const SCAM_RELEASE_PLAN_MIN = 30
export const SCAM_RELEASE_PLAN_MAX = 2000

/**
 * Every code a release or an overturn refuses with — POST /api/admin/enforcement puts each one on the
 * wire as `{ error: r.error, …fields }`. ⚠️ Literals, one per line: src/lib/api/errors.test.ts harvests
 * them (RE_EMITTED_UNIONS) and src/lib/api/errors.ts asserts them a subset of ApiErrorCode, which is
 * how the contract noticed these codes at all. The check under ScamHoldRefusal keeps the two in step.
 */
export type ScamHoldRefusalCode =
  | 'plan_required'
  | 'not_active'
  | 'no_scam_hold'
  | 'release_too_soon'
  | 'open_reports'
  | 'identity_unverified'
  | 'identity_linked'
  | 'legacy_charge'
  | 'choose_reports'

/** One standing severe charge as the console shows it (the overturn dialog lists and selects these). */
export type ScamChargeView = {
  reportId: string | null
  stage: ScamStage
  confirmedAt: string
  /** The report row, when it still exists (it cascades away with its listing). */
  listingId: string | null
  reason: string | null
  reportStatus: string | null
}

export type ScamHoldRefusal =
  | { ok: false; status: 400; error: 'plan_required'; min: number }
  | { ok: false; status: 409; error: 'not_active' }
  | { ok: false; status: 409; error: 'no_scam_hold' }
  | { ok: false; status: 409; error: 'release_too_soon'; eligibleAt: string }
  | { ok: false; status: 409; error: 'open_reports'; count: number; reportIds: string[] }
  | { ok: false; status: 409; error: 'identity_unverified' }
  | { ok: false; status: 409; error: 'identity_linked'; linkedProfileIds: string[] }
  | { ok: false; status: 409; error: 'legacy_charge' }
  | { ok: false; status: 409; error: 'choose_reports'; charges: ScamChargeView[] }

// Both directions, so neither list can grow alone.
type _RefusalCodesMatch = [ScamHoldRefusal['error']] extends [ScamHoldRefusalCode]
  ? [ScamHoldRefusalCode] extends [ScamHoldRefusal['error']] ? true : never
  : never
const _refusalCodesMatch: _RefusalCodesMatch = true
void _refusalCodesMatch

/**
 * `charges` = how many charges this call released/overturned (0 = it only re-applied a stale hold).
 * `remaining` (overturn only) = held charges this call did NOT overturn — while it is above 0 the
 * account stays held, and the console must say so rather than "overturned".
 */
export type ScamHoldOutcome = { ok: true; state: EnforcementState; charges: number; remaining?: number }

type ActiveAction = { id: string; profileId: string; reason: string; appealedAt: Date | null; appealOutcome: string | null }

/** An ACTIVE ladder action (never a silent review flag — those have their own close-out). */
async function activeLadderAction(actionId: string): Promise<ActiveAction | null> {
  const a = await db.enforcementAction.findUnique({
    where: { id: actionId },
    select: { id: true, profileId: true, status: true, reason: true, appealedAt: true, appealOutcome: true },
  })
  if (!a || a.status !== 'active' || isFlagReason(a.reason)) return null
  return a
}

/** Every STANDING severe charge, held or released — the SAME derivation that holds the account. */
async function standingScamCharges(profileId: string): Promise<ScamCharge[]> {
  return (await computeTrustV2(profileId))?.inputs.scamCharges ?? []
}

/** The standing severe charges no human has released. */
export async function heldScamCharges(profileId: string): Promise<ScamCharge[]> {
  return (await standingScamCharges(profileId)).filter((c) => c.stage === 'held')
}

/** The listings the charges' reports are about (a deleted report — its listing went with it — has none). */
async function chargeListingIds(charges: ReadonlyArray<ScamCharge>): Promise<string[]> {
  const reportIds = charges.map((c) => c.reportId).filter((x): x is string => !!x)
  if (!reportIds.length) return []
  const rows = await db.report.findMany({ where: { id: { in: reportIds } }, select: { listingId: true } })
  return rows.map((r) => r.listingId).filter((x): x is string => !!x)
}

async function chargeViews(charges: ReadonlyArray<ScamCharge>): Promise<ScamChargeView[]> {
  const reportIds = charges.map((c) => c.reportId).filter((x): x is string => !!x)
  const rows = reportIds.length
    ? await db.report.findMany({ where: { id: { in: reportIds } }, select: { id: true, listingId: true, reason: true, status: true } })
    : []
  const byId = new Map(rows.map((r) => [r.id, r]))
  return charges.map((c) => {
    const r = c.reportId ? byId.get(c.reportId) : undefined
    return {
      reportId: c.reportId,
      stage: c.stage,
      confirmedAt: new Date(c.confirmedAtMs).toISOString(),
      listingId: r?.listingId ?? null,
      reason: r?.reason ?? null,
      reportStatus: r?.status ?? null,
    }
  })
}

/**
 * The standing severe charges behind an ACTIVE ladder action's account, for the console's overturn
 * dialog — which must show the admin exactly which reports an overturn would reverse. Null when the
 * action is not active (or is a review flag).
 */
export async function scamChargesForAction(actionId: string): Promise<ScamChargeView[] | null> {
  const action = await activeLadderAction(actionId)
  if (!action) return null
  return chargeViews(await standingScamCharges(action.profileId))
}

/**
 * OPEN reports against the account — its profile, its storefront or any of its listings. The same
 * predicate the investigation hold on deletes (core/listings.ts deleteHoldReason) and on account
 * erasure uses, at account scope. A report re-opened by the respondent's appeal is open too: the
 * appeal is decided first, in Moderation.
 */
async function openReportsAgainst(profileId: string): Promise<{ count: number; reportIds: string[] }> {
  const sellers = await db.seller.findMany({ where: { ownerId: profileId }, select: { id: true } })
  const sellerIds = sellers.map((x) => x.id)
  const where = {
    status: 'open',
    OR: [
      { targetProfileId: profileId },
      ...(sellerIds.length ? [{ targetSellerId: { in: sellerIds } }, { listing: { sellerId: { in: sellerIds } } }] : []),
    ],
  }
  const [count, rows] = await Promise.all([
    db.report.count({ where }),
    db.report.findMany({ where, select: { id: true }, orderBy: { createdAt: 'asc' }, take: 20 }),
  ])
  return { count, reportIds: rows.map((r) => r.id) }
}

/**
 * Does this account currently derive a scam hold? The console refuses a plain lift, and a hand-set
 * state below `held`, while it does — the next daily sync would re-hold the account (escalations always
 * apply), after the seller had been told everything was restored.
 */
export async function profileHasScamHold(profileId: string): Promise<boolean> {
  return (await computeTrustV2(profileId))?.inputs.hasScamHold ?? false
}

/**
 * Re-derive trust and enforcement NOW and report the state that actually resulted. syncEnforcement is
 * fail-quiet by contract, so the caller must read the outcome rather than assume it: a failed sync, an
 * admin action above (never downgraded by the system) or a human floor all leave the state elsewhere.
 */
async function rederive(profileId: string, opts: { uncapped?: boolean; notice?: string; onHeld?: (n: number) => void }): Promise<EnforcementState> {
  const res = await recomputeTrust(profileId, { uncapped: opts.uncapped })
  if (res) await syncEnforcement(profileId, res.breakdown, { persistedScore: res.score, onHeld: opts.onHeld, notice: opts.notice })
  return (await getEnforcement(profileId)).state
}

/**
 * RELEASE a scam hold (admin). `actionId` is any ACTIVE ladder action of the held profile — usually the
 * scam_hold row, but an admin suspension sitting on top of a scam hold is released from its own row
 * (the markers are written; the suspension, and any appeal on it, stay the admin's to decide).
 */
export async function releaseScamHold(input: {
  actionId: string
  admin: string
  plan: string
  onHeld?: (n: number) => void
  now?: number
}): Promise<ScamHoldOutcome | ScamHoldRefusal> {
  const now = input.now ?? Date.now()
  const plan = String(input.plan ?? '').trim()
  if (plan.length < SCAM_RELEASE_PLAN_MIN) return { ok: false, status: 400, error: 'plan_required', min: SCAM_RELEASE_PLAN_MIN }

  const action = await activeLadderAction(input.actionId)
  if (!action) return { ok: false, status: 409, error: 'not_active' }
  const profileId = action.profileId

  const standing = await standingScamCharges(profileId)
  const held = standing.filter((c) => c.stage === 'held')
  if (held.length === 0) {
    // ⚠️ NOTHING LEFT TO RELEASE IS NOT ALWAYS "NO SCAM HOLD" (agy, plan review). The markers of an
    // earlier release commit BEFORE the sync, and the sync is fail-quiet — so a release whose sync
    // failed leaves the account held with nothing left to mark, and a 409 here would make the retry
    // unable to finish what the first click started. A scam_hold row that the ledger no longer
    // supports is re-derived instead (the daily sync would do the same, a day later).
    if (action.reason !== ENFORCEMENT_REASON.SCAM_HOLD) return { ok: false, status: 409, error: 'no_scam_hold' }
    // The first click forgot these before it wrote a marker; again here, idempotently, so the restore
    // this re-derive runs can never be the one that republishes a reported listing.
    await forgetPulledListings(await chargeListingIds(standing))
    // On the record like every other exit (review, 2026-09-24): an admin action that restores
    // listings leaves an audit line, even when the decision it completes was recorded earlier.
    await db.$transaction((tx) => appendAudit(tx, {
      actorType: 'admin',
      actorId: input.admin,
      action: 'enforcement.scam_release_rederived',
      subjectType: 'profile',
      subjectId: profileId,
      detail: { actionId: action.id, releasedCharges: standing.map((c) => c.key) },
    }))
    // ⚠️ THE SELLER HEARS WHAT HAPPENED (agy, review 2026-09-24). Without the override this landing in
    // `throttled` sent the generic "Your storefront is under review" — to a seller an admin had just
    // released. The release notice when a released charge is what ended the hold; nothing to override
    // when no charge stands at all (a reversal did it, and says so itself).
    const released = standing.some((c) => c.stage === 'released')
    return { ok: true, state: await rederive(profileId, { onHeld: input.onHeld, notice: released ? 'scam_released' : undefined }), charges: 0 }
  }

  // (i) Other victims get time to come forward before the listings go back up.
  const eligibleAtMs = scamReleaseEligibleAtMs(held)
  if (now < eligibleAtMs) return { ok: false, status: 409, error: 'release_too_soon', eligibleAt: new Date(eligibleAtMs).toISOString() }
  // (i-b) …and a victim who DID come forward is heard before the release, not after it (review,
  // 2026-09-24): the 14 days exist for exactly the report filed on day 10 and still unreviewed on day
  // 14. Any open report against the account, its storefront or its listings blocks the release until
  // Moderation decides it — including an appeal of the charge itself, which is decided first.
  const open = await openReportsAgainst(profileId)
  if (open.count > 0) return { ok: false, status: 409, error: 'open_reports', count: open.count, reportIds: open.reportIds }
  // (ii) A live verified identity — revocation-aware (deriveVerification decides, not a status read) —
  // that is not the same person as another held or suspended account.
  if (!(await hasVerifiedIdentity(profileId))) return { ok: false, status: 409, error: 'identity_unverified' }
  const linkedProfileIds = await sanctionedProfilesSharingIdentity(profileId)
  if (linkedProfileIds.length) return { ok: false, status: 409, error: 'identity_linked', linkedProfileIds }

  // ⛔ THE REPORTED LISTING STAYS DOWN (review, 2026-09-24). The hold's pull recorded it with every
  // other live listing (confirm-report re-derives BEFORE its takedown), so the restore below would have
  // put the confirmed scam listing back on the public feed. Forgotten FIRST — before any marker — so a
  // failure here leaves nothing released and nothing restored. (confirm-report forgets it too; this is
  // the backstop for a hold recorded before that, or whose best-effort forget failed.)
  await forgetPulledListings(await chargeListingIds(held))

  // (iii) The written plan goes on the hash-chained audit record with the marker — in ONE transaction,
  // so a release can never exist in the ledger without the record of who allowed it and why.
  const recordedPlan = plan.slice(0, SCAM_RELEASE_PLAN_MAX)
  const written = await db.$transaction(async (tx) => {
    // A double-click (or two admins) must not stack markers: every marker is a line in the seller's
    // PDPL export. A charge already released after its confirmation is skipped.
    const reasons = held.map((c) => `${SCAM_RELEASE_PREFIX}${c.key}`)
    const existing = await tx.trustEvent.findMany({
      where: { subjectProfileId: profileId, type: 'manual_adjust', reason: { in: reasons } },
      select: { reason: true, createdAt: true },
    })
    const fresh = held.filter((c) => !existing.some((e) => e.reason === `${SCAM_RELEASE_PREFIX}${c.key}` && e.createdAt.getTime() >= c.confirmedAtMs))
    if (fresh.length) {
      await tx.trustEvent.createMany({
        data: fresh.map((c) => ({
          subjectProfileId: profileId,
          type: 'manual_adjust',
          delta: 0, // a release is not a pardon — C keeps the charge at full weight
          reason: `${SCAM_RELEASE_PREFIX}${c.key}`,
          reportId: c.reportId,
        })),
      })
    }
    // The seller's pending appeal on the SCAM HOLD is answered by the release (it is usually where the
    // plan came from). Its own outcome word, not 'overturned': the action was not wrong.
    // ⚠️ ONLY on the scam_hold row (review, 2026-09-24). A release run from an admin suspension on top
    // leaves that suspension in force, so its appeal has had no ruling — answering it here used the
    // seller's one appeal up and dropped it out of the console's pending queue.
    if (action.reason === ENFORCEMENT_REASON.SCAM_HOLD && action.appealedAt && !action.appealOutcome) {
      await tx.enforcementAction.updateMany({
        where: { id: action.id, appealOutcome: null },
        data: { appealOutcome: 'released', appealResolvedAt: new Date(now) },
      })
    }
    await appendAudit(tx, {
      actorType: 'admin',
      actorId: input.admin,
      action: 'enforcement.scam_released',
      subjectType: 'profile',
      subjectId: profileId,
      detail: {
        actionId: action.id,
        plan: recordedPlan,
        charges: held.map((c) => ({ key: c.key, reportId: c.reportId, confirmedAt: new Date(c.confirmedAtMs).toISOString() })),
      },
    })
    return fresh.length
  })

  // The state change, NOW: pulled listings come back (applyEnforcement restores them on any move
  // below held), and the seller hears it was a release — not "under review", not "all restored".
  const state = await rederive(profileId, { notice: 'scam_released', onHeld: input.onHeld })
  return { ok: true, state, charges: written }
}

/**
 * OVERTURN scam charges (admin): the confirmed report(s) the admin CHOSE were wrong.
 *
 * ⛔ ONLY THE CHOSEN REPORTS (review, 2026-09-24). This used to reverse every held severe charge on the
 * account and tell every reporter "closed — no violation": an admin who found ONE appeal right
 * silently cleared a second victim's valid report too, and a real scammer walked out. Now the caller
 * names the report(s) (`reportIds` — the console lists them and the admin ticks them); with none named
 * the call proceeds only when exactly one charge stands, and otherwise refuses with `choose_reports`
 * and the list. Other charges keep the hold: `remaining` says how many, and the scam_hold row is ended
 * only when THIS call overturned every held charge.
 *
 * Any STANDING charge can be overturned, a released one included: an overturn says the report was
 * wrong, which a release never did (the charge still weighs in C after it). That is also why a stale
 * scam_hold row whose charges were only released is not "overturned" by ending the row — nothing was
 * (review, 2026-09-24); only a row with no standing charge at all is ended that way.
 *
 * Order is deliberate: the LEDGER first (report status + reversal markers), then the action, then the
 * re-derive. If anything after the ledger write fails, the next sync still lands on the right state;
 * the reverse order was the bug — the action moved and the ledger did not.
 *
 * `actionId` may be a non-scam action on a scam-held profile (an admin suspension on top): the charges
 * are reversed and THAT action is left for the admin to lift — an overturned scam report is not a
 * ruling on the suspension.
 *
 * ⚠️ The listing an overturned report was about is NOT republished (verified=false is shared by six
 * takedowns — core/listings.ts "NO AUTO-REPUBLISH"); it is forgotten from the hold's restore list
 * before anything is restored, and the admin approves it in Moderation.
 */
export async function overturnScamHold(input: {
  actionId: string
  admin: string
  /** The reports to overturn. Omitted: only when exactly one charge stands (else `choose_reports`). */
  reportIds?: string[]
  onHeld?: (n: number) => void
}): Promise<ScamHoldOutcome | ScamHoldRefusal> {
  const action = await activeLadderAction(input.actionId)
  if (!action) return { ok: false, status: 409, error: 'not_active' }
  const profileId = action.profileId
  const isScamRow = action.reason === ENFORCEMENT_REASON.SCAM_HOLD

  const standing = await standingScamCharges(profileId)
  if (standing.length === 0) {
    // Nothing stands at all (a won appeal, an earlier overturn whose sync failed): the row is stale,
    // so ending it IS the overturn — and nothing can re-hold it. `charges: 0` tells the console that
    // no report was reversed by this call.
    if (!isScamRow) return { ok: false, status: 409, error: 'no_scam_hold' }
    await liftAction(action.id, { to: 'overturned', by: input.admin, onHeld: input.onHeld })
    // On the record like every other exit — no report was reversed here, the stale row was ended.
    await db.$transaction((tx) => appendAudit(tx, {
      actorType: 'admin',
      actorId: input.admin,
      action: 'enforcement.scam_overturned',
      subjectType: 'profile',
      subjectId: profileId,
      detail: { actionId: action.id, reportIds: [], remainingHeld: 0, staleRow: true },
    }))
    return { ok: true, state: await rederive(profileId, { uncapped: true, onHeld: input.onHeld }), charges: 0, remaining: 0 }
  }
  // A legacy charge with no report has no reversal marker to write (reversals are keyed by reportId);
  // a release (event-keyed) is the way out for those. Every current writer attaches a reportId.
  const reportable = standing.filter((c) => c.reportId)
  if (!reportable.length) return { ok: false, status: 409, error: 'legacy_charge' }

  const wanted = [...new Set((input.reportIds ?? []).map((x) => String(x).trim()).filter(Boolean))]
  let chosen: ScamCharge[]
  if (wanted.length) {
    chosen = reportable.filter((c) => wanted.includes(c.reportId as string))
    // A named report that is not a standing charge of THIS account (stale dialog, a typo, someone
    // else's report) refuses the whole call: an overturn is never applied to a partial selection.
    if (chosen.length !== wanted.length) return { ok: false, status: 409, error: 'choose_reports', charges: await chargeViews(standing) }
  } else if (standing.length === 1) {
    chosen = reportable
  } else {
    return { ok: false, status: 409, error: 'choose_reports', charges: await chargeViews(standing) }
  }

  const reportIds = chosen.map((c) => c.reportId as string)
  const held = standing.filter((c) => c.stage === 'held')
  const remaining = held.filter((c) => !reportIds.includes(c.reportId ?? '')).length

  // Before anything below can restore: the overturned reports' listings stay down (see above).
  await forgetPulledListings(await chargeListingIds(chosen))

  await db.$transaction(async (tx) => {
    // Only reports still carrying the charge: 'confirmed', or re-opened by the respondent's appeal.
    // 'overturned' is what the abusive-reporter purge writes for a reversed confirmation, and the
    // dispute room already renders it as "closed — no violation".
    await tx.report.updateMany({
      where: { id: { in: reportIds }, status: { in: ['confirmed', 'open'] } },
      data: { status: 'overturned', resolvedBy: input.admin, resolvedAt: new Date() },
    })
    await appendAudit(tx, {
      actorType: 'admin',
      actorId: input.admin,
      action: 'enforcement.scam_overturned',
      subjectType: 'profile',
      subjectId: profileId,
      detail: { actionId: action.id, reportIds, remainingHeld: remaining },
    })
    // The reversal in the LEDGER too: a Report row cascades away with its listing, and with it the
    // status computeTrustV2 reads — the charge (and the hold) would then come back. The subject is
    // known (the held profile), so deleted reports are reversed as well.
    // ⚠️ IN THIS TRANSACTION (review, 2026-09-24). It ran after the commit, so a failure between the
    // two left the reports 'overturned' with no marker — and the retry then found nothing standing,
    // took the stale-row path and never wrote one: the charge came back once the Report row went.
    await recordChargeReversals(reportIds.map((id) => ({ id, targetProfileId: profileId, targetSellerId: null })), 'overturned', tx)
  })

  // The scam_hold row ends as OVERTURNED only when this call reversed every charge that was holding
  // it. With a charge left the account stays held (the re-derive keeps it); with the hold already
  // released (a stale row) the re-derive ends the row the way the release meant to.
  if (isScamRow && held.length > 0 && remaining === 0) await liftAction(action.id, { to: 'overturned', by: input.admin, onHeld: input.onHeld })
  // Uncapped: getting back what a wrong ruling took is not "earning" (same as settleReportCharges).
  const state = await rederive(profileId, { uncapped: true, onHeld: input.onHeld })

  // The reporter was told "upheld"; the case room now reads "closed — no violation". Tell them, as
  // the moderation queue's dismiss does — only the reporters of the reports overturned HERE. Best-effort.
  try {
    const rows = await db.report.findMany({ where: { id: { in: reportIds } }, select: { id: true, reporterProfileId: true } })
    for (const r of rows) if (r.reporterProfileId) await notifyDispute(r.reporterProfileId, r.id, 'decided_dismissed_reporter')
  } catch (e) {
    logError(e, { op: 'scamHold.notifyReporters' })
  }
  return { ok: true, state, charges: reportIds.length, remaining }
}
