/**
 * WHAT A SENDER MAY HAND THE BOX — validation of POST /api/cron/job-posts (the Mac's Facebook shipper, the box's mailbox
 * reader). Pure. A post that fails is REJECTED with a reason; nothing is ever half-stored.
 *
 * ⛔ LINKS ARE CANONICAL AND ALLOW-LISTED PER SOURCE: a Facebook post's link must be a facebook.com group-post URL, a
 * LinkedIn job's a linkedin.com/jobs/view URL — because the link is the one thing from the outside that reaches a teacher
 * through eno's account (compose.ts never quotes a post).
 * ⛔ CONTACTS ARE MASKED IN THE STORED TEXT: the matcher never needs a phone or an address, and the text is third-party
 * content kept 30 days. Every source is masked here (Facebook text arrives redacted already — masked again). A forwarded
 * post's "Apply:" line is kept as the team member wrote it — it IS the application path, and the mailbox reader takes
 * forwards only from the team's own authenticated mailboxes (infra/vn-node/job-mailbox).
 */
import { fold } from '@/lib/fold'
import { JOB_SOURCES, type JobSource } from './constants'

export const INGEST_LIMITS = { posts: 50, text: 6000, key: 200, short: 200, apply: 200 } as const

export type IngestPost = {
  source: JobSource
  externalKey: string
  sourceName: string
  sourceRef: string | null
  groupPublic: boolean | null
  url: string | null
  applyText: string | null
  title: string | null
  company: string | null
  locationText: string | null
  text: string
  lang: string | null
  postedAt: Date | null
}

export type IngestCheck = { ok: true; post: IngestPost } | { ok: false; key: string; reason: string }

const str = (v: unknown, max: number): string | null => {
  if (typeof v !== 'string') return null
  // control characters out (a NUL breaks Postgres text; others break logs), whitespace kept
  const s = v.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim()
  return s ? s.slice(0, max) : null
}

/**
 * Phone numbers (VN and international), emails and chat links → masked.
 * ⚠️ A Vietnamese salary is dotted like a phone ("30.000.000-40.000.000"): a VN phone starts a number — never inside one —
 * with 0 then a non-zero digit (or +84), measured: the older pattern masked "0.000.000-40" out of that salary (opus, gate 2a).
 */
export function maskContacts(text: string): string {
  return text
    .replace(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, '[email]')
    .replace(/\b(?:https?:\/\/)?(?:zalo\.me|wa\.me|m\.me|t\.me|line\.me|fb\.me)\/\S+/gi, '[link]')
    // "(+84) 901 234 567", "+84 (90) 123 4567" too (codex, gate 2c)
    .replace(/(?<![\d.,])(?:\(?\+?84\)?[\s.-]?|0)\(?[1-9](?:\)?[\s.-]?\d){7,9}\b/g, '[phone]')
    .replace(/(?<![\d.,])\(?\+\d{1,3}\)?(?:\)?[\s.-]?\(?\d){7,12}\b/g, '[phone]')
}

/**
 * A forwarded post's "Apply:" line — the team member's words and the application path, so its contact stays (the
 * teacher needs it). It is refused when it asks for money (codex, gate 2c: it goes out under eno's name), and kept to one
 * plain line; compose.ts screens it for visa words with the rest of the message.
 */
function applyLine(v: unknown): string | null {
  const s = str(v, INGEST_LIMITS.apply)?.replace(/[\r\n]+/g, ' ') ?? null
  if (!s) return null
  // Money in any form — "send 500k cash to secure your place" too (codex, gate 2d).
  // ⚠️ Not "tiền" alone (the name Tiến) nor a bare "12 D…" (an address — opus, gate 3b): money words and amounts only.
  return /\b(fees?|deposits?|pay|payment|transfer|bank|cash|money|phi|dat coc|chuyen khoan|(nop|gui|dong|chuyen) tien)\b|\b\d+ ?(k|tr|trieu|million|vnd|vnđ|dong|usd)\b|\$\s?\d/i.test(fold(s)) ? null : s
}

const FB_POST = /^https:\/\/(www\.|m\.)?facebook\.com\/groups\/[\w.-]+\/(posts|permalink)\/\d+\/?$/
const LI_JOB = /^https:\/\/(www\.)?linkedin\.com\/jobs\/view\/\d+\/?$/

