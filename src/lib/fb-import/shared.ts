import { z } from 'zod'

/**
 * IMPORT FROM FACEBOOK (owner, 2026-11-04). A seller with a connected Facebook taps Import; a worker on the box (scripts/fb-import-worker) finds their
 * profile by name and picture bytes and reads their Marketplace listings; eno sorts them with AI (sort.ts); the seller reviews drafts and publishes.
 *
 * ⛔ WHY A LOGGED-IN BROWSER: Facebook has no API for a person's Marketplace listings. ⛔ NEVER: stealth, proxies, solving a checkpoint, a replacement account, or copying a session to the box (one was locked
 * at once, 2026-11-04: the login is typed in there by a person). A wall stops the worker until a person logs in.
 * ⛔ THE PICTURE MATCH IS NOT PROOF: a copy of a profile photo on another account has the same bytes (measured 2026-11-05). Never present it as ownership: everything lands as a draft, Publish runs the normal
 * gates, and an imported listing never gets someone else's auto-hidden. The owner accepted the rest (2026-11-05).
 */
export const FB_IMPORT_MAX_ITEMS = 100
export const FB_IMPORT_MAX_PHOTOS = 8
export const FB_IMPORT_RETENTION_DAYS = 7
export const FB_IMPORT_LEASE_MINUTES = 20
export const FB_IMPORT_MAX_ATTEMPTS = 3
/** A job nobody could read within a day says so, rather than waiting for ever on a computer that is off. */
export const FB_IMPORT_QUEUE_HOURS = 24

export const ACTIVE_JOB_STATUSES = ['queued', 'reading', 'sorting'] as const

/** Only Facebook's own image hosts: the box fetches these URLs, and the report is a third party's word. */
export function isFacebookPhotoUrl(raw: string): boolean {
  try {
    const u = new URL(raw)
    return u.protocol === 'https:' && !u.username && !u.password && !u.port && (u.hostname.endsWith('.fbcdn.net') || u.hostname === 'fbcdn.net')
  } catch {
    return false
  }
}

const text = (max: number) => z.string().max(max)

export const reportedItem = z.object({
  fbItemId: z.string().regex(/^\d{5,30}$/),
  title: text(300),
  description: text(10_000).nullable(),
  priceAmount: text(32).nullable(),
  currency: text(8).nullable(),
  location: text(300).nullable(),
  condition: text(60).nullable(),
  photos: z.array(z.string().max(2_000).refine(isFacebookPhotoUrl)).max(20),
})
export type ReportedItem = z.infer<typeof reportedItem>

export const workerReport = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('items'), jobId: z.string().max(64), leaseId: z.string().max(64), items: z.array(reportedItem).max(25) }),
  z.object({ kind: z.literal('finished'), jobId: z.string().max(64), leaseId: z.string().max(64) }),
  z.object({ kind: z.literal('not_found'), jobId: z.string().max(64), leaseId: z.string().max(64) }),
  z.object({ kind: z.literal('unavailable'), jobId: z.string().max(64), leaseId: z.string().max(64) }),
  z.object({ kind: z.literal('error'), jobId: z.string().max(64), leaseId: z.string().max(64) }),
])
export type WorkerReport = z.infer<typeof workerReport>

const VND_AMOUNT = /^\d{1,13}(\.\d{1,2})?$/

/** What the model says Facebook's number means. It picks a unit and never writes a price, so a model's guess can only ever be the seller's own digits at another scale. */
export const PRICE_UNITS = ['as_is', 'thousand', 'million', 'unknown'] as const

/**
 * "5000000.00" in VND → 5000000. Anything else has no eno price: the seller types it. Never parseVnd on this: it is digits-only, and "1500.50" would read as 150050.
 * ⚠️ UNDER 1,000đ IS SHORTHAND, NOT A PRICE: real listings say ₫65 for a vending machine and ₫425 (measured 2026-11-05), and guessing which zeros were meant would publish a wrong price. 0 stays: Free is a choice.
 */
export function priceFromUnit(amount: string | null | undefined, currency: string | null | undefined, unit: unknown): number | null {
  // The model read it as a placeholder, or the listing says to ask: whatever the digits are, they aren't a price to tick and publish.
  if (unit === 'unknown') return null
  const scale = unit === 'million' ? { factor: 1_000_000, below: 1_000 } : unit === 'thousand' ? { factor: 1_000, below: 100_000 } : null
  if (!scale || currency !== 'VND' || !amount || !VND_AMOUNT.test(amount)) return vndFromFacebook(amount, currency)
  const n = Number(amount)
  // Only what can be shorthand: 500000 "in millions" would be a 500-billion listing, ticked and ready to publish.
  if (n >= scale.below) return vndFromFacebook(amount, currency)
  // Scaled before rounding: 1.5 million is 1,500,000, not 2,000,000.
  const price = Math.round(n * scale.factor)
  return price >= 1000 ? price : null
}

export function vndFromFacebook(amount: string | null | undefined, currency: string | null | undefined): number | null {
  if (currency !== 'VND' || !amount || !VND_AMOUNT.test(amount)) return null
  const n = Math.round(Number(amount))
  if (n > 0 && n < 1000) return null
  return Number.isSafeInteger(n) && n <= 1e12 ? n : null
}
