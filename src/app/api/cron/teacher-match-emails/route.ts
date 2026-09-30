import { route } from '@/lib/api/handler'
import { db } from '@/lib/db'
import { sendMail, mailEnabled } from '@/lib/mail'
import { mintUnsubscribeToken } from '@/lib/unsubscribe-token'
import { renderTeacherMatches, type TeacherMatchJob } from '@/lib/emails/teacher-matches'
import { IS_MARKETPLACE, SITE_NAME } from '@/lib/edition'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 300

/**
 * Daily: email each opted-in teacher the NEW jobs the local matcher found for them (2026-09-30).
 *
 * ⛔ SEQUENTIAL AND PACED, NOT A FAN-OUT. Resend allows 10 requests/second; the weekly digest's
 * 20-wide Promise.all is exactly how half of it failed (memory: weekly digest, 2026-09). ~7/s here.
 * ⛔ ONE EMAIL PER TEACHER PER 3 DAYS, AT MOST 5 JOBS — a match email that arrives every morning is
 * spam, however good the matches. Only matches from the last 14 days (a job's own lifetime).
 * A pair is marked `emailedAt` only after its email was accepted, so a failed send retries tomorrow.
 * Only teachers who ticked "email me matching jobs" (matchEmailOptIn, default OFF) are ever mailed.
 */
const ORIGIN = process.env.NEXT_PUBLIC_APP_URL || `https://${SITE_NAME}`
const MAX_TEACHERS = 300
const PER_EMAIL = 5
const GAP_MS = 150
const COOLDOWN_MS = 3 * 86400_000
const FRESH_MS = 14 * 86400_000
const VISA_WORD = /(^|[^a-z])(e-?)?visas?([^a-z]|$)|work permit|thị thực|thi thuc|giấy phép lao động|giay phep lao dong|thẻ tạm trú|the tam tru/i

export const GET = route({ auth: 'cron' }, async () => {
  // ⛔ ONE SENDER: teachers sign up on eno.vn (teacher.eno.vn), and both editions share the database —
  // two timers would race for the same rows and brand the email by whichever won (Opus, gate 09-30).
  if (!IS_MARKETPLACE) return { ok: true, skipped: 'marketplace_only' }
  if (!mailEnabled()) return { ok: true, mail: 'disabled' }
  const now = Date.now()
  // Teachers mailed in the last 3 days are left out BEFORE the slice, so they cannot crowd everyone
  // else out of the run (agy, commit gate 09-30).
  const cooling = new Set((await db.teacherJobMatch.findMany({
    where: { emailedAt: { gt: new Date(now - COOLDOWN_MS) }, teacherProfileId: { not: null } },
    select: { teacherProfileId: true }, distinct: ['teacherProfileId'],
  })).map((r) => r.teacherProfileId))
  const pending = await db.teacherJobMatch.findMany({
    where: {
      decision: 'match', emailedAt: null, createdAt: { gt: new Date(now - FRESH_MS) },
      teacherProfileId: { notIn: [...cooling].filter((x): x is string => !!x) },
      // The teacher's own listing must still be live too — a profile moderation pulled is not mailed.
      teacherProfile: { matchEmailOptIn: true, status: 'live', listing: { status: 'active', verified: true } },
      listing: { status: 'active', verified: true },
    },
    select: {
      id: true, score: true, reasons: true, teacherProfileId: true,
      listing: { select: { id: true, title: true, city: true, affiliateUrl: true, attributes: true } },
    },
    orderBy: { score: 'desc' },
    take: 5000,
  })
  const byTeacher = new Map<string, typeof pending>()
  for (const m of pending) {
    if (!m.teacherProfileId) continue
    // Visa-worded jobs are dropped BEFORE the five-job cap, or they would crowd out clean matches forever.
    if (VISA_WORD.test(`${m.listing.title} ${m.listing.attributes ?? ''}`)) continue
    const list = byTeacher.get(m.teacherProfileId) ?? []
    if (list.length < PER_EMAIL) list.push(m)
    byTeacher.set(m.teacherProfileId, list)
  }
  const teacherIds = [...byTeacher.keys()].slice(0, MAX_TEACHERS)
  const teachers = await db.teacherProfile.findMany({
    where: { id: { in: teacherIds } },
    select: { id: true, fullName: true, profileId: true, private: { select: { email: true } }, profile: { select: { email: true } } },
  })

  let sent = 0, failed = 0, skipped = 0
  for (const t of teachers) {
    const to = t.private?.email || t.profile.email
    if (!to) { skipped++; continue }
    // Minted BEFORE the claim below, so a missing token can never leave rows claimed-but-unsent.
    const token = mintUnsubscribeToken(t.profileId)
    if (!token) { skipped++; continue }
    // ⛔ CLAIM BEFORE SENDING: only rows this run flips from null are mailed, so a second run at the
    // same moment (a manual trigger, the other edition's timer — one database) finds nothing to send.
    const candidates = byTeacher.get(t.id) ?? []
    if (!candidates.length) { skipped++; continue }
    const claimAt = new Date()
    const claimed = await db.teacherJobMatch.updateMany({ where: { id: { in: candidates.map((m) => m.id) }, emailedAt: null }, data: { emailedAt: claimAt } })
    if (claimed.count !== candidates.length) {
      // Someone else got there (fully or partly): release ours and leave this teacher to them.
      await db.teacherJobMatch.updateMany({ where: { id: { in: candidates.map((m) => m.id) }, emailedAt: claimAt }, data: { emailedAt: null } })
      skipped++; continue
    }
    const matches = candidates
    const jobs: TeacherMatchJob[] = matches.map((m) => {
      const attrs = (() => { try { return JSON.parse(m.listing.attributes ?? '{}') as Record<string, unknown> } catch { return {} } })()
      return {
        title: m.listing.title, city: m.listing.city, pay: typeof attrs.salaryText === 'string' ? attrs.salaryText : null,
        url: `${ORIGIN}/listings/${m.listing.id}`, applyAtSource: !!m.listing.affiliateUrl,
        // ⛔ Filtered HERE, not trusted from the matcher: the licensed edition emails no visa wording.
        reasons: (Array.isArray(m.reasons) ? m.reasons : []).map(String).filter((r) => !VISA_WORD.test(r)).slice(0, 2),
      }
    })
    const unsubscribeUrl = `${ORIGIN}/unsubscribe?token=${encodeURIComponent(token)}&list=teacher-matches`
    const { subject, html, text } = renderTeacherMatches({ jobs, origin: ORIGIN, unsubscribeUrl, recipientName: t.fullName, siteName: SITE_NAME })
    const ok = await sendMail({
      to, subject, html, text,
      headers: {
        'List-Unsubscribe': `<${ORIGIN}/api/unsubscribe?token=${encodeURIComponent(token)}&list=teacher-matches>`,
        'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
      },
    })
    if (ok) sent++
    else {
      failed++
      // Not accepted: release the claim so tomorrow's run tries again.
      await db.teacherJobMatch.updateMany({ where: { id: { in: matches.map((m) => m.id) }, emailedAt: claimAt }, data: { emailedAt: null } })
    }
    await new Promise((r) => setTimeout(r, GAP_MS))
  }
  return { ok: true, teachers: teachers.length, sent, failed, skipped }
})
