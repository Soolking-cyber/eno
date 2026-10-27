/**
 * The dispute room's "evidence window extended" system row. It is STORED in English with an ISO instant — the admin
 * room reads it as written — and the parties' page renders it in their language and local time from the instant
 * (sweep 2026-10-22: both parties saw "Evidence window extended until 2026-10-25T08:13:27.123Z"). Parsing at render
 * also fixes the rows already stored. Client-safe: no server imports.
 */
const PREFIX = 'Evidence window extended until '

export const windowExtendedBody = (until: Date): string => `${PREFIX}${until.toISOString()}`

/** The instant a window-extended row names, or null for any other row. */
export function windowExtendedUntil(body: string | null | undefined): Date | null {
  if (!body?.startsWith(PREFIX)) return null
  const d = new Date(body.slice(PREFIX.length).trim())
  return Number.isNaN(d.getTime()) ? null : d
}
