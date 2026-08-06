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
  FLAG_REASONS,
  applyInsurance,
  blocksMessaging,
  blocksPosting,
  canSystemTransition,
  deriveState,
  holdForGrace,
  isInsured,
  isProbation,
  isFlagReason,
  normalizeEnforcementState,
  type EnforcementDecision,
  type EnforcementState,
  type FlagReason,
} from './enforcement-machine'
import type { TrustBreakdown } from './trust' // type-only — no runtime cycle (trust.ts imports us)

/**
 * Enforcement ladder Phase 2+3 — DB wiring for the pure machine (enforcement-machine.ts).
 *
 * The Phase 2 columns/table (scripts/add-enforcement.mjs) are LIVE on prod, so the
 * old guarded-raw-SQL reads are plain typed Prisma access now. Only the Phase 3
 * surface (BannedIdentity table, Report.preScreen — scripts/add-ban-evasion.mjs) is
 * still deploy-order-guarded: those reads skip silently pre-migration. The remaining
 * try/catch blocks are FAIL-QUIET CONTRACTS, not migration guards — enforcement is a
 * side-car to moderation/cron/login flows and must never fail its caller.
 *
 * FLAG rows (reason ∈ FLAG_REASONS): silent review annotations for the admin console —
 * they never touch Profile.enforcementState and never notify the seller, so every
 * ladder query here excludes them (see FLAG_REASONS in enforcement-machine.ts).
 *
 * SECURITY: nothing here trusts the client — callers pass a profileId they have already
 * authenticated (getCurrentProfile/getCurrentProfileId) or admin-gated (getAdmin).
 */

export type { EnforcementState, EnforcementDecision, FlagReason } from './enforcement-machine'
export {
  ENFORCEMENT,
  ENFORCEMENT_REASON,
  ENFORCEMENT_STATES,
  FLAG_REASONS,
  blocksMessaging,
  blocksPosting,
  isProbation,
  velocitySpike,
} from './enforcement-machine'

