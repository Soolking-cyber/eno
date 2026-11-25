import { CALL_DONE_LINE, CALL_FAILED_LINE, CALL_MISSED_LINE, CALL_REQUEST_TEXT, MISSED_TEXT } from './calls/card-text'
import { OFFER_ACCEPTED_LINE, OFFER_DECLINED_LINE, OFFER_MADE_LINE } from './offer-lines'
import { PARTNER_BUY_LINE, PARTNER_BUY_WELCOME_LINE, PARTNER_WELCOME_LINE } from './partner-welcome-line'
import { TEACHER_JOBS_BODY, TEACHER_MESSAGE_BODY, composite } from './teachers/alert-copy'
import {
  TEACHER_SHARED_LINE, TEACHER_SHARED_PHONE_LINE, TEACHER_SHARE_STOPPED_LINE, TEACHER_VIDEO_ASK_LINE, TEACHER_VIDEO_SENT_LINE,
  TEACHER_VIDEO_STOPPED_LINE,
} from './teachers/thread-lines'

/**
 * THE SYSTEM LINES — the chat, bell and push lines eno's server writes, stored "VI · EN" — and the reader's half of one.
 * Split from src/lib/chat-phrases.ts (which adds the one-tap phrases and the opener tables) so the header's bell, on every
 * page, loads only these few lines (commit gate, 2026-11-25). The rules are chat-phrases.ts's. CLIENT-SAFE, no db.
 */

type SystemLine = { mark: string; vi: string; en: string; stored: string }

/** `${mark} ${vi} · ${en}` (mark optional) → its parts, or a pair whose halves hold a " · " of their own. A line not in
 *  that shape is left out (and logged) — never a throw: this module loads with the header's bell on every page. */
function systemLine(stored: string | { vi: string; en: string }): SystemLine | null {
  if (typeof stored !== 'string') return { mark: '', vi: stored.vi, en: stored.en, stored: composite(stored) }
  const m = /^(?:(\p{Extended_Pictographic}️?) )?([\s\S]+?) · ([\s\S]+)$/u.exec(stored)
  if (!m) { console.error('[chat-phrases] not a "VI · EN" line, left out:', stored); return null }
  return { mark: m[1] ?? '', vi: m[2], en: m[3], stored }
}

/** The stored system lines, longest first, so a line that opens another (none today) can never steal its match. */
export const SYSTEM_LINES: readonly SystemLine[] = [
  PARTNER_WELCOME_LINE, PARTNER_BUY_WELCOME_LINE, PARTNER_BUY_LINE,
  OFFER_ACCEPTED_LINE, OFFER_DECLINED_LINE, OFFER_MADE_LINE,
  CALL_DONE_LINE, CALL_MISSED_LINE, CALL_FAILED_LINE, CALL_REQUEST_TEXT,
  TEACHER_SHARED_PHONE_LINE, TEACHER_SHARED_LINE, TEACHER_SHARE_STOPPED_LINE, TEACHER_VIDEO_SENT_LINE, TEACHER_VIDEO_STOPPED_LINE,
  TEACHER_VIDEO_ASK_LINE,
  // The bell's rows (notification-bell.tsx): the missed call and the teacher alerts' bodies.
  MISSED_TEXT, TEACHER_MESSAGE_BODY, TEACHER_JOBS_BODY,
].map(systemLine).filter((l): l is SystemLine => l !== null).sort((a, b) => b.stored.length - a.stored.length)

export const half = (p: { vi: string; en: string }, lang: string) => (lang === 'vi' ? p.vi : p.en)
export const TWO_LANGS = new Set(['vi', 'en'])
const head = (l: SystemLine, lang: string) => `${l.mark ? `${l.mark} ` : ''}${half(l, lang)}`

/** eno's own words after a system line: an amount (" — 3,000,000 đ", " 2.000.000 ₫") or a call's length (" · 3:12"). */
// The space before đ/₫ may be a no-break one (Intl formatting).
const ENO_TAIL = /^(?: — | )\d{1,3}(?:[.,]\d{3})*[ \u00a0\u202f][đ₫]$|^ · \d+(?::\d{2}){1,2}$/

/** The system lines alone — for the sender's OWN bubble, where a one-tap phrase stays exactly as they sent it. */
export function localizeSystemLine(text: string, lang: string): string | null {
  if (!TWO_LANGS.has(lang)) return null
  for (const l of SYSTEM_LINES) {
    if (text === l.stored) return head(l, lang)
    if (text.startsWith(l.stored) && ENO_TAIL.test(text.slice(l.stored.length))) return `${head(l, lang)}${text.slice(l.stored.length)}`
  }
  return null
}

/**
 * A system line's HEAD in the reader's half, with whatever follows it — a person's note included — left exactly as
 * written. ONLY for text that is never machine-translated anyway (the bell's offer rows, a push); never to decide what
 * a thread sends to translation (that is localizeChatText's strict match).
 */
export function localizeLineHead(text: string, lang: string): string | null {
  if (!TWO_LANGS.has(lang)) return null
  for (const l of SYSTEM_LINES) if (text === l.stored || text.startsWith(`${l.stored} `)) return `${head(l, lang)}${text.slice(l.stored.length)}`
  return null
}

/** A stored "VI · EN" line as its two halves, each with the line's mark — for a push, which goes in one language. */
export function halvesOf(stored: string): { vi: string; en: string } {
  const l = systemLine(stored)
  if (!l) return { vi: stored, en: stored } // not a "VI · EN" line: sent as written, never a throw
  const m = l.mark ? `${l.mark} ` : ''
  return { vi: `${m}${l.vi}`, en: `${m}${l.en}` }
}
