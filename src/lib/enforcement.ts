import 'server-only'
import { after } from 'next/server'
import { revalidatePath } from 'next/cache'
import { db } from './db'
import { sendPushToProfile } from './push'
import { pickLocale } from './admin-macros'
import { DAY_MS } from './trust-math'
import {
  ENFORCEMENT,
  ENFORCEMENT_REASON,
  ENFORCEMENT_SEVERITY,
  applyInsurance,
  blocksMessaging,
  blocksPosting,
  canSystemTransition,
  deriveState,
  holdForGrace,
  isInsured,
  isProbation,
  normalizeEnforcementState,
  type EnforcementDecision,
  type EnforcementState,
} from './enforcement-machine'
import type { TrustBreakdown } from './trust' // type-only — no runtime cycle (trust.ts imports us)

/**
 * Enforcement ladder Phase 2 — DB wiring for the pure machine (enforcement-machine.ts).
 *
 * DEPLOY-ORDER SAFETY: the enforcement columns/table land via scripts/add-enforcement.mjs
 * (user-run) AFTER this code deploys. The Profile/Report columns are @ignore'd in the
 * Prisma schema (full-row reads elsewhere must not 500 pre-migration), so EVERY read/write
 * of them here is raw SQL wrapped in try/catch → defaults: enforcementState 'good_standing',
 * every feature a silent no-op. EnforcementAction queries go through the client but are
 * equally guarded (P2021 table-missing → no-op / 503 where user-facing).
 *
 * SECURITY: nothing here trusts the client — callers pass a profileId they have already
 * authenticated (getCurrentProfile/getCurrentProfileId) or admin-gated (getAdmin).
 */

export type { EnforcementState, EnforcementDecision } from './enforcement-machine'
export {
  ENFORCEMENT,
  ENFORCEMENT_REASON,
  ENFORCEMENT_STATES,
  blocksMessaging,
  blocksPosting,
  isProbation,
} from './enforcement-machine'

// ── Seller-facing notices (calm, specific, ONE action — never punitive-corporate).
// EN + VI; the recipient gets THEIR language (Profile.locale). Deep link: /dashboard.
type Notice = { title: { en: string; vi: string }; body: { en: string; vi: string } }
const NOTICE: Record<string, Notice> = {
  warned: {
    title: { en: 'A note about your account', vi: 'Lưu ý về tài khoản của bạn' },
    body: {
      en: 'A recent report about your account was reviewed and confirmed. Open your dashboard to see the details and reply.',
      vi: 'Một báo cáo gần đây về tài khoản của bạn đã được xem xét và xác nhận. Mở trang quản lý để xem chi tiết và phản hồi.',
    },
  },
  grace: {
    title: { en: 'Please review within 72 hours', vi: 'Vui lòng xem lại trong 72 giờ' },
    body: {
      en: 'We found an issue that would normally limit your account. Because of your long good record, nothing changes for 72 hours — open your dashboard to review it.',
      vi: 'Chúng tôi phát hiện một vấn đề thường sẽ khiến tài khoản bị hạn chế. Vì bạn có quá trình bán hàng tốt, tài khoản chưa bị ảnh hưởng trong 72 giờ — hãy mở trang quản lý để xem lại.',
    },
  },
  throttled: {
    title: { en: 'Your storefront is under review', vi: 'Gian hàng của bạn đang được xem xét' },
    body: {
      en: 'Buyers still see your listings, with a caution note. Reply to the report in your dashboard to speed up the review.',
      vi: 'Người mua vẫn thấy tin đăng của bạn, kèm một lưu ý thận trọng. Hãy phản hồi báo cáo trong trang quản lý để được xem xét nhanh hơn.',
    },
  },
  held: {
    title: { en: 'Your listings are paused', vi: 'Tin đăng của bạn đã tạm dừng' },
    body: {
      en: 'Your listings are hidden while we review a serious report. Open your dashboard to see the details — you can appeal if this is a mistake.',
      vi: 'Tin đăng của bạn tạm thời bị ẩn trong khi chúng tôi xem xét một báo cáo nghiêm trọng. Mở trang quản lý để xem chi tiết — bạn có thể khiếu nại nếu có nhầm lẫn.',
    },
  },
  suspended: {
    title: { en: 'Your account is suspended', vi: 'Tài khoản của bạn đã bị tạm ngưng' },
    body: {
      en: 'Posting and messaging are paused while we review your account. You can submit one appeal from your dashboard.',
      vi: 'Đăng tin và nhắn tin tạm dừng trong khi chúng tôi xem xét tài khoản của bạn. Bạn có thể gửi một khiếu nại từ trang quản lý.',
    },
  },
  good_standing: {
    title: { en: 'Your account is back in good standing', vi: 'Tài khoản của bạn đã hoạt động bình thường trở lại' },
    body: {
      en: 'Thanks for your patience — everything is restored.',
      vi: 'Cảm ơn bạn đã kiên nhẫn — mọi thứ đã được khôi phục.',
    },
  },
  appeal_upheld: {
    title: { en: 'Your appeal was reviewed', vi: 'Khiếu nại của bạn đã được xem xét' },
    body: {
      en: 'We looked at your appeal carefully and the decision stands. It lifts automatically as your record improves.',
      vi: 'Chúng tôi đã xem xét kỹ khiếu nại của bạn và quyết định được giữ nguyên. Hạn chế sẽ tự gỡ khi hồ sơ của bạn cải thiện.',
    },
  },
}

