import 'server-only'
import { after } from 'next/server'
import { db } from './db'
import { getSupabaseAdmin, EVIDENCE_BUCKET } from './supabase-admin'
import { pickLocale } from './admin-macros'
import { sendPushToProfile } from './push'
import { maskEmailHandle } from './utils'

// ── Dispute center core (Binance-P2P-style case rooms on Report) ─────────────────
// Every report IS a dispute case: reporter + respondent + admin exchange statements
// and evidence in one threaded room (DisputeMessage) during an evidence window, then
// an admin decides (with AI assistance) via the existing /api/admin/moderate actions.
// This is the Decree 52/85-required complaint-resolution mechanism — the admin is
// always party to the thread; it is NOT open user-to-user chat (MXH-license safe).
//
// Privacy tiers (established precedent — "the facts, not the filer"):
//  · the RESPONDENT never learns the reporter's identity (role label only)
//  · the REPORTER sees the respondent's public name (storefront / buyer displayName)
//  · admin sees everything; DisputeMessage.senderProfileId null = admin/system rows
//    (the individual admin's identity is never exposed — display "eno.vn moderation").

export const DISPUTE_WINDOW_MS = 72 * 60 * 60 * 1000 // both sides get 72h of evidence
export const DISPUTE_BODY_MAX = 2000
export const DISPUTE_IMAGES_MAX = 6

export type DisputeRole = 'reporter' | 'respondent'

/** The party-facing report projection — one narrow select shared by every gate. */
const PARTY_SELECT = {
  id: true, reason: true, detail: true, severity: true, status: true,
  reporterProfileId: true, targetProfileId: true, targetSellerId: true,
  listingId: true, conversationId: true,
  evidenceUntil: true, lastMessageAt: true, decisionNote: true,
  sellerResponse: true, sellerRespondedAt: true,
  appealNote: true, appealImages: true, appealedAt: true,
  resolvedBy: true, resolvedAt: true, createdAt: true,
} as const

type PartyReport = NonNullable<Awaited<ReturnType<typeof loadPartyReport>>>
async function loadPartyReport(id: string) {
  return db.report.findUnique({ where: { id }, select: PARTY_SELECT })
}

/** Which side of the case is `meId`? Respondent = the reported party: a direct
 *  targetProfileId match OR ownership of the reported storefront. */
export async function partyRoleFor(report: { reporterProfileId: string | null; targetProfileId: string | null; targetSellerId: string | null }, meId: string): Promise<DisputeRole | null> {
  if (report.reporterProfileId === meId) return 'reporter'
  if (report.targetProfileId === meId) return 'respondent'
  if (report.targetSellerId) {
    const seller = await db.seller.findUnique({ where: { id: report.targetSellerId }, select: { ownerId: true } })
    if (seller?.ownerId === meId) return 'respondent'
  }
  return null
}

/** Load a case for one of its two parties. null = not found OR not a party (the
 *  caller 404s both — existence of a case id must not leak to outsiders). */
export async function loadDisputeForParty(id: string, meId: string): Promise<{ report: PartyReport; role: DisputeRole } | null> {
  const report = await loadPartyReport(id)
  if (!report) return null
  const role = await partyRoleFor(report, meId)
  if (!role) return null
  return { report, role }
}

/** Lifecycle stage shown to everyone: evidence window open → under review → decided. */
export function disputeStage(report: { status: string; evidenceUntil: Date | null }): 'evidence' | 'review' | 'decided' {
  if (report.status !== 'open') return 'decided'
  if (report.evidenceUntil && report.evidenceUntil.getTime() > Date.now()) return 'evidence'
  return 'review'
}

/** May this party still post statements/evidence? Open case + window not expired.
 *  (Admins post any time; the window disciplines the PARTIES, Binance-style.) */
export function partyCanPost(report: { status: string; evidenceUntil: Date | null }): boolean {
  return report.status === 'open' && !!report.evidenceUntil && report.evidenceUntil.getTime() > Date.now()
}

/** One-shot evidence rule (anti-spam, 2026-07-07): each side gets EXACTLY ONE
 *  statement (text + photos) in the case room. Once a party has posted their
 *  DisputeMessage, both the message and evidence endpoints reject further posts —
 *  they've had their say, the reviewer decides. Admins are never limited. If a side
 *  never submits, the other side's statement stands and the reviewer decides ex
 *  parte (AI-assisted). Returns true if THIS party already submitted. */
