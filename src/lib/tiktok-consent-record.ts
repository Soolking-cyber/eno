import 'server-only'
import { db } from '@/lib/db'
import { CONSENT_COPY_VERSION, CONSENT_V2_KEY, cookieFromHeader, parseConsentV2 } from '@/lib/consent-value'
import { logError } from '@/lib/log'
import { recordsNameTikTok } from '@/lib/tiktok-consent'

/**
 * Was the Advertising answer this request carries SWITCHED ON under a consent card that named TikTok? Read from the
 * consent records themselves — every `consent.recorded` row of the cookie's consent id (api/consent writes one per
 * answer, with the copy version the card on that screen carried) — never inferred from a date alone, and never from
 * the newest row alone: a "yes" carried through a later save is not a new yes (recordsNameTikTok).
 * ⛔ FAILS CLOSED: no cookie, no rows (a record the rate limit dropped, a local run — only the live sites write one),
 * or rows that do not show it → false. It may throw (the database): the caller contains it.
 * ⛔ BOUNDED: it is asked BEFORE a teacher's save, so a slow log may delay a first publish by RECORD_WAIT_MS at most —
 * past it the answer is false (TikTok is told nothing, and it is logged) and the save goes on (commit gate, 2026-10-12).
 * The lookup rides the log's (subjectType, subjectId, occurredAt) index: a handful of rows per consent id, the newest
 * RECORD_ROWS_MAX of them (someone who answered more often than that is simply not reported).
 * `occurredAt` is OUR clock, and the day TikTok may first be told is held on it.
 */
export async function consentRecordNamesTikTok(headers: Headers): Promise<boolean> {
  const stored = parseConsentV2(cookieFromHeader(headers.get('cookie'), CONSENT_V2_KEY))
  if (!stored) return false
  let timer: ReturnType<typeof setTimeout> | undefined
  const late = new Promise<typeof LATE>((resolve) => { timer = setTimeout(() => resolve(LATE), RECORD_WAIT_MS) })
  try {
    const rows = await Promise.race([
      db.complianceAudit.findMany({
        where: { subjectType: 'consent', subjectId: stored.cid, action: 'consent.recorded' },
        orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
        take: RECORD_ROWS_MAX + 1,
        select: { detail: true, occurredAt: true },
      }),
      late,
    ])
    if (rows === LATE) {
      // Not silent: a log that keeps timing out would otherwise mean TikTok is never told, with nothing to show why.
      logError(new Error(`consent record lookup exceeded ${RECORD_WAIT_MS} ms`), { op: 'tiktok.consentRecord.timeout' })
      return false
    }
    if (rows.length > RECORD_ROWS_MAX) return false // the history is cut off: the switching-on row cannot be told
    const oldestFirst = [...rows].reverse().map((row) => ({
      detail: row.detail,
      recordedAtS: row.occurredAt instanceof Date ? Math.floor(row.occurredAt.getTime() / 1000) : null,
    }))
    return recordsNameTikTok(oldestFirst, stored.ts, CONSENT_COPY_VERSION)
  } finally {
    clearTimeout(timer)
  }
}
const LATE = Symbol('late')
export const RECORD_WAIT_MS = 800
export const RECORD_ROWS_MAX = 100