// Best-effort notify (bell + web push), out of the hot path — after() when a request
// scope exists (routes), direct fire-and-forget otherwise (tests/edge contexts).
function notifyEnforcement(profileId: string, noticeKey: string) {
  const send = async () => {
    try {
      const copy = NOTICE[noticeKey]
      if (!copy) return
      const p = await db.profile.findUnique({ where: { id: profileId }, select: { locale: true } })
      const l = pickLocale(p?.locale)
      await db.notification.create({
        data: { recipientId: profileId, type: 'system', title: copy.title[l], body: copy.body[l], actorName: 'eno.vn', url: '/dashboard' },
      })
      await sendPushToProfile(profileId, { title: copy.title[l], body: copy.body[l], url: '/dashboard', tag: 'eno-enforcement' })
    } catch (e) {
      console.error('[enforcement] notify failed', profileId, e)
    }
  }
  try { after(send) } catch { void send() }
}

function parsePulled(json: string | null | undefined): string[] {
  try {
    const v = json ? JSON.parse(json) : []
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []
  } catch { return [] }
}

// Restore listings a hold pulled — only rows the seller still keeps 'active'
// (sold/hidden since stay down) and that are still un-verified (an admin re-approve
// in between isn't stomped… it's already true, updateMany just matches fewer rows).
async function restoreListings(ids: string[]): Promise<void> {
  if (!ids.length) return
  await db.listing.updateMany({ where: { id: { in: ids }, status: 'active', verified: false }, data: { verified: true } })
  for (const id of ids) { try { revalidatePath(`/listings/${id}`) } catch { /* no request scope */ } }
}

// Refresh the seller's PUBLIC surfaces after a state transition: the storefront +
// live listing pages are ISR-cached and carry the throttled/held caution line, so a
// transition that pulls nothing (e.g. good ↔ throttled) must still revalidate them.
// Bounded (transitions are rare admin/cron events, never a hot path) + best-effort.
async function revalidateSellerSurfaces(profileId: string): Promise<void> {
  try {
    const owned = await db.seller.findMany({ where: { ownerId: profileId }, select: { id: true } })
    if (!owned.length) return
    const live = await db.listing.findMany({
      where: { sellerId: { in: owned.map((s) => s.id) }, status: 'active', verified: true },
      select: { id: true },
      take: 500,
    })
    for (const s of owned) { try { revalidatePath(`/sellers/${s.id}`) } catch { return /* no request scope */ } }
    for (const l of live) { try { revalidatePath(`/listings/${l.id}`) } catch { return } }
  } catch (e) {
    console.error('[enforcement] revalidate surfaces failed', profileId, e)
  }
}

/**
 * The profile's CURRENT enforcement state — a single indexed PK read of the
 * denormalized column. Pre-migration (column missing) → 'good_standing', so every
 * gate built on this is a safe no-op until scripts/add-enforcement.mjs runs.
 */
export async function getEnforcement(profileId: string): Promise<{ state: EnforcementState; until: Date | null }> {
  try {
    const rows = await db.$queryRaw<{ state: string; until: Date | null }[]>`
      SELECT "enforcementState" AS state, "enforcementUntil" AS until FROM "Profile" WHERE "id" = ${profileId}::uuid`
    if (!rows.length) return { state: 'good_standing', until: null }
    return { state: normalizeEnforcementState(rows[0].state), until: rows[0].until }
  } catch {
    return { state: 'good_standing', until: null } // migration pending → everything no-ops
  }
}