export async function partyHasSubmitted(reportId: string, meId: string): Promise<boolean> {
  const existing = await db.disputeMessage.findFirst({
    where: { reportId, senderProfileId: meId },
    select: { id: true },
  })
  return !!existing
}

/** Evidence paths are pinned to the case's private-bucket folder — a message can
 *  never reference another dispute's files (or anything else in the bucket). */
export function isEvidencePath(path: string, reportId: string): boolean {
  return path.startsWith(`disputes/${reportId}/`) && !path.includes('..') && path.length < 300
}

const parseImages = (raw: string | null | undefined): string[] => {
  try {
    const a = JSON.parse(raw || '[]')
    return Array.isArray(a) ? a.filter((x): x is string => typeof x === 'string') : []
  } catch { return [] }
}

/** Private-bucket paths become signed URLs (default 1h); legacy public URLs
 *  (appealImages pre-date the private bucket) pass through untouched. Batched per
 *  call. `ttl` lets a one-shot render (admin SSR, which never re-signs) buy a longer
 *  window than the polling party page, which re-signs every fetch. */
async function signEvidenceMap(paths: string[], ttl: number): Promise<Map<string, string>> {
  const signed = new Map<string, string>()
  if (paths.length === 0) return signed
  try {
    const { data, error } = await getSupabaseAdmin().storage.from(EVIDENCE_BUCKET).createSignedUrls(paths, ttl)
    if (error) console.error('[dispute] sign urls', error.message)
    for (const row of data ?? []) if (row.path && row.signedUrl) signed.set(row.path, row.signedUrl)
  } catch (e) {
    console.error('[dispute] sign urls', (e as Error).message)
  }
  return signed
}

export async function signEvidenceUrls(images: string[], ttl = 3600): Promise<string[]> {
  const paths = images.filter((i) => !i.startsWith('http'))
  if (paths.length === 0) return images
  const signed = await signEvidenceMap(paths, ttl)
  // A path that failed to sign collapses to '' and is filtered out — the alternative
  // (leaking the raw private path to the client) is worse. The error above tells us why.
  return images.map((i) => (i.startsWith('http') ? i : signed.get(i) ?? '')).filter(Boolean)
}

export type TimelineItem = {
  id: string
  kind: 'message' | 'system' | 'decision'
  role: 'reporter' | 'respondent' | 'admin' | 'system'
  body: string
  images: string[] // signed/public URLs, ready to render
  at: string // ISO
}

/**
 * The unified case timeline: legacy one-shot columns (seller reply, appeal) are
 * synthesized as items so pre-dispute-center cases render complete without any data
 * migration; DisputeMessage rows interleave by timestamp; a decided case closes with
 * a synthesized decision entry (from status + decisionNote — decisions deliberately
 * do NOT write a thread row, so old resolutions render identically to new ones).
 */
export async function disputeTimeline(report: PartyReport, opts: { signTtl?: number } = {}): Promise<TimelineItem[]> {
  const rows = await db.disputeMessage.findMany({
    where: { reportId: report.id },
    orderBy: { createdAt: 'asc' },
    select: { id: true, senderRole: true, body: true, images: true, createdAt: true },
  })

  const items: TimelineItem[] = []
  if (report.detail) {
    items.push({ id: `open-${report.id}`, kind: 'message', role: 'reporter', body: report.detail, images: [], at: report.createdAt.toISOString() })
  }
  if (report.sellerResponse && report.sellerRespondedAt) {
    items.push({ id: `resp-${report.id}`, kind: 'message', role: 'respondent', body: report.sellerResponse, images: [], at: report.sellerRespondedAt.toISOString() })
  }
  if (report.appealNote && report.appealedAt) {
    items.push({
      id: `appeal-${report.id}`, kind: 'message', role: 'respondent', body: report.appealNote,
      images: parseImages(report.appealImages), at: report.appealedAt.toISOString(),
    })
  }
  // ONE signing round-trip for the whole thread (not one per message), then map the
  // signed URLs back per message by path. Failed/unknown paths collapse to '' and are
  // filtered — same no-raw-path-leak rule as signEvidenceUrls.
  const rowImages = rows.map((m) => parseImages(m.images))
  const allPaths = [...new Set(rowImages.flat().filter((i) => !i.startsWith('http')))]
  const signed = await signEvidenceMap(allPaths, opts.signTtl ?? 3600)
  rows.forEach((m, index) => {
    items.push({
      id: m.id,
      kind: m.senderRole === 'system' ? 'system' : 'message',
      role: (['reporter', 'respondent', 'admin', 'system'].includes(m.senderRole) ? m.senderRole : 'system') as TimelineItem['role'],
      body: m.body,
      images: rowImages[index].map((i) => (i.startsWith('http') ? i : signed.get(i) ?? '')).filter(Boolean),
      at: m.createdAt.toISOString(),
    })
  })
  // Push the decision BEFORE sorting so a post-decision admin clarification (which
  // has a later timestamp) still renders after the decision banner, not above it.
  if (report.status !== 'open' && report.resolvedAt) {
    items.push({
      id: `decision-${report.id}`, kind: 'decision', role: 'system',
      body: report.decisionNote || '', images: [], at: report.resolvedAt.toISOString(),
    })
  }
  items.sort((a, b) => a.at.localeCompare(b.at))
  return items
}

