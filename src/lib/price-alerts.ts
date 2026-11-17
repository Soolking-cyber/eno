import 'server-only'
import type { Prisma } from '@/generated/prisma/client'
import { db } from '@/lib/db'
import { appendAudit } from '@/lib/compliance/audit'
import { PRICE_ALERT_NOTICE_VERSION } from '@/lib/price-drop-rules'

/** Consent record AND state — the hash-chained log (consent/route.ts "no schema change" precedent). PDP Law 91/2025 + Decree 356/2025
 *  Art 6: separate, specific, provable (time = occurredAt, words = detail.notice), withdrawable as easily as given. */
export const PRICE_ALERTS_ON = 'saved.price_alerts.on'
export const PRICE_ALERTS_OFF = 'saved.price_alerts.off'
const ACTIONS = [PRICE_ALERTS_ON, PRICE_ALERTS_OFF]
type Row = { action: string; detail: Prisma.JsonValue } | null
export class PriceAlertNoticeChangedError extends Error { constructor() { super('notice_changed') } }

// ⚠️ BY id, not occurredAt: id is the chain order (assigned under appendAudit's lock); occurredAt is an app clock.
const latest = (c: Pick<Prisma.TransactionClient, 'complianceAudit'>, profileId: string): Promise<Row> =>
  c.complianceAudit.findFirst({ where: { subjectType: 'profile', subjectId: profileId, action: { in: ACTIONS } }, orderBy: { id: 'desc' }, select: { action: true, detail: true } })
export const isOn = (r: Row): boolean => r?.action === PRICE_ALERTS_ON && (r.detail as { notice?: unknown } | null)?.notice === PRICE_ALERT_NOTICE_VERSION
export async function readPriceAlerts(profileId: string): Promise<boolean> { return isOn(await latest(db, profileId)) }

/** ⛔ LOCK FIRST, PER ACCOUNT: read-then-write must be atomic, or an OFF that read before a concurrent ON committed is lost (a
 *  withdrawal dropped). Every ON and OFF of one account takes that account's lock before latest(), so the read sees any ON that
 *  committed first. ⛔ NEVER THE GLOBAL CHAIN KEY here: a no-op (ON over ON, OFF over OFF-or-none) writes nothing and must not
 *  queue behind KYC, takedown, erasure and consent appends; OFFs are not rate-limited. appendAudit takes the chain lock itself,
 *  only when there is a row to write — always account lock, then chain lock, never the reverse (no deadlock). The two-int4 key
 *  is a separate space from the single-bigint hashtext('compliance_audit') lock: they never collide. */
export async function setPriceAlerts(profileId: string, on: boolean, shownNotice: string | null): Promise<boolean> {
  if (on && shownNotice !== PRICE_ALERT_NOTICE_VERSION) throw new PriceAlertNoticeChangedError()
  return db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('lock_timeout', '3000ms', true)`
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('saved.price_alerts'), hashtext(${profileId}))` // per account; appendAudit takes the chain lock only when there is a row to write
    const last = await latest(tx, profileId)
    if (on ? isOn(last) : last?.action !== PRICE_ALERTS_ON) return on // ON over current ON / OFF over OFF-or-none: nothing to record
    await appendAudit(tx, { actorType: 'user', actorId: profileId, action: on ? PRICE_ALERTS_ON : PRICE_ALERTS_OFF, subjectType: 'profile', subjectId: profileId, detail: on ? { notice: PRICE_ALERT_NOTICE_VERSION } : {} })
    return on
  }, { maxWait: 5_000, timeout: 10_000 })
}

/** Savers of this listing whose switch is ON under the current notice, newest save first. Read at send time (an OFF takes effect at once). */
export async function priceAlertSavers(listingId: string, take: number): Promise<string[]> {
  const rows = await db.$queryRaw<{ profileId: string }[]>`
    SELECT s."profileId"::text AS "profileId" FROM "SavedListing" s
    JOIN LATERAL (SELECT a.action, a.detail FROM compliance_audit a
      WHERE a."subjectType" = 'profile' AND a."subjectId" = s."profileId"::text AND a.action IN (${PRICE_ALERTS_ON}, ${PRICE_ALERTS_OFF})
      ORDER BY a.id DESC LIMIT 1) c ON TRUE
    WHERE s."listingId" = ${listingId} AND c.action = ${PRICE_ALERTS_ON} AND c.detail->>'notice' = ${PRICE_ALERT_NOTICE_VERSION}
    ORDER BY s."createdAt" DESC LIMIT ${take}`
  return rows.map((r) => r.profileId)
}