/**
 * Execute an enforcement decision. IDEMPOTENT: no-op when the state is unchanged.
 * Supersedes any previous active action (status 'lifted'), executes the effects
 * (held/suspended pull the seller's live listings, recording exactly which — carried
 * forward on escalation, restored on downgrade), denormalizes onto Profile, and
 * notifies the seller (bell + push). Fail-quiet pre-migration.
 */
export async function applyEnforcement(
  profileId: string,
  next: EnforcementDecision,
  ctx: { decidedBy: string; triggerReportId?: string | null; adminNote?: string | null },
): Promise<boolean> {
  try {
    const rows = await db.$queryRaw<{ state: string }[]>`
      SELECT "enforcementState" AS state FROM "Profile" WHERE "id" = ${profileId}::uuid`
    if (!rows.length) return false
    const current = normalizeEnforcementState(rows[0].state)
    if (current === next.state) return false // idempotent — admin double-click / cron re-derive can't stack actions

    const now = new Date()
    const prevActive = await db.enforcementAction.findMany({
      where: { profileId, status: 'active' },
      select: { id: true, state: true, pulledListingIds: true },
    })
    if (prevActive.length) {
      await db.enforcementAction.updateMany({
        where: { id: { in: prevActive.map((a) => a.id) } },
        data: { status: 'lifted', liftedAt: now },
      })
    }

    // Pulled-listing bookkeeping across the transition: escalating to (or staying at)
    // held+ carries the previous action's pulled ids forward; dropping below held
    // restores them now.
    const nextSev = ENFORCEMENT_SEVERITY[next.state]
    const carried: string[] = []
    for (const a of prevActive) {
      const ids = parsePulled(a.pulledListingIds)
      if (!ids.length) continue
      if (nextSev >= ENFORCEMENT_SEVERITY.held) carried.push(...ids)
      else await restoreListings(ids)
    }

    if (next.state !== 'good_standing') {
      let pulled = carried
      if (nextSev >= ENFORCEMENT_SEVERITY.held) {
        // Pull every live listing (verified=false → out of the public feed), recording
        // exactly which so a lift restores precisely those. Bounded.
        const owned = await db.seller.findMany({ where: { ownerId: profileId }, select: { id: true } })
        if (owned.length) {
          const live = await db.listing.findMany({
            where: { sellerId: { in: owned.map((s) => s.id) }, status: 'active', verified: true },
            select: { id: true },
            take: 500,
          })
          if (live.length) {
            await db.listing.updateMany({ where: { id: { in: live.map((l) => l.id) } }, data: { verified: false } })
            for (const l of live) { try { revalidatePath(`/listings/${l.id}`) } catch { /* no request scope */ } }
            pulled = [...new Set([...carried, ...live.map((l) => l.id)])]
          }
        }
      }
      await db.enforcementAction.create({
        data: {
          profileId,
          state: next.state,
          reason: next.reason,
          adminNote: ctx.adminNote ?? null,
          triggerReportId: ctx.triggerReportId ?? null,
          decidedBy: ctx.decidedBy,
          status: 'active',
          expiresAt: next.expiresAt ? new Date(next.expiresAt) : null,
          pulledListingIds: pulled.length ? JSON.stringify(pulled) : null,
        },
        select: { id: true },
      })
    }

    const until = next.expiresAt ? new Date(next.expiresAt) : null
    await db.$executeRaw`
      UPDATE "Profile" SET "enforcementState" = ${next.state}, "enforcementUntil" = ${until} WHERE "id" = ${profileId}::uuid`

    await revalidateSellerSurfaces(profileId) // ISR caution line (listing/storefront)
    notifyEnforcement(profileId, next.reason === ENFORCEMENT_REASON.INSURANCE_GRACE ? 'grace' : next.state)
    return true
  } catch (e) {
    console.error('[enforcement] apply failed (migration pending?)', profileId, next.state, e)
    return false
  }
}

/**
 * Sync a profile's enforcement state from a fresh trust breakdown — the single entry
 * point the daily cron and the report-resolution hooks call. Derivation → insurance
 * grace → grace hold-back → system-vs-admin precedence → applyEnforcement. Fail-quiet.
 */