// ── Notifications (bilingual, bell type 'dispute' + web push) ─────────────────────
// The bell resolves n.url first, so a 'dispute' row deep-links with zero bell changes.

type Copy = { title: { en: string; vi: string }; body: { en: string; vi: string } }

export const DISPUTE_COPY: Record<string, Copy> = {
  opened_reporter: {
    title: { en: 'Your report opened a dispute case', vi: 'Báo cáo của bạn đã mở hồ sơ khiếu nại' },
    body: {
      en: 'You can add evidence and follow progress. Our team will review and decide.',
      vi: 'Bạn có thể bổ sung bằng chứng và theo dõi tiến trình. Đội ngũ eno.vn sẽ xem xét và quyết định.',
    },
  },
  opened_respondent: {
    title: { en: 'A dispute case concerns you', vi: 'Có hồ sơ khiếu nại liên quan đến bạn' },
    body: {
      en: 'Someone filed a report about your listing or activity. You have 72 hours to respond with your side and evidence.',
      vi: 'Có người báo cáo về tin đăng hoặc hoạt động của bạn. Bạn có 72 giờ để phản hồi kèm bằng chứng.',
    },
  },
  new_message: {
    title: { en: 'New message in your dispute case', vi: 'Tin nhắn mới trong hồ sơ khiếu nại' },
    body: { en: 'Open the case to read and reply.', vi: 'Mở hồ sơ để xem và phản hồi.' },
  },
  window_extended: {
    title: { en: 'Evidence window extended', vi: 'Đã gia hạn thời gian nộp bằng chứng' },
    body: { en: 'The eno.vn team extended the time to submit evidence in your dispute case.', vi: 'Đội ngũ eno.vn đã gia hạn thời gian nộp bằng chứng cho hồ sơ khiếu nại của bạn.' },
  },
  window_closing: {
    title: { en: 'Evidence window closes soon', vi: 'Sắp hết hạn nộp bằng chứng' },
    body: { en: 'Your dispute case closes for evidence in less than 24 hours. Add your side now.', vi: 'Hồ sơ khiếu nại sẽ đóng nhận bằng chứng trong chưa đầy 24 giờ. Hãy bổ sung phản hồi ngay.' },
  },
  decided_upheld_reporter: {
    title: { en: 'Your report was upheld', vi: 'Báo cáo của bạn đã được xác nhận' },
    body: { en: 'We reviewed the case and took action. Thank you for keeping eno.vn safe.', vi: 'Chúng tôi đã xem xét và xử lý. Cảm ơn bạn đã góp phần giữ eno.vn an toàn.' },
  },
  decided_dismissed_reporter: {
    title: { en: 'Your dispute case was closed', vi: 'Hồ sơ khiếu nại của bạn đã đóng' },
    body: { en: 'After review we found no violation. Thanks for looking out — the case is closed.', vi: 'Sau khi xem xét, chúng tôi không thấy vi phạm. Cảm ơn bạn — hồ sơ đã đóng.' },
  },
  decided_abusive_reporter: {
    title: { en: 'Your report was found abusive', vi: 'Báo cáo của bạn bị xác định là sai sự thật' },
    body: { en: 'Our review found this report false or abusive. Repeated false reports restrict your account.', vi: 'Kết quả xem xét cho thấy báo cáo sai sự thật. Báo cáo sai nhiều lần sẽ khiến tài khoản bị hạn chế.' },
  },
  decided_closed_respondent: {
    title: { en: 'Dispute case closed — no action', vi: 'Hồ sơ khiếu nại đã đóng — không xử lý' },
    body: { en: 'A case concerning you was closed with no action against you.', vi: 'Hồ sơ liên quan đến bạn đã đóng và không có xử lý nào đối với bạn.' },
  },
  withdrawn_respondent: {
    title: { en: 'Dispute case withdrawn', vi: 'Hồ sơ khiếu nại đã được rút lại' },
    body: { en: 'The reporter withdrew the case concerning you. No action was taken.', vi: 'Người báo cáo đã rút hồ sơ liên quan đến bạn. Không có xử lý nào.' },
  },
}