// Prisma `reason` filter that keeps flag rows out of ladder queries.
const NOT_FLAGS = { notIn: [...FLAG_REASONS] as string[] }

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
  // Ban-evasion review (Phase 3): held pending a HUMAN look — the copy must not
  // accuse (a phone match is often a family member: VN families share numbers).
  ban_evasion_review: {
    title: { en: 'Your account needs a quick review', vi: 'Tài khoản của bạn cần được xem xét nhanh' },
    body: {
      en: 'Posting is paused while a person double-checks your account details. This usually clears quickly — you can appeal from your dashboard if it takes too long.',
      vi: 'Đăng tin tạm dừng trong khi nhân viên kiểm tra lại thông tin tài khoản của bạn. Việc này thường hoàn tất nhanh — bạn có thể khiếu nại từ trang quản lý nếu chờ quá lâu.',
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
async function restoreListings(ids: string[], client: Pick<typeof db, 'listing'> = db): Promise<void> {
  if (!ids.length) return
  await client.listing.updateMany({ where: { id: { in: ids }, status: 'active', verified: false }, data: { verified: true } })
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
    // Deliberately capped at 500: revalidation is best-effort cache freshening (ISR
    // pages self-heal on their revalidate window) — unlike the listing PULL in
    // applyEnforcement, missing the overflow here loses nothing durable.
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
 * The profile's CURRENT enforcement state — a single PK read of the denormalized
 * column. Missing profile → 'good_standing' (gates built on this stay safe no-ops).
 */
export async function getEnforcement(profileId: string): Promise<{ state: EnforcementState; until: Date | null }> {
  const p = await db.profile.findUnique({
    where: { id: profileId },
    select: { enforcementState: true, enforcementUntil: true },
  })
  if (!p) return { state: 'good_standing', until: null }
  return { state: normalizeEnforcementState(p.enforcementState), until: p.enforcementUntil }
}

/**
 * Execute an enforcement decision. IDEMPOTENT: no-op when the state is unchanged.
 * Supersedes any previous active action (status 'lifted') — silent review FLAGS are
 * NOT actions and survive the transition — executes the effects (held/suspended pull
 * the seller's live listings, recording exactly which — carried forward on escalation,
 * restored on downgrade; suspension records/clears the ban-evasion identity anchors),
 * denormalizes onto Profile, and notifies the seller (bell + push). Fail-quiet:
 * moderation/cron/login callers must never 500 because a side effect hiccupped.
 */
export async function applyEnforcement(
  profileId: string,
  next: EnforcementDecision,
  ctx: { decidedBy: string; triggerReportId?: string | null; adminNote?: string | null },
): Promise<boolean> {
  try {
    const p = await db.profile.findUnique({ where: { id: profileId }, select: { enforcementState: true } })
    if (!p) return false
    const current = normalizeEnforcementState(p.enforcementState)
    if (current === next.state) return false // idempotent — admin double-click / cron re-derive can't stack actions

    const now = new Date()
    const prevActive = await db.enforcementAction.findMany({
      where: { profileId, status: 'active', reason: NOT_FLAGS }, // flags outlive ladder transitions
      select: { id: true, state: true, pulledListingIds: true },
    })
    // ONE transaction for the whole mutation (audit P2): a throw between the listing
    // pull and the action create used to strand pulled listings with NO recorded
    // action (so no lift could ever restore them) and an unchanged profile state.
    // Path revalidation happens AFTER commit — never inside the txn.
    const nextSev = ENFORCEMENT_SEVERITY[next.state]
    const revalidateIds = await db.$transaction(async (tx) => {
      const touched: string[] = []
      if (prevActive.length) {
        await tx.enforcementAction.updateMany({
          where: { id: { in: prevActive.map((a) => a.id) } },
          data: { status: 'lifted', liftedAt: now },
        })
      }

      // Pulled-listing bookkeeping across the transition: escalating to (or staying at)
      // held+ carries the previous action's pulled ids forward; dropping below held
      // restores them now.
      const carried: string[] = []
      for (const a of prevActive) {
        const ids = parsePulled(a.pulledListingIds)
        if (!ids.length) continue
        if (nextSev >= ENFORCEMENT_SEVERITY.held) carried.push(...ids)
        else { await tx.listing.updateMany({ where: { id: { in: ids }, status: 'active', verified: false }, data: { verified: true } }); touched.push(...ids) }
      }

      if (next.state !== 'good_standing') {
        let pulled = carried
        if (nextSev >= ENFORCEMENT_SEVERITY.held) {
          // Pull every live listing (verified=false → out of the public feed), recording
          // exactly which so a lift restores precisely those. Drained in 500-row batches:
          // a >500-listing seller must have EVERY live listing pulled AND recorded — an
          // unrecorded pull could never be restored by a lift.
          //
          // ⚠️ NO cursor/skip here, deliberately (fixed 2026-07-25, confirmed by codex +
          // Gemini). `cursor: { id } , skip: 1` LEAKED one listing per batch boundary:
          // Prisma compiles the cursor to an outer `id >= cursor` predicate and `skip: 1`
          // to `OFFSET 1`, but this loop has just set the cursor row verified=false, so it
          // no longer satisfies `verified: true` and is filtered out BEFORE the offset
          // applies — so OFFSET 1 discarded the first still-unprocessed row instead of the
          // cursor row. One active listing per ~501 stayed publicly visible on a
          // held/suspended seller. No cursor is needed at all: each updateMany removes its
          // own batch from the WHERE, so the matching set strictly shrinks and a plain
          // take-500 loop drains it. Don't "optimise" the cursor back in.
          const owned = await tx.seller.findMany({ where: { ownerId: profileId }, select: { id: true } })
          if (owned.length) {
            const pulledNow: string[] = []
            // Bound the loop so a pathological state can't hold transaction locks forever.
            // ⚠️ It must FAIL LOUDLY, never silently finish: codex refuted the first version
            // of this fix because exhausting the bound would have left matching listings
            // public while reporting success — the very defect being fixed. `drained` is
            // true only on proof of completion (an empty or short batch).
            let drained = false
            for (let pass = 0; pass < 1000; pass++) {
              const live = await tx.listing.findMany({
                where: { sellerId: { in: owned.map((s) => s.id) }, status: 'active', verified: true },
                select: { id: true },
                orderBy: { id: 'asc' },
                take: 500,
              })
              if (!live.length) { drained = true; break }
              await tx.listing.updateMany({ where: { id: { in: live.map((l) => l.id) } }, data: { verified: false } })
              pulledNow.push(...live.map((l) => l.id))
              if (live.length < 500) { drained = true; break }
            }
            // Throwing rolls the whole transaction back, so the account is left UNCHANGED
            // rather than sanctioned-but-still-visible with a half-recorded pull list an
            // admin lift could not undo. Unreachable for real data (500k listings on one
            // seller); if it ever fires, that is a bug worth seeing.
            if (!drained) {
              throw new Error(`applyEnforcement: listing drain did not complete for profile ${profileId}`)
            }
            if (pulledNow.length) {
              touched.push(...pulledNow)
              pulled = [...new Set([...carried, ...pulledNow])]
            }
          }
        }
        await tx.enforcementAction.create({
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
      await tx.profile.update({ where: { id: profileId }, data: { enforcementState: next.state, enforcementUntil: until } })
      return touched
    })
    for (const id of revalidateIds) { try { revalidatePath(`/listings/${id}`) } catch { /* no request scope */ } }

    // Ban-evasion anchors (Phase 3): entering suspension records the account's
    // phone+email; leaving it clears them (covers admin set-state downgrades, which
    // bypass liftAction). Phone is the anchor identity in a phone-verified marketplace.
    if (next.state === 'suspended') await recordBannedIdentity(profileId, next.reason)
    else if (current === 'suspended') await clearBannedIdentity(profileId)

    await revalidateSellerSurfaces(profileId) // ISR caution line (listing/storefront)
    notifyEnforcement(
      profileId,
      next.reason === ENFORCEMENT_REASON.INSURANCE_GRACE ? 'grace'
        : next.reason === ENFORCEMENT_REASON.BAN_EVASION_REVIEW ? 'ban_evasion_review'
          : next.state,
    )
    return true
  } catch (e) {
    // ⚠️ RETHROW — DO NOT return false here. This function returns `false` for the ordinary
    // "already in that state, nothing to do" case, and the admin route explicitly treats that as
    // non-fatal and answers HTTP 200 `{ ok: true }`. Collapsing a FAILED WRITE into the same
    // `false` meant an admin could suspend a scammer, watch the console report success, and leave
    // them trading — the single worst shape this bug class has, because the human believes the
    // action landed and stops watching. The two system callers below already sit inside their own
    // try/catch, so their best-effort behaviour is unchanged; only the admin path, which has no
    // catch, now surfaces a non-2xx and tells the operator to retry.
    console.error('[enforcement] apply failed', profileId, next.state, e)
    throw e
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
    const p = await db.profile.findUnique({
      where: { id: profileId },
      select: { enforcementState: true, goodStandingSince: true },
    })
    if (!p) return
    const current = normalizeEnforcementState(p.enforcementState)

    // Flags excluded: a system-decided flag row must not make an ADMIN action look
    // system-decided (which would let the sync silently downgrade it).
    const active = await db.enforcementAction.findFirst({
      where: { profileId, status: 'active', reason: NOT_FLAGS },
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
      insured: isInsured(p.goodStandingSince ? p.goodStandingSince.getTime() : null),
      currentState: current,
      graceUsedRecently,
    })

    if (!canSystemTransition({ state: current, decidedBy: active?.decidedBy ?? 'system' }, effective.state)) return
    await applyEnforcement(profileId, effective, { decidedBy: 'system', triggerReportId: opts?.triggerReportId ?? null })
  } catch (e) {
    // Fail-quiet contract: the sync rides trust recomputes / report resolutions —
    // an enforcement hiccup must never fail the moderation flow or the cron.
    console.error('[enforcement] sync failed', profileId, e)
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
      select: { id: true, profileId: true, state: true, reason: true, status: true, pulledListingIds: true, appealedAt: true, appealOutcome: true },
    })
    if (!action || action.status !== 'active') return false
    // Flag rows have their own close-out (dismissFlag) — lifting one here would
    // wrongly reset the profile to good_standing and notify the seller.
    if (isFlagReason(action.reason)) return false
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
    // updateMany: tolerate a since-deleted profile (matches the old raw-UPDATE semantics).
    await db.profile.updateMany({
      where: { id: action.profileId },
      data: { enforcementState: 'good_standing', enforcementUntil: null },
    })
    // Lifting a SUSPENSION also frees its ban-evasion anchors (a lift/overturn says
    // "this account is fine" — its phone must stop flagging new signups for review).
    if (action.state === 'suspended') await clearBannedIdentity(action.profileId)
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
      select: { id: true, profileId: true, state: true, pulledListingIds: true },
      take: 200,
    })
    if (!due.length) return 0
    await db.enforcementAction.updateMany({ where: { id: { in: due.map((a) => a.id) } }, data: { status: 'expired' } })
    for (const a of due) {
      await restoreListings(parsePulled(a.pulledListingIds)) // rare: a timed hold
      await db.profile.updateMany({
        where: { id: a.profileId },
        data: { enforcementState: 'good_standing', enforcementUntil: null },
      })
      // A TIMED suspension lapsing is a lift too — its ban anchors go with it.
      if (a.state === 'suspended') await clearBannedIdentity(a.profileId)
      await revalidateSellerSurfaces(a.profileId) // drop the ISR caution line
    }
    return due.length
  } catch (e) {
    console.error('[enforcement] expiry failed', e) // fail-quiet: the cron continues
    return 0
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

// ── Phase 3 · Identity layer (ban evasion + silent review flags) ───────────────────
// Phone is the anchor identity in a phone-verified marketplace — the only strong
// identity we hold. Device/payment fingerprinting is deferred infra; IP linking is
// explicitly OUT (VN mobile CGNAT would link whole neighborhoods). Every
// BannedIdentity query is guarded: the table lands with scripts/add-ban-evasion.mjs,
// so pre-migration these skip silently and nothing else changes.

/** Record a suspended account's identity anchors (called by applyEnforcement). */
async function recordBannedIdentity(profileId: string, reason: string): Promise<void> {
  try {
    const p = await db.profile.findUnique({ where: { id: profileId }, select: { phone: true, email: true } })
    if (!p || (!p.phone && !p.email)) return
    // Replace wholesale — a re-suspend refreshes the anchors instead of stacking rows.
    await db.bannedIdentity.deleteMany({ where: { sourceProfileId: profileId } })
    await db.bannedIdentity.create({
      data: { phone: p.phone, email: p.email, sourceProfileId: profileId, reason },
      select: { id: true },
    })
  } catch (e) {
    console.error('[enforcement] ban-identity record skipped (migration pending?)', profileId, e)
  }
}

/** Free a profile's identity anchors (suspension lifted / overturned / expired). */
async function clearBannedIdentity(profileId: string): Promise<void> {
  try {
    await db.bannedIdentity.deleteMany({ where: { sourceProfileId: profileId } })
  } catch { /* table lands with scripts/add-ban-evasion.mjs — nothing to clear before it */ }
}

/**
 * Create a SILENT review flag — an EnforcementAction row that is an annotation for
 * the admin console, never a punishment: it records the profile's CURRENT state
 * (unchanged), never touches the Profile denorm, and NEVER notifies the seller.
 * A velocity spike is usually just a good week, and an email match is often a
 * shared mailbox — flagging must be free of side effects or the detectors would
 * punish the innocent. Dedup: one ACTIVE flag per (profile, reason); `once`
 * additionally suppresses re-flagging after a dismissal — used for identity flags,
 * where an admin's "false positive" ruling must stick across future logins.
 */
export async function flagForReview(profileId: string, reason: FlagReason, opts?: { once?: boolean }): Promise<boolean> {
  try {
    const prior = await db.enforcementAction.findFirst({
      where: opts?.once ? { profileId, reason } : { profileId, reason, status: 'active' },
      select: { id: true },
    })
    if (prior) return false
    const { state } = await getEnforcement(profileId)
    await db.enforcementAction.create({
      data: { profileId, state, reason, decidedBy: 'system', status: 'active' },
      select: { id: true },
    })
    return true
  } catch (e) {
    // P2002 = the partial unique index (unique-constraints.mjs §4) held against a
    // concurrent detector's create — benign, identical outcome to the prior-row path.
    if ((e as { code?: string })?.code === 'P2002') return false
    console.error('[enforcement] flag failed', profileId, reason, e)
    return false
  }
}

/**
 * Dismiss a review flag (admin console): the row closes, and NOTHING else moves —
 * deliberately not liftAction, which resets Profile.enforcementState and restores
 * listings (dismissing a flag on a suspended account must not un-suspend it).
 */
export async function dismissFlag(actionId: string): Promise<boolean> {
  try {
    const n = await db.enforcementAction.updateMany({
      where: { id: actionId, status: 'active', reason: { in: [...FLAG_REASONS] } },
      data: { status: 'lifted', liftedAt: new Date() },
    })
    return n.count > 0
  } catch (e) {
    console.error('[enforcement] dismiss flag failed', actionId, e)
    return false
  }
}

/**
 * Ban-evasion check, run at the phone-mirror moment in ensureProfile — the ONE
 * place a strong identity attaches to an account. A verified phone matching a
 * BannedIdentity row from a DIFFERENT profile parks the account 'held' for admin
 * review. NEVER auto-suspends: VN families share numbers, so a match can be a
 * relative on the household SIM — a human decides, and lifting the hold both
 * restores the account and (via the prior-action check below) clears it for good.
 * An email match alone is a weaker signal (mailboxes are shared/recycled) → silent
 * review flag only; the state stays exactly where it was.
 */
export async function checkBanEvasion(
  profileId: string,
  identity: { phone: string | null; email: string | null },
): Promise<void> {
  if (!identity.phone && !identity.email) return
  try {
    // One review per account EVER (any status): an admin lift/dismiss is a human
    // "false positive" ruling that must stick — without this, the cleared family
    // member would be re-held on every subsequent login.
    //
    // ⚠️ The two reasons are NOT interchangeable (fixed 2026-07-25, confirmed by codex
    // + Gemini). Checking `in: [REVIEW, EMAIL]` and returning early meant a single
    // SILENT email annotation — which by design changes nothing about the account —
    // made that account permanently immune to the phone-match HOLD. A banned phone is
    // the strong signal; it must never be shielded by the weak one. Only a prior
    // REVIEW (the actual admin-ruling case) suppresses the hold.
    const priorReview = await db.enforcementAction.findFirst({
      where: { profileId, reason: ENFORCEMENT_REASON.BAN_EVASION_REVIEW },
      select: { id: true },
    })
    if (priorReview) return

    if (identity.phone) {
      // sourceProfileId ≠ self: the suspended account logging back in isn't "evasion".
      const hit = await db.bannedIdentity.findFirst({
        where: { phone: identity.phone, sourceProfileId: { not: profileId } },
        select: { id: true },
      })
      if (hit) {
        // Only park accounts BELOW held — an already-held/suspended account is
        // already in front of the admin, and 'held' must never soften 'suspended'.
        const { state } = await getEnforcement(profileId)
        if (ENFORCEMENT_SEVERITY[state] < ENFORCEMENT_SEVERITY.held) {
          await applyEnforcement(
            profileId,
            { state: 'held', reason: ENFORCEMENT_REASON.BAN_EVASION_REVIEW, expiresAt: null },
            { decidedBy: 'system' },
          )
        }
        return // the phone hit covers it — an extra email flag would just be queue noise
      }
    }
    if (identity.email) {
      const hit = await db.bannedIdentity.findFirst({
        where: { email: identity.email, sourceProfileId: { not: profileId } },
        select: { id: true },
      })
      if (hit) await flagForReview(profileId, ENFORCEMENT_REASON.BAN_EVASION_EMAIL, { once: true })
    }
  } catch { /* BannedIdentity lands with scripts/add-ban-evasion.mjs — skip silently pre-migration */ }
}

// ── Route gates (all server-side; callers pass an AUTHENTICATED profileId) ─────────

export type GateError = { error: string; limit?: number }

// Completed transactions for a SELLER (sold listings + accepted offers) — only ever
// queried for young accounts, both sides indexed (sellerId).
/**
 * ⚠️ UNIONED BY LISTING, NOT SUMMED — this must agree with src/lib/trust.ts, which states the rule:
 * "a sold listing OR a conversation with an accepted offer, unioned by listing so a sold listing
 * whose thread also had an accepted offer counts once."
 *
 * This function used to `count()` accepted-offer MESSAGES and ADD them to the sold count, which
 * inflated the same seller two different ways: a sold listing whose thread also held an accepted
 * offer scored 2, and — since accepting is not terminal per-thread — several accepted offers on ONE
 * listing each scored 1. That number gates probation (postingGate's 8-listing cap and
 * bulkPostingBudget), so a new seller could lift their own cap by accepting a handful of offers in a
 * single thread with one accomplice. Trust scored the same activity as one transaction, which is
 * how the divergence stayed invisible: the two systems disagreed about the same seller.
 */
async function sellerTransactionCount(sellerId: string): Promise<number> {
  const [sold, offers] = await Promise.all([
    db.listing.findMany({ where: { sellerId, status: 'sold' }, select: { id: true } }),
    db.message.findMany({
      where: { kind: 'offer', offerStatus: 'accepted', conversation: { sellerId } },
      select: { conversation: { select: { listingId: true } } },
    }),
  ])
  const listings = new Set(sold.map((l) => l.id))
  for (const m of offers) if (m.conversation?.listingId) listings.add(m.conversation.listingId)
  return listings.size
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
 * Batch variant for the bulk/sync cores (audit P0 #3 follow-through): the single
 * postingGate is a preflight, so a probation seller at 7 active could still bulk-create
 * 200. This returns the remaining CREATE budget so the cores can cap inside the loop —
 * and, living in the cores, it covers every caller (routes, MCP tools, future API).
 * maxNewActive null = uncapped (not probation).
 */
export async function bulkPostingBudget(profileId: string, sellerId: string): Promise<{ blocked: GateError | null; maxNewActive: number | null }> {
  const { state } = await getEnforcement(profileId)
  if (blocksPosting(state)) {
    return { blocked: { error: state === 'suspended' ? 'account_suspended' : 'account_held' }, maxNewActive: 0 }
  }
  const profile = await db.profile.findUnique({ where: { id: profileId }, select: { createdAt: true } })
  if (!profile) return { blocked: null, maxNewActive: null }
  const ageDays = (Date.now() - profile.createdAt.getTime()) / DAY_MS
  if (ageDays >= ENFORCEMENT.PROBATION.MIN_ACCOUNT_AGE_DAYS) return { blocked: null, maxNewActive: null }
  if (!isProbation(ageDays, await sellerTransactionCount(sellerId))) return { blocked: null, maxNewActive: null }
  const active = await db.listing.count({ where: { sellerId, status: 'active' } })
  return { blocked: null, maxNewActive: Math.max(0, ENFORCEMENT.PROBATION.MAX_ACTIVE_LISTINGS - active) }
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
  // ⚠️ Unioned by listing, for the same reason as sellerTransactionCount above — a raw message
  // count let several accepted offers in ONE thread each read as a separate transaction, which is
  // what lifts the probation conversation cap. One listing bought is one transaction.
  const accepted = await db.message.findMany({
    where: { kind: 'offer', offerStatus: 'accepted', conversation: { buyerProfileId: profileId } },
    select: { conversation: { select: { listingId: true } } },
  })
  const tx = new Set(accepted.map((m) => m.conversation?.listingId).filter(Boolean)).size
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