export async function syncEnforcement(
  profileId: string,
  breakdown: TrustBreakdown,
  opts?: { persistedScore?: number; triggerReportId?: string | null },
): Promise<void> {
  try {
    const rows = await db.$queryRaw<{ state: string; since: Date | null }[]>`
      SELECT "enforcementState" AS state, "goodStandingSince" AS since FROM "Profile" WHERE "id" = ${profileId}::uuid`
    if (!rows.length) return
    const current = normalizeEnforcementState(rows[0].state)

    const active = await db.enforcementAction.findFirst({
      where: { profileId, status: 'active' },
      orderBy: { createdAt: 'desc' },
      select: { decidedBy: true, reason: true, expiresAt: true },
    })
    const derived = deriveState({
      score: opts?.persistedScore ?? breakdown.score,
      hasScamHold: breakdown.inputs.hasScamHold,
      conductPenalty: breakdown.C,
      reports90: breakdown.inputs.reports90,
      transactions365: breakdown.inputs.transactions365,
    })

    // An un-expired 72h insurance grace holds back non-critical escalations —
    // the cron expires it, and THEN a still-derived state applies for real.
    if (holdForGrace(active ? { reason: active.reason, expiresAtMs: active.expiresAt?.getTime() ?? null } : null, derived.state)) return

    const graceUsedRecently = !!(await db.enforcementAction.findFirst({
      where: { profileId, reason: ENFORCEMENT_REASON.INSURANCE_GRACE, createdAt: { gt: new Date(Date.now() - ENFORCEMENT.GRACE_REUSE_DAYS * DAY_MS) } },
      select: { id: true },
    }))
    const effective = applyInsurance(derived, {
      insured: isInsured(rows[0].since ? rows[0].since.getTime() : null),
      currentState: current,
      graceUsedRecently,
    })

    if (!canSystemTransition({ state: current, decidedBy: active?.decidedBy ?? 'system' }, effective.state)) return
    await applyEnforcement(profileId, effective, { decidedBy: 'system', triggerReportId: opts?.triggerReportId ?? null })
  } catch (e) {
    console.error('[enforcement] sync failed (migration pending?)', profileId, e)
  }
}

/**
 * Lift or overturn an ACTIVE action (admin decision). Restores pulled listings,
 * resets the profile to good_standing, resolves a pending appeal favourably, and
 * notifies. Returns false when the action isn't active (idempotent for retries).
 */
export async function liftAction(actionId: string, opts: { to: 'lifted' | 'overturned'; by: string }): Promise<boolean> {
  try {
    const action = await db.enforcementAction.findUnique({
      where: { id: actionId },
      select: { id: true, profileId: true, status: true, pulledListingIds: true, appealedAt: true, appealOutcome: true },
    })
    if (!action || action.status !== 'active') return false
    await db.enforcementAction.update({
      where: { id: actionId },
      data: {
        status: opts.to,
        liftedAt: new Date(),
        // Relief granted while an appeal was pending resolves it in the seller's favour.
        ...(action.appealedAt && !action.appealOutcome ? { appealOutcome: 'overturned', appealResolvedAt: new Date() } : {}),
      },
    })
    await restoreListings(parsePulled(action.pulledListingIds))
    await db.$executeRaw`
      UPDATE "Profile" SET "enforcementState" = 'good_standing', "enforcementUntil" = NULL WHERE "id" = ${action.profileId}::uuid`
    await revalidateSellerSurfaces(action.profileId) // drop the ISR caution line
    notifyEnforcement(action.profileId, 'good_standing')
    return true
  } catch (e) {
    console.error('[enforcement] lift failed', actionId, e)
    return false
  }
}

/**
 * Expire timed actions (30d warnings, 72h insurance graces) — daily-cron pass, runs
 * BEFORE the sync loop so a lapsed grace that is STILL derived re-applies for real
 * on the same run (graceUsedRecently blocks a re-grace). Silent — a warning lapsing
 * cleanly needs no notification. Returns how many actions expired.
 */
export async function expireEnforcement(): Promise<number> {
  try {
    const due = await db.enforcementAction.findMany({
      where: { status: 'active', expiresAt: { lte: new Date() } },
      select: { id: true, profileId: true, pulledListingIds: true },
      take: 200,
    })
    if (!due.length) return 0
    await db.enforcementAction.updateMany({ where: { id: { in: due.map((a) => a.id) } }, data: { status: 'expired' } })
    for (const a of due) {
      await restoreListings(parsePulled(a.pulledListingIds)) // rare: a timed hold
      await db.$executeRaw`
        UPDATE "Profile" SET "enforcementState" = 'good_standing', "enforcementUntil" = NULL WHERE "id" = ${a.profileId}::uuid`
      await revalidateSellerSurfaces(a.profileId) // drop the ISR caution line
    }
    return due.length
  } catch {
    return 0 // migration pending
  }
}

