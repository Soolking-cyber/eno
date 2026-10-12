// Whether a consent answer covers TikTok — the rules src/lib/tiktok-events.ts and src/lib/tiktok-consent-record.ts
// apply on the server. Import-free.

/**
 * The consent card's copy version that first NAMED TikTok in the Advertising question (CONSENT_COPY_VERSION,
 * src/lib/consent-value.ts). ⛔ THE SERVER'S AUTHORITATIVE RULE: TikTok is told about a visitor only when the consent
 * RECORDS of their consent (compliance_audit, written by api/consent with the copy version the card on THEIR screen
 * carried) show Advertising was switched on under this version or later — so a "yes" given to a card that read
 * "Meta, Google" never reaches TikTok, whenever it was given or re-saved: an old tab left open, a cached bundle, a
 * clock that runs ahead, a later save of other switches (commit gate, 2026-10-12).
 * Versions are dates with an optional letter, so they compare as strings.
 */
export const TIKTOK_COPY_VERSION = '2026-10-12'

/**
 * …and a floor under it, in unix SECONDS (the consent cookie's unit, never milliseconds): 2026-10-13 00:00 in Vietnam,
 * the first FULL day the card named TikTok — the day /privacy gives. An answer older than this is never one to the new
 * words, so it is refused without a look at the record. Nobody is asked again: Meta and Google keep working for the
 * answers they had.
 * ⛔ If the deploy that carries TIKTOK_COPY_VERSION slips, move this with it: 00:00 Vietnam time of the day AFTER.
 */
export const TIKTOK_NAMED_FROM_S = Date.UTC(2026, 9, 12, 17, 0, 0) / 1000

/** Advertising on, in an answer no older than the first full day the card named TikTok. `ts` is the answer's own time, in seconds. */
export function consentCoversTikTok(c: { d: boolean; ts: number | null } | null | undefined): boolean {
  return !!c && c.d === true && c.ts !== null && c.ts >= TIKTOK_NAMED_FROM_S
}

/** One `consent.recorded` row of a consent id: its `detail`, and when OUR server wrote it (unix seconds). */
export type ConsentRecordRow = { detail: unknown; recordedAtS: number | null }

/**
 * Do the consent RECORDS of one consent id (every `consent.recorded` row, OLDEST FIRST) show that the answer the
 * browser holds now — the one made at `answeredAt` — has Advertising on BECAUSE the visitor switched it on under a card
 * that named TikTok? All of:
 *   · the newest row is that answer (its `clientTs` is the cookie's) and has Advertising on;
 *   · the row in which Advertising was last SWITCHED ON — from off, or in the visitor's first answer — carried a copy
 *     version that names TikTok (TIKTOK_COPY_VERSION … the one this build shows; never a made-up later one), and
 *     Advertising has stayed on in every row since. ⛔ A "yes" given to "Meta, Google" and merely CARRIED through a
 *     later save of other switches is not a yes to TikTok (commit gate, 2026-10-12: Decree 356 Art 6(3) — no consent
 *     by a pre-set switch);
 *   · OUR server wrote that switching-on row at or after the floor — the day is held on our clock, never the device's.
 * ⛔ FAILS CLOSED: no rows, an unreadable row, another answer's record, or any of the above missing → false.
 */
export function recordsNameTikTok(rows: readonly ConsentRecordRow[], answeredAt: number, currentCopyVersion: string): boolean {
  if (!rows.length) return false
  let switchedOn: { copyVersion: unknown; recordedAtS: number | null } | null = null
  let newest: { d?: unknown; clientTs?: unknown } | null = null
  for (const row of rows) {
    const detail = row.detail
    if (!detail || typeof detail !== 'object' || Array.isArray(detail)) return false
    const d = detail as { d?: unknown; copyVersion?: unknown; clientTs?: unknown }
    if (d.d === true) switchedOn ??= { copyVersion: d.copyVersion, recordedAtS: row.recordedAtS }
    else switchedOn = null
    newest = d
  }
  if (!newest || newest.d !== true || newest.clientTs !== answeredAt || !switchedOn) return false
  const v = switchedOn.copyVersion
  return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}[a-z]?$/.test(v)
    && v >= TIKTOK_COPY_VERSION && v <= currentCopyVersion
    && switchedOn.recordedAtS !== null && switchedOn.recordedAtS >= TIKTOK_NAMED_FROM_S
}