export function checkPost(raw: unknown, now: Date): IngestCheck {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  // A long key is REJECTED, never cut: two keys sharing their first 200 characters would become one post (codex, gate 2a).
  const key = typeof r.externalKey === 'string' && r.externalKey.trim().length <= INGEST_LIMITS.key ? str(r.externalKey, INGEST_LIMITS.key) : null
  const k = key ?? (typeof r.externalKey === 'string' ? r.externalKey.slice(0, 40) : '(no key)')
  const source = r.source as JobSource
  if (!JOB_SOURCES.includes(source)) return { ok: false, key: k, reason: 'source' }
  if (!key || !/^[\w:.@<>/+=-]+$/.test(key)) return { ok: false, key: k, reason: 'externalKey' }
  const sourceName = str(r.sourceName, INGEST_LIMITS.short)
  if (!sourceName) return { ok: false, key: k, reason: 'sourceName' }
  const rawText = typeof r.text === 'string' ? r.text : ''
  if (!rawText.trim()) return { ok: false, key: k, reason: 'text' }
  if (rawText.length > INGEST_LIMITS.text) return { ok: false, key: k, reason: 'text_too_long' }

  let url: string | null = null
  if (r.url !== undefined && r.url !== null) {
    // Rejected, never cut: a cut post URL can still look canonical and open ANOTHER post (opus, gate 2c).
    url = typeof r.url === 'string' && r.url.trim().length <= 500 ? str(r.url, 500) : null
    if (!url) return { ok: false, key: k, reason: 'url' }
    const pattern = source === 'fb' ? FB_POST : source === 'linkedin' ? LI_JOB : null
    if (!pattern || !pattern.test(url)) return { ok: false, key: k, reason: 'url' }
  }

  let postedAt: Date | null = null
  if (r.postedAt !== undefined && r.postedAt !== null) {
    const d = typeof r.postedAt === 'string' ? new Date(r.postedAt) : null
    if (!d || !Number.isFinite(d.getTime())) return { ok: false, key: k, reason: 'postedAt' }
    // Not from the future (a clock skew of a day is allowed) and not older than 60 days (a re-found old post).
    if (d.getTime() > now.getTime() + 86_400_000) return { ok: false, key: k, reason: 'postedAt_future' }
    if (now.getTime() - d.getTime() > 60 * 86_400_000) return { ok: false, key: k, reason: 'postedAt_old' }
    postedAt = d
  }

  // Facebook text arrives redacted (the Mac's redactPII); it is masked again here — this door must not rely on its sender
  // (codex, gate 2a). Text that is all control characters cleans to nothing: rejected, not stored (opus, gate 2a).
  const cleaned = str(rawText, INGEST_LIMITS.text)
  if (!cleaned) return { ok: false, key: k, reason: 'text' }
  const text = maskContacts(cleaned)
  const groupPublic = typeof r.groupPublic === 'boolean' ? r.groupPublic : null
  // ⛔ The short fields a message prints are masked too — a LinkedIn title "GV tiếng Anh – Zalo 0901 234 567", a group
  // named after a phone number (opus, gate 7a). Only the Apply line keeps its contact: it IS the application path.
  // ⛔ MASKED BEFORE IT IS CUT (codex + opus, gate 7a2): cut first, a contact across the 200-character boundary loses its
  // tail and no longer reads as one. Twice the cap is cleaned and masked (a contact across the cut lies wholly inside it),
  // then clipped to the cap.
  const masked = (v: unknown) => { const s = str(v, 2 * INGEST_LIMITS.short); return s ? str(maskContacts(s), INGEST_LIMITS.short) : null }
  return {
    ok: true,
    post: {
      source,
      externalKey: key,
      sourceName: masked(r.sourceName) ?? '—',
      sourceRef: str(r.sourceRef, INGEST_LIMITS.short),
      groupPublic: source === 'fb' ? groupPublic : null,
      url,
      applyText: source === 'intake' ? applyLine(r.applyText) : null,
      title: masked(r.title),
      company: masked(r.company),
      locationText: masked(r.locationText),
      text,
      lang: str(r.lang, 8),
      postedAt,
    },
  }
}