/** Resolve a pending appeal AGAINST the seller (action stays active) + notify. */
export async function upholdAppeal(actionId: string): Promise<boolean> {
  try {
    const action = await db.enforcementAction.findUnique({
      where: { id: actionId },
      select: { id: true, profileId: true, appealedAt: true, appealOutcome: true },
    })
    if (!action || !action.appealedAt || action.appealOutcome) return false
    await db.enforcementAction.update({ where: { id: actionId }, data: { appealOutcome: 'upheld', appealResolvedAt: new Date() } })
    notifyEnforcement(action.profileId, 'appeal_upheld')
    return true
  } catch (e) {
    console.error('[enforcement] uphold failed', actionId, e)
    return false
  }
}

// ── Route gates (all server-side; callers pass an AUTHENTICATED profileId) ─────────

export type GateError = { error: string; limit?: number }

// Completed transactions for a SELLER (sold listings + accepted offers) — only ever
// queried for young accounts, both sides indexed (sellerId).
async function sellerTransactionCount(sellerId: string): Promise<number> {
  const [sold, offers] = await Promise.all([
    db.listing.count({ where: { sellerId, status: 'sold' } }),
    db.message.count({ where: { kind: 'offer', offerStatus: 'accepted', conversation: { sellerId } } }),
  ])
  return sold + offers
}

/**
 * Publish gate for POST /api/listings: held/suspended block posting outright;
 * a probation account (<30d AND <3 transactions) is capped at 8 active listings.
 * Error codes are stable JSON the post wizard maps to friendly copy:
 * 'account_held' | 'account_suspended' | { 'probation_listing_cap', limit }.
 */
export async function postingGate(profileId: string, sellerId: string): Promise<GateError | null> {
  const { state } = await getEnforcement(profileId)
  if (blocksPosting(state)) return { error: state === 'suspended' ? 'account_suspended' : 'account_held' }

  const profile = await db.profile.findUnique({ where: { id: profileId }, select: { createdAt: true } })
  if (!profile) return null
  const ageDays = (Date.now() - profile.createdAt.getTime()) / DAY_MS
  if (ageDays >= ENFORCEMENT.PROBATION.MIN_ACCOUNT_AGE_DAYS) return null
  if (!isProbation(ageDays, await sellerTransactionCount(sellerId))) return null

  const active = await db.listing.count({ where: { sellerId, status: 'active' } })
  if (active >= ENFORCEMENT.PROBATION.MAX_ACTIVE_LISTINGS) {
    return { error: 'probation_listing_cap', limit: ENFORCEMENT.PROBATION.MAX_ACTIVE_LISTINGS }
  }
  return null
}

/**
 * Gate for POST /api/conversations: suspended blocks all conversation activity;
 * a probation account may INITIATE at most 15 new conversations per day (the route
 * exempts existing threads — the cap is on new outreach, not on replying).
 */
export async function conversationGate(profileId: string): Promise<GateError | null> {
  const { state } = await getEnforcement(profileId)
  if (blocksMessaging(state)) return { error: 'account_suspended' }

  const profile = await db.profile.findUnique({ where: { id: profileId }, select: { createdAt: true } })
  if (!profile) return null
  const ageDays = (Date.now() - profile.createdAt.getTime()) / DAY_MS
  if (ageDays >= ENFORCEMENT.PROBATION.MIN_ACCOUNT_AGE_DAYS) return null
  // Buyer-side transactions: offers accepted in threads they opened.
  const tx = await db.message.count({ where: { kind: 'offer', offerStatus: 'accepted', conversation: { buyerProfileId: profileId } } })
  if (!isProbation(ageDays, tx)) return null

  const today = await db.conversation.count({ where: { buyerProfileId: profileId, createdAt: { gt: new Date(Date.now() - DAY_MS) } } })
  if (today >= ENFORCEMENT.PROBATION.MAX_NEW_CONVERSATIONS_PER_DAY) {
    return { error: 'probation_conversation_cap', limit: ENFORCEMENT.PROBATION.MAX_NEW_CONVERSATIONS_PER_DAY }
  }
  return null
}

/** Gate for message/offer/review creation: only suspension blocks. */
export async function messagingGate(profileId: string): Promise<GateError | null> {
  const { state } = await getEnforcement(profileId)
  return blocksMessaging(state) ? { error: 'account_suspended' } : null
}
