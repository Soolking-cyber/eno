import 'server-only'
import { after } from 'next/server'
import { revalidatePublicPath } from '@/lib/revalidate-lang'
import { db } from './db'
import { sendPushToProfile } from './push'
import { pickLocale } from './admin-macros'
import { DAY_MS, TRUST } from './trust-math'
import { isVerifiedCatalogueSeller } from './catalogue-seller'
import { partitionByIdentityGate, settleHolds } from './compliance/seller-publish-gate'
import {
  ENFORCEMENT,
  ENFORCEMENT_REASON,
  ENFORCEMENT_SEVERITY,
  FLAG_REASONS,
  applyInsurance,
  blocksMessaging,
  blocksPosting,
  deriveState,
  holdForGrace,
  isHumanProtected,
  isInsured,
  isProbation,
  isFlagReason,
  normalizeEnforcementState,
  planSystemMove,
  strongestFloor,
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

// EnforcementAction.status for a HUMAN-PROTECTED action a system escalation set aside: not in
// force (never 'active', so no ladder/appeal/dashboard query sees it), not ended either — it is
// the floor syncEnforcement comes back down to (planSystemMove). Retired to 'lifted' by the next
// human ruling or when re-instated. A plain string column, so no DDL.
const SUPERSEDED = 'superseded'

/** The Profile moved between the decision and the write (see applyEnforcement). */
class EnforcementConflict extends Error {
  constructor(profileId: string) {
    super(`enforcement state changed concurrently for profile ${profileId}`)
  }
}

// ── Seller-facing notices (calm, specific, ONE action — never punitive-corporate).
// EN + VI; the recipient gets THEIR language (Profile.locale). Deep link: /dashboard, unless the
// notice names a different single action (`url`).
type Notice = { title: { en: string; vi: string }; body: { en: string; vi: string }; url?: string }

// The release wait, from the constant the release rule enforces — never retyped into copy.
const RELEASE_DAYS = TRUST.SCAM_RELEASE_MIN_DAYS
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
  // ⛔ A SCAM HOLD GETS ITS OWN NOTICE, because the generic `held` copy is wrong for it twice over:
  // it implies the review is still running (the report is already CONFIRMED), and it says nothing
  // about how the hold ends — which since 2026-09-23 is only by a person: a won appeal on the report,
  // or a release (verified identity + a written plan + an admin, no sooner than RELEASE_DAYS after
  // the confirmation). Sellers used to be able to mark items sold to get out; saying so outright
  // stops them trying. The one action is verification, the step only the seller can take.
  scam_hold: {
    title: { en: 'Your listings are paused', vi: 'Tin đăng của bạn đã tạm dừng' },
    body: {
      en: `A serious report against your account was confirmed, so your listings are hidden. Marking items as sold does not lift this. If the report is wrong, appeal it from the case page. To ask for your listings back: verify your identity, then message our support team with your plan — what happened and what you have changed. We review requests no sooner than ${RELEASE_DAYS} days after the report was confirmed.`,
      vi: `Một báo cáo nghiêm trọng về tài khoản của bạn đã được xác nhận nên tin đăng của bạn đang bị ẩn. Việc đánh dấu đã bán không gỡ được hạn chế này. Nếu báo cáo không đúng, hãy khiếu nại trong trang hồ sơ vụ việc. Để yêu cầu khôi phục tin đăng: hãy xác minh danh tính, sau đó nhắn cho đội hỗ trợ kế hoạch của bạn — điều gì đã xảy ra và bạn đã thay đổi những gì. Chúng tôi chỉ xem xét yêu cầu sau ít nhất ${RELEASE_DAYS} ngày kể từ khi báo cáo được xác nhận.`,
    },
    url: '/dashboard/verification',
  },
  // Sent with the transition a RELEASE causes (scam-hold.ts). The charge keeps its weight, so the
  // account may land in `throttled` (caution line, low tier) rather than good standing — the generic
  // `throttled` copy ("under review") would be false, and "everything is restored" would be too.
  // ⚠️ NO PROMISE ABOUT POSTING (review, 2026-09-24). A released seller usually stays in the
  // restricted tier, which refuses new listings, and whether a release should give posting back is
  // an OWNER decision not yet made — so the copy says posting "may stay blocked" and names no path
  // or timeline (it used to say "while your trust score rebuilds", which implied one). It also says
  // the listing the confirmed report was about does NOT come back (forgetPulledListings).
  scam_released: {
    title: { en: 'Your listings are visible again', vi: 'Tin đăng của bạn đã hiển thị trở lại' },
    body: {
      en: 'Our team reviewed your plan and released the hold: the listings it paused are visible again, apart from any listing a confirmed report was about. The confirmed report stays on your record at full weight, so buyers may see a caution note and posting new listings may stay blocked. Message our support team if you have questions.',
      vi: 'Đội ngũ của chúng tôi đã xem xét kế hoạch của bạn và gỡ tạm dừng: các tin đăng bị tạm dừng đã hiển thị trở lại, trừ tin đăng mà báo cáo đã xác nhận nhắc đến. Báo cáo đã xác nhận vẫn được giữ nguyên trong hồ sơ của bạn, vì vậy người mua có thể thấy lưu ý thận trọng và việc đăng tin mới có thể vẫn bị chặn. Nếu có câu hỏi, hãy nhắn cho đội hỗ trợ của chúng tôi.',
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
  // Upheld on a SCAM HOLD: system-created, but it no longer "lifts automatically as your record
  // improves" — nothing the seller does alone ends it (scamStage), so the generic upheld copy would
  // be a promise the platform cannot keep. It says what does end it.
  appeal_upheld_scam: {
    title: { en: 'Your appeal was reviewed', vi: 'Khiếu nại của bạn đã được xem xét' },
    body: {
      en: `We looked at your appeal carefully and the hold stays. It does not lift on its own or when items are marked sold. To ask for release: verify your identity and message our support team with your plan — we review it no sooner than ${RELEASE_DAYS} days after the report was confirmed.`,
      vi: `Chúng tôi đã xem xét kỹ khiếu nại của bạn và việc tạm dừng vẫn được giữ nguyên. Hạn chế này không tự gỡ và cũng không được gỡ khi đánh dấu đã bán. Để yêu cầu gỡ: hãy xác minh danh tính và nhắn cho đội hỗ trợ kế hoạch của bạn — chúng tôi chỉ xem xét sau ít nhất ${RELEASE_DAYS} ngày kể từ khi báo cáo được xác nhận.`,
    },
    url: '/dashboard/verification',
  },
  // Upheld on a HUMAN-PROTECTED action (an admin's, or a ban-evasion review): the system can never
  // lift it (planSystemMove), so "lifts automatically" would be a promise the platform cannot keep.
  appeal_upheld_manual: {
    title: { en: 'Your appeal was reviewed', vi: 'Khiếu nại của bạn đã được xem xét' },
    body: {
      en: 'We looked at your appeal carefully and the decision stands for now. Our team will review your account again — you do not need to do anything.',
      vi: 'Chúng tôi đã xem xét kỹ khiếu nại của bạn và quyết định tạm thời được giữ nguyên. Đội ngũ của chúng tôi sẽ xem xét lại tài khoản của bạn — bạn không cần làm gì thêm.',
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
      const url = copy.url ?? '/dashboard'
      await db.notification.create({
        data: { recipientId: profileId, type: 'system', title: copy.title[l], body: copy.body[l], actorName: 'eno.vn', url },
      })
      await sendPushToProfile(profileId, { title: copy.title[l], body: copy.body[l], url, tag: 'eno-enforcement' })
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
//
// ⚖️ SELLER IDENTITY GATE: a lift or expiry is an enforcement decision, not an identity one, so for
// an owner the gate refuses the pulled rows are PARKED (identityHold) instead of published, and
// releaseIdentityHolds() publishes them when the seller verifies. Returns how many were parked.
// Gate off → `held` is empty with no read, and the write is the one this function always made,
// plus `identityHold: false` — a row this restore publishes must never go live still carrying a hold.
async function restoreListings(ids: string[], client: Pick<typeof db, 'listing'> = db): Promise<{ held: number }> {
  if (!ids.length) return { held: 0 }
  const { allowed, held } = await partitionByIdentityGate(ids)
  if (allowed.length) await client.listing.updateMany({ where: { id: { in: allowed }, status: 'active', verified: false }, data: { verified: true, identityHold: false } })
  // ⚠️ THE IDS THE PARK WROTE, NOT THE DECISION SET `held` — for the count AND for the re-check. The
  // guard skips rows sold/hidden/re-approved since the pull and rows ALREADY parked, and handing the
  // whole set to settleHolds let a pre-existing hold it released cancel out a row parked HERE (the
  // cap below `parked` hid that only while every id shared one owner). Same fix as the admin batch.
  const parked = held.length
    ? (await client.listing.updateManyAndReturn({ where: { id: { in: held }, status: 'active', verified: false, identityHold: false }, data: { identityHold: true }, select: { id: true } })).map((r) => r.id)
    : []
  // A verification that landed between the decision and the park is released here (settleHolds).
  const released = parked.length ? await settleHolds(parked) : 0
  for (const id of ids) { try { revalidatePublicPath(`/listings/${id}`) } catch { /* no request scope */ } }
  return { held: Math.max(0, parked.length - released) }
}

/**
 * Take listings OUT of every active hold's restore list (`pulledListingIds`), so no later lift, expiry,
 * downgrade or scam-hold release republishes them. For a listing a MODERATION decision took down while
 * a hold had it pulled — above all the listing a confirmed scam report is about.
 *
 * ⛔ WHY IT EXISTS (review of the scam-hold release, 2026-09-24). confirm-report re-derives enforcement
 * FIRST — the resulting scam hold pulls every live listing, the reported one included, and records it —
 * and only then takes the reported listing down. Both writes are the same `verified=false`, so the hold's
 * list could not tell "pulled by the hold" from "taken down by the report", and the restore on release
 * (or overturn, or any lift) put the confirmed scam listing back on the public feed. A takedown is not
 * the hold's to undo — the admin re-approves in Moderation ("NO AUTO-REPUBLISH", core/listings.ts).
 *
 * Throws on a DB failure (the release/overturn callers must not go on to restore); confirm-report,
 * whose dock has already landed, calls it best-effort. Compare-and-set per row: a row a concurrent
 * transition rewrote is re-read rather than overwritten with a stale list.
 */
export async function forgetPulledListings(listingIds: ReadonlyArray<string | null | undefined>): Promise<number> {
  const ids = [...new Set(listingIds.filter((x): x is string => !!x))]
  if (!ids.length) return 0
  let forgotten = 0
  for (let attempt = 0; attempt < 3; attempt++) {
    // `contains` on the JSON text narrows to rows that can hold one of the ids (cuids never collide
    // as substrings of one another once quoted); the exact membership test is parsePulled below.
    const rows = await db.enforcementAction.findMany({
      where: { status: 'active', OR: ids.map((id) => ({ pulledListingIds: { contains: `"${id}"` } })) },
      select: { id: true, pulledListingIds: true },
    })
    let raced = false
    for (const r of rows) {
      const before = parsePulled(r.pulledListingIds)
      const kept = before.filter((id) => !ids.includes(id))
      if (kept.length === before.length) continue
      const { count } = await db.enforcementAction.updateMany({
        where: { id: r.id, status: 'active', pulledListingIds: r.pulledListingIds },
        data: { pulledListingIds: kept.length ? JSON.stringify(kept) : null },
      })
      if (count) forgotten += before.length - kept.length
      else raced = true
    }
    if (!raced) return forgotten
  }
  throw new Error('forgetPulledListings: the hold kept changing under the rewrite')
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
    for (const s of owned) { try { revalidatePublicPath(`/sellers/${s.id}`) } catch { return /* no request scope */ } }
    for (const l of live) { try { revalidatePublicPath(`/listings/${l.id}`) } catch { return } }
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
 * Supersedes any previous active action (status 'lifted'; a HUMAN-PROTECTED one a system
 * escalation sets aside goes to 'superseded' instead — the floor) — silent review FLAGS are
 * NOT actions and survive the transition — executes the effects (held/suspended pull
 * the seller's live listings, recording exactly which — carried forward on escalation,
 * restored on downgrade; suspension records/clears the ban-evasion identity anchors),
 * denormalizes onto Profile, and notifies the seller (bell + push). Fail-quiet:
 * moderation/cron/login callers must never 500 because a side effect hiccupped.
 */
export async function applyEnforcement(
  profileId: string,
  next: EnforcementDecision,
  ctx: {
    decidedBy: string
    triggerReportId?: string | null
    adminNote?: string | null
    onHeld?: (held: number) => void
    /**
     * The snapshot a SYSTEM caller decided on (syncEnforcement). If the state or the active action
     * moved since, the decision is stale and nothing is applied — see the race note below.
     */
    expect?: { state: EnforcementState; activeId: string | null }
    /** This move re-instates a superseded human action (planSystemMove) — retire the floor row. */
    reinstatesFloor?: boolean
    /**
     * The NOTICE key to send instead of the state's own — for a transition whose cause the state
     * alone misdescribes (a scam-hold RELEASE landing in `throttled` is not "under review").
     */
    notice?: string
  },
): Promise<boolean> {
  // A stale-snapshot refusal is the normal answer for a system caller (the next sync re-derives
  // from the fresh state); an admin caller gets the throw, i.e. a non-2xx and a retry.
  const systemCaller = ctx.decidedBy === 'system' || !!ctx.expect
  try {
    const p = await db.profile.findUnique({ where: { id: profileId }, select: { enforcementState: true } })
    if (!p) return false
    const current = normalizeEnforcementState(p.enforcementState)
    if (current === next.state) return false // idempotent — admin double-click / cron re-derive can't stack actions

    const now = new Date()
    const prevActive = await db.enforcementAction.findMany({
      where: { profileId, status: 'active', reason: NOT_FLAGS }, // flags outlive ladder transitions
      select: { id: true, state: true, pulledListingIds: true, decidedBy: true, reason: true },
      orderBy: { createdAt: 'desc' },
    })
    // ⚠️ CHECK-THEN-ACT (review of #20, 2026-09-23). syncEnforcement decides from its OWN earlier
    // read; a ban-evasion hold written between that read and this call used to be superseded as if
    // it were the state the sync had judged — a clean re-derive lifted a human-only hold, and the
    // prior-review check then exempted the account for good. The decision is only valid for the
    // snapshot it was made on.
    if (ctx.expect && (current !== ctx.expect.state || (prevActive[0]?.id ?? null) !== ctx.expect.activeId)) return false
    const nextSev = ENFORCEMENT_SEVERITY[next.state]
    // A SYSTEM ESCALATION sets a human-protected action aside rather than ending it: it becomes the
    // floor a later system downgrade stops at (planSystemMove). Anything else ends what it replaces.
    const escalatingBySystem = ctx.decidedBy === 'system' && !ctx.reinstatesFloor && nextSev > ENFORCEMENT_SEVERITY[current]
    const supersedeIds = escalatingBySystem ? prevActive.filter((a) => isHumanProtected(a)).map((a) => a.id) : []
    const liftIds = prevActive.map((a) => a.id).filter((id) => !supersedeIds.includes(id))
    // A human ruling (any admin decision) or a re-instated floor settles every parked floor: the
    // person has now decided the account's state, so no older hand-set state may resurface.
    const retireFloors = ctx.decidedBy !== 'system' || !!ctx.reinstatesFloor
    // ONE transaction for the whole mutation (audit P2): a throw between the listing
    // pull and the action create used to strand pulled listings with NO recorded
    // action (so no lift could ever restore them) and an unchanged profile state.
    // Path revalidation happens AFTER commit — never inside the txn.
    // ⚖️ SELLER IDENTITY GATE, resolved BEFORE the transaction (it reads Profile and
    // identity_verifications; neither belongs inside a write lock). Only a downgrade below `held`
    // restores anything, and a restore for an owner the gate refuses PARKS the rows (identityHold)
    // instead of publishing them. Gate off → nothing is read and every id is `allowed`.
    const restoring = nextSev < ENFORCEMENT_SEVERITY.held ? prevActive.flatMap((a) => parsePulled(a.pulledListingIds)) : []
    const identityHeld = new Set((await partitionByIdentityGate(restoring)).held)
    const { touched: revalidateIds, parked } = await db.$transaction(async (tx) => {
      const touched: string[] = []
      // Rows the identity gate ACTUALLY parked — the ids the park write itself returned. Not
      // `identityHeld`: that is the decision set, and the park's `status: 'active', verified: false,
      // identityHold: false` guard skips rows sold, hidden or re-approved since the pull, and rows
      // already parked, none of which this restore parked.
      const parked: string[] = []
      // Serialise transitions on the Profile row (this transaction writes it below, so the lock is
      // the one that matters) and re-verify what everything above was decided on. Without it two
      // transitions interleaving — a login's ban-evasion hold and a cron downgrade — each superseded
      // the actions they had read, and the loser's view of "current" was simply wrong.
      const locked = await tx.$queryRaw<{ enforcementState: string | null }[]>`
        SELECT "enforcementState" FROM "Profile" WHERE "id" = ${profileId}::uuid FOR UPDATE
      `
      const activeNow = await tx.enforcementAction.findMany({ where: { profileId, status: 'active', reason: NOT_FLAGS }, select: { id: true } })
      const sameActive = activeNow.length === prevActive.length && activeNow.every((a) => prevActive.some((b) => b.id === a.id))
      if (normalizeEnforcementState(locked[0]?.enforcementState) !== current || !sameActive) throw new EnforcementConflict(profileId)

      if (liftIds.length) {
        await tx.enforcementAction.updateMany({
          where: { id: { in: liftIds } },
          data: { status: 'lifted', liftedAt: now },
        })
      }
      if (supersedeIds.length) {
        await tx.enforcementAction.updateMany({
          where: { id: { in: supersedeIds } },
          data: { status: SUPERSEDED, liftedAt: now },
        })
      }
      if (retireFloors) {
        await tx.enforcementAction.updateMany({
          where: { profileId, status: SUPERSEDED },
          data: { status: 'lifted' },
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
        else {
          const publish = ids.filter((id) => !identityHeld.has(id))
          const park = ids.filter((id) => identityHeld.has(id))
          if (publish.length) await tx.listing.updateMany({ where: { id: { in: publish }, status: 'active', verified: false }, data: { verified: true, identityHold: false } })
          // `identityHold: false` in the guard: a row already parked is not "held by this restore", so it
          // is neither re-written nor counted — the same meaning `held` has in the admin batch.
          if (park.length) parked.push(...(await tx.listing.updateManyAndReturn({ where: { id: { in: park }, status: 'active', verified: false, identityHold: false }, data: { identityHold: true }, select: { id: true } })).map((r) => r.id))
          touched.push(...ids)
        }
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
            // ⚖️ IDENTITY-PARKED ROWS ARE PULLED TOO, and converted: a row the identity gate parked
            // (verified=false, identityHold=true) is not public, but releaseIdentityHolds() would
            // publish it the moment the seller verifies — while this hold is still in force. So it
            // joins the pull list with identityHold cleared, and a lift restores it through
            // restoreListings, which re-applies the identity gate. The drain invariant below still
            // holds: every processed row ends verified=false AND identityHold=false, so it leaves
            // the WHERE. Gate never on → no such rows, and the OR matches exactly what it did.
            for (let pass = 0; pass < 1000; pass++) {
              const live = await tx.listing.findMany({
                where: { sellerId: { in: owned.map((s) => s.id) }, status: 'active', OR: [{ verified: true }, { identityHold: true }] },
                select: { id: true },
                orderBy: { id: 'asc' },
                take: 500,
              })
              if (!live.length) { drained = true; break }
              await tx.listing.updateMany({ where: { id: { in: live.map((l) => l.id) } }, data: { verified: false, identityHold: false } })
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
      return { touched, parked }
    })
    for (const id of revalidateIds) { try { revalidatePublicPath(`/listings/${id}`) } catch { /* no request scope */ } }
    // A downgrade restore the identity gate parked instead of publishing — the admin set-state
    // console reports it; system callers (syncEnforcement) pass no callback and it is logged.
    // AFTER the commit: settleHolds re-checks the owner, closing the window between the decision
    // (read before the transaction) and the park written inside it. Counted from — and re-checked
    // over — exactly the ids the park wrote, as restoreListings does: given the whole decision set,
    // a PRE-EXISTING hold the re-check released was counted as one of ours and could floor the
    // report to 0 while a row this restore parked was still parked.
    const parkedCount = parked.length ? Math.max(0, parked.length - (await settleHolds(parked))) : 0
    if (parkedCount) {
      if (ctx.onHeld) ctx.onHeld(parkedCount)
      else console.warn('[enforcement] downgrade restore parked by identity gate', { profileId, held: parkedCount })
    }

    // Ban-evasion anchors (Phase 3): entering suspension records the account's
    // phone+email; leaving it clears them (covers admin set-state downgrades, which
    // bypass liftAction). Phone is the anchor identity in a phone-verified marketplace.
    if (next.state === 'suspended') await recordBannedIdentity(profileId, next.reason)
    else if (current === 'suspended') await clearBannedIdentity(profileId)

    await revalidateSellerSurfaces(profileId) // ISR caution line (listing/storefront)
    // ⚠️ THE OVERRIDE ONLY SPEAKS FOR A MOVE BELOW `held` (review, 2026-09-24). Its one caller is the
    // scam-hold release, whose words are "your listings are visible again" — true only when this move
    // restores them. A release's re-derive cannot land at held or above today (the release clears the
    // derived hold, and a floor is never above held), but that is an argument across three files; a
    // move that pulls or keeps listings down always gets its own state's notice instead.
    const noticeOverride = ctx.notice && nextSev < ENFORCEMENT_SEVERITY.held ? ctx.notice : undefined
    notifyEnforcement(
      profileId,
      noticeOverride ?? (next.reason === ENFORCEMENT_REASON.INSURANCE_GRACE ? 'grace'
        : next.reason === ENFORCEMENT_REASON.BAN_EVASION_REVIEW ? 'ban_evasion_review'
          : next.reason === ENFORCEMENT_REASON.SCAM_HOLD ? 'scam_hold'
            : next.state),
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
    if (e instanceof EnforcementConflict && systemCaller) {
      console.warn('[enforcement] transition skipped — state moved under a system decision', profileId, next.state)
      return false
    }
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
  opts?: {
    persistedScore?: number
    triggerReportId?: string | null
    /** Rows a downgrade restore PARKED behind the seller identity gate — for an admin caller to show. */
    onHeld?: (held: number) => void
    /** NOTICE key override for the transition this sync applies (applyEnforcement ctx.notice). */
    notice?: string
  },
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
      select: { id: true, decidedBy: true, reason: true, expiresAt: true },
    })
    // Human actions a system escalation set aside — the floor a downgrade stops at.
    const floors = await db.enforcementAction.findMany({
      where: { profileId, status: SUPERSEDED, reason: NOT_FLAGS },
      select: { state: true, reason: true, decidedBy: true, adminNote: true, expiresAt: true },
    })
    const floor = strongestFloor(
      floors.map((f) => ({
        state: normalizeEnforcementState(f.state),
        reason: f.reason,
        decidedBy: f.decidedBy,
        adminNote: f.adminNote,
        expiresAtMs: f.expiresAt?.getTime() ?? null,
      })),
    )
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

    // The active action's REASON rides along: a system-created ban-evasion hold is still
    // human-ended (HUMAN_ONLY_REASONS), so a clean re-derive must not lift it. The floor stops
    // a downgrade at any human action an earlier system escalation set aside.
    const move = planSystemMove({ state: current, decidedBy: active?.decidedBy ?? 'system', reason: active?.reason ?? null }, effective, floor)
    if (!move) return
    await applyEnforcement(profileId, move.decision, {
      decidedBy: move.decidedBy,
      adminNote: move.adminNote,
      reinstatesFloor: move.reinstatesFloor,
      // Decided on THIS snapshot — applyEnforcement refuses if it moved in the meantime.
      expect: { state: current, activeId: active?.id ?? null },
      triggerReportId: opts?.triggerReportId ?? null,
      onHeld: opts?.onHeld,
      notice: opts?.notice,
    })
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
export async function liftAction(actionId: string, opts: { to: 'lifted' | 'overturned'; by: string; onHeld?: (held: number) => void }): Promise<boolean> {
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
    // A lift/overturn is a human ruling that the account is fine — no older hand-set state a
    // system escalation set aside may come back after it (see SUPERSEDED).
    await db.enforcementAction.updateMany({ where: { profileId: action.profileId, status: SUPERSEDED }, data: { status: 'lifted' } })
    const restored = await restoreListings(parsePulled(action.pulledListingIds))
    // The caller (the admin console) reports rows the identity gate parked instead of restoring.
    if (restored.held) opts.onHeld?.(restored.held)
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
    // A timed floor that lapsed while set aside just ends — it never held the Profile state, so
    // nothing else moves (strongestFloor already ignores it; this only tidies the row).
    await db.enforcementAction.updateMany({ where: { status: SUPERSEDED, expiresAt: { lte: new Date() } }, data: { status: 'expired' } })
    // ⚠️ EXPIRY DROPS STRAIGHT TO good_standing AND DOES NOT CONSULT THE HUMAN FLOOR — safe only
    // because no timed action can sit ABOVE a floor: every system `throttled`/`held` decision is
    // untimed (enforcement-machine deriveState/holdForGrace), and the only timed system state,
    // `warned`, can supersede nothing but a good_standing floor. Adding a timed system escalation
    // means routing this through planSystemMove first.
    const due = await db.enforcementAction.findMany({
      where: { status: 'active', expiresAt: { lte: new Date() } },
      select: { id: true, profileId: true, state: true, pulledListingIds: true },
      take: 200,
    })
    if (!due.length) return 0
    await db.enforcementAction.updateMany({ where: { id: { in: due.map((a) => a.id) } }, data: { status: 'expired' } })
    for (const a of due) {
      // rare: a timed hold. Identity-parked rows are logged — a cron has nobody to show a count to.
      const { held } = await restoreListings(parsePulled(a.pulledListingIds))
      if (held) console.warn('[enforcement] expiry restore parked by identity gate', { profileId: a.profileId, held })
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
      select: { id: true, profileId: true, appealedAt: true, appealOutcome: true, decidedBy: true, reason: true },
    })
    if (!action || !action.appealedAt || action.appealOutcome) return false
    await db.enforcementAction.update({ where: { id: actionId }, data: { appealOutcome: 'upheld', appealResolvedAt: new Date() } })
    // Only a SYSTEM-endable action "lifts automatically as your record improves"; an admin's or a
    // ban-evasion review never does (planSystemMove), so it gets the honest copy — and neither does
    // a scam hold, which only a person ends (scamStage), so it gets copy saying how.
    notifyEnforcement(
      action.profileId,
      isHumanProtected(action) ? 'appeal_upheld_manual'
        : action.reason === ENFORCEMENT_REASON.SCAM_HOLD ? 'appeal_upheld_scam'
          : 'appeal_upheld',
    )
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
 * "A human decides" is ENFORCED, not just documented: BAN_EVASION_REVIEW is a
 * HUMAN_ONLY_REASON, so syncEnforcement's daily re-derive can escalate over the hold but
 * never lift it — before that, a clean trust breakdown auto-lifted it within a day and
 * the prior-review check below then exempted the account for good.
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
 * Is this seller exempt from the new-account listing cap? (owner, 2026-08-11)
 *
 * Two kinds of seller are, and both are ACCOUNTS ENO ITSELF VOUCHED FOR:
 *   · an official partner — a company eno has a commercial agreement with and whose
 *     account eno created;
 *   · a verified business — one that passed the two-channel check (tax registry live and
 *     matching, plus an unexpired approval stamped against the CURRENT identity).
 *
 * ⚠️ SELF-DECLARED "business" IS DELIBERATELY NOT ENOUGH, and this is the whole judgement
 * in this function. `Profile.accountType === 'business'` is a free choice in a dropdown at
 * signup — nobody checks it — so exempting it would not narrow the probation cap, it would
 * DELETE it: any spammer selects "business" and posts without limit on day one. The cap
 * exists precisely to make a brand-new account's first 30 days cheap to police. What the
 * tax-registry clause adds is a fact the seller does not control.
 *
 * If the owner does want self-declared businesses exempt too, that is one clause here —
 * but it should be a decision taken knowing it retires the new-account cap in practice.
 */
/**
 * ⚠️ THE PREDICATE MOVED TO `lib/catalogue-seller.ts` AND IS NOW SHARED WITH THE DUPLICATE GUARD.
 * It was inlined here first; the moment a second gate needed the same question ("is this an
 * anonymous account or a registry-backed business?") two copies would have started drifting, and
 * a security predicate that disagrees with itself between two gates is worse than either answer.
 * The doc above still describes the rule — the implementation just lives in one place now.
 */
async function isListingCapExempt(sellerId: string): Promise<boolean> {
  return isVerifiedCatalogueSeller(sellerId)
}

/**
 * Publish gate for POST /api/listings: held/suspended block posting outright;
 * a probation account (<30d AND <3 transactions) is capped at ENFORCEMENT.PROBATION.MAX_ACTIVE_LISTINGS
 * active listings (30 as of 2026-08-11) unless isListingCapExempt() waives it.
 * Error codes are stable JSON the post wizard maps to friendly copy:
 * 'account_held' | 'account_suspended' | { 'probation_listing_cap', limit }.
 *
 * ⚠️ THE EXEMPTION SITS AFTER THE HELD/SUSPENDED CHECK, NEVER BEFORE IT. A partner or a
 * verified business that gets suspended is still suspended — the exemption lifts the
 * NEW-ACCOUNT cap, not enforcement. Putting it first would make a vouched-for account
 * unbannable, which is the opposite of what vouching is for.
 */
export async function postingGate(profileId: string, sellerId: string): Promise<GateError | null> {
  const { state } = await getEnforcement(profileId)
  if (blocksPosting(state)) return { error: state === 'suspended' ? 'account_suspended' : 'account_held' }

  const profile = await db.profile.findUnique({ where: { id: profileId }, select: { createdAt: true } })
  if (!profile) return null
  const ageDays = (Date.now() - profile.createdAt.getTime()) / DAY_MS
  if (ageDays >= ENFORCEMENT.PROBATION.MIN_ACCOUNT_AGE_DAYS) return null
  if (!isProbation(ageDays, await sellerTransactionCount(sellerId))) return null
  if (await isListingCapExempt(sellerId)) return null

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
  // ⚠️ THE SAME EXEMPTION AS postingGate, AND IT HAS TO BE HERE TOO. This function's own
  // docblock exists because the single-post gate is only a preflight — a seller who is exempt
  // at postingGate but not here would be waved through the wizard and then silently truncated
  // by the bulk/sync cores, which is a worse failure than being blocked outright. `null` means
  // uncapped, the same value a non-probation seller gets.
  if (await isListingCapExempt(sellerId)) return { blocked: null, maxNewActive: null }
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