/** Bell + push, localized to the recipient. Best-effort — dispute flows must never
 *  fail on notification plumbing. Push rides after() so it never delays the response. */
export async function notifyDispute(profileId: string, reportId: string, copyKey: keyof typeof DISPUTE_COPY): Promise<void> {
  const copy = DISPUTE_COPY[copyKey]
  if (!copy) return
  try {
    const p = await db.profile.findUnique({ where: { id: profileId }, select: { locale: true } })
    const l = pickLocale(p?.locale)
    await db.notification.create({
      data: {
        recipientId: profileId,
        type: 'dispute',
        title: copy.title[l],
        body: copy.body[l],
        actorName: 'eno.vn moderation',
        url: `/disputes/${reportId}`,
      },
    })
    after(() => sendPushToProfile(profileId, { title: copy.title[l], body: copy.body[l], url: `/disputes/${reportId}`, tag: `dispute-${reportId}` }))
  } catch (e) {
    console.error('[dispute] notify', copyKey, (e as Error).message)
  }
}

/** Resolve the respondent's notifiable profile id (null = guest storefront, unreachable —
 *  the case proceeds ex parte exactly like today's guest handling). */
export async function respondentProfileId(report: { targetProfileId: string | null; targetSellerId: string | null }): Promise<string | null> {
  if (report.targetProfileId) return report.targetProfileId
  if (report.targetSellerId) {
    const s = await db.seller.findUnique({ where: { id: report.targetSellerId }, select: { ownerId: true } })
    return s?.ownerId ?? null
  }
  return null
}

/**
 * The single write path for thread rows (insertMessage discipline): create the row,
 * bump Report.lastMessageAt, and notify the OTHER side(s). Admin/system rows notify
 * both parties unless `notify: false` (e.g. a system row that accompanies an event
 * which already sends its own richer notification).
 */
type DisputeReportRef = { id: string; reporterProfileId: string | null; targetProfileId: string | null; targetSellerId: string | null }
type DisputeMsgInput = { senderProfileId: string | null; senderRole: 'reporter' | 'respondent' | 'admin' | 'system'; body: string; images?: string[] }

/** Notify the counterparty/parties of a new dispute message (shared by the admin and
 *  party post paths). Never notifies the sender. Best-effort. */
async function notifyDisputeCounterparties(report: DisputeReportRef, senderRole: DisputeMsgInput['senderRole'], senderProfileId: string | null): Promise<void> {
  const respondent = await respondentProfileId(report)
  const recipients = new Set<string>()
  if (senderRole === 'reporter' && respondent) recipients.add(respondent)
  else if (senderRole === 'respondent' && report.reporterProfileId) recipients.add(report.reporterProfileId)
  else if (senderRole === 'admin' || senderRole === 'system') {
    if (report.reporterProfileId) recipients.add(report.reporterProfileId)
    if (respondent) recipients.add(respondent)
  }
  recipients.delete(senderProfileId ?? '')
  for (const r of recipients) await notifyDispute(r, report.id, 'new_message')
}

export async function addDisputeMessage(
  report: DisputeReportRef,
  msg: DisputeMsgInput,
  opts: { notify?: boolean } = {},
): Promise<{ id: string; createdAt: Date }> {
  const row = await db.disputeMessage.create({
    data: {
      reportId: report.id,
      senderProfileId: msg.senderProfileId,
      senderRole: msg.senderRole,
      body: msg.body,
      images: msg.images && msg.images.length ? JSON.stringify(msg.images.slice(0, DISPUTE_IMAGES_MAX)) : null,
    },
    select: { id: true, createdAt: true },
  })
  await db.report.update({ where: { id: report.id }, data: { lastMessageAt: row.createdAt } }).catch(() => {})
  if (opts.notify !== false) await notifyDisputeCounterparties(report, msg.senderRole, msg.senderProfileId)
  return row
}

/**
 * A PARTY's one-shot statement — atomic under concurrency. A plain check-then-create
 * (partyHasSubmitted → create) races: two simultaneous posts (double-click / scripted
 * burst) both see "no message yet" and both insert, defeating the one-shot rule. A
 * transaction-scoped advisory lock keyed on (reportId, senderProfileId) serializes
 * same-party posts so the re-check inside sees the first row — without a unique index
 * (which would reject the legacy open-thread cases that legitimately have >1 row per
 * party). Returns null if this party already submitted. senderProfileId is required
 * (admins use addDisputeMessage, which is never one-shot).
 */
export async function addPartyStatementOnce(
  report: DisputeReportRef,
  msg: DisputeMsgInput & { senderProfileId: string },
): Promise<{ id: string; createdAt: Date } | null> {
  const lockKey = `dispute-stmt:${report.id}:${msg.senderProfileId}`
  const row = await db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${lockKey}))`
    const exists = await tx.disputeMessage.findFirst({ where: { reportId: report.id, senderProfileId: msg.senderProfileId }, select: { id: true } })
    if (exists) return null
    const created = await tx.disputeMessage.create({
      data: {
        reportId: report.id,
        senderProfileId: msg.senderProfileId,
        senderRole: msg.senderRole,
        body: msg.body,
        images: msg.images && msg.images.length ? JSON.stringify(msg.images.slice(0, DISPUTE_IMAGES_MAX)) : null,
      },
      select: { id: true, createdAt: true },
    })
    await tx.report.update({ where: { id: report.id }, data: { lastMessageAt: created.createdAt } })
    return created
  })
  if (!row) return null
  await notifyDisputeCounterparties(report, msg.senderRole, msg.senderProfileId)
  return row
}

/** Daily-cron sweep: for every open case whose evidence window closes within 24h,
 *  nudge a RESPONDENT who hasn't said anything yet (thread or legacy one-shot reply).
 *  Skips anyone who already got a dispute notification for this case in the last
 *  20h — idempotent on a duplicate cron fire, and an extended window re-nudges at
 *  most once per day. */
export async function sweepDisputeWindows(): Promise<number> {
  const now = Date.now()
  const cases = await db.report.findMany({
    where: { status: 'open', evidenceUntil: { gt: new Date(now), lt: new Date(now + 24 * 3600_000) } },
    select: { id: true, reporterProfileId: true, targetProfileId: true, targetSellerId: true, sellerRespondedAt: true, appealedAt: true },
    take: 200,
  })
  let nudged = 0
  for (const c of cases) {
    // Already engaged: a legacy one-shot reply OR a filed appeal both count as "spoke".
    if (c.sellerRespondedAt || c.appealedAt) continue
    const respondent = await respondentProfileId(c)
    if (!respondent) continue // guest storefront — ex parte, nothing to nudge
    const [spoke, recent] = await Promise.all([
      db.disputeMessage.findFirst({ where: { reportId: c.id, senderProfileId: respondent }, select: { id: true } }),
      db.notification.findFirst({
        where: { recipientId: respondent, type: 'dispute', url: `/disputes/${c.id}`, createdAt: { gt: new Date(now - 20 * 3600_000) } },
        select: { id: true },
      }),
    ])
    if (spoke || recent) continue
    await notifyDispute(respondent, c.id, 'window_closing')
    nudged++
  }
  return nudged
}

/** Party-safe display name for the OTHER side. The respondent's public identity is
 *  what the reporter already saw (storefront name / buyer display name); the
 *  reporter is NEVER identified to the respondent. */
export async function counterpartyName(report: { targetSellerId: string | null; targetProfileId: string | null }): Promise<string | null> {
  if (report.targetSellerId) {
    const s = await db.seller.findUnique({ where: { id: report.targetSellerId }, select: { name: true } })
    if (s?.name) return s.name
  }
  if (report.targetProfileId) {
    const p = await db.profile.findUnique({ where: { id: report.targetProfileId }, select: { displayName: true, email: true } })
    return p?.displayName || maskEmailHandle(p?.email) || null
  }
  return null
}
