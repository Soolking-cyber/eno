import { timingSafeEqual } from 'node:crypto'

/**
 * SEPAY — the bank watcher that tells us a VietQR transfer landed.
 *
 * ⛔ THIS IS THE ONLY WAY WE LEARN THAT MONEY ARRIVED. A VietQR payment happens entirely between the
 * buyer and their bank: they scan, they confirm in their own app, and nothing comes back to us.
 * SePay watches the receiving account and POSTs when a transfer appears on the statement. There is
 * no redirect, no polling, no session — if this endpoint is wrong, a paid order stays unpaid.
 *
 * ⛔ AND IT IS AN UNAUTHENTICATED PUBLIC URL UNTIL PROVEN OTHERWISE. Anyone can POST to it. The only
 * thing separating a real notification from someone marking their own order paid is the shared
 * secret checked here — which is why that check is constant-time, why it happens before the body is
 * even parsed, and why an absent secret refuses everything rather than waving it through.
 *
 * ⚠️ PURE. No database, no Prisma, no Next. The route does auth-then-lookup-then-transition; this
 * decides what the payload MEANS, and can be tested against every malformed body without a server.
 */

export type SepayFailure =
  /** No shared secret configured — the endpoint must refuse everything, not accept everything. */
  | 'not_configured'
  /** The caller did not present the shared secret. */
  | 'unauthorised'
  /** The body was not JSON, or not an object. */
  | 'malformed'
  /** A transfer we do not act on — an outgoing payment, or a zero amount. */
  | 'not_incoming'

export type SepayTransfer = {
  /** SePay's own id for this notification. The idempotency key. */
  id: string
  /** The transfer memo — where our payment reference lives. */
  memo: string
  /** Whole dong. VND has no minor units, so this is both the display and the base amount. */
  amountVnd: number
  /** The bank's own transaction reference, for the audit trail. */
  bankRef: string | null
  /** The receiving account, so a transfer into the wrong account is visible. */
  accountNumber: string | null
}

export type SepayResult = { ok: true; transfer: SepayTransfer } | { ok: false; reason: SepayFailure }

/**
 * ⛔ CONSTANT-TIME, BECAUSE THE ALTERNATIVE LEAKS THE SECRET ONE CHARACTER AT A TIME. `a === b` on
 * strings returns as soon as it finds a difference, so an attacker who can time the endpoint learns
 * how many leading characters they got right. This endpoint is public and can be called as often as
 * anyone likes, which is exactly the condition that makes the attack practical.
 * ⚠️ LENGTHS ARE COMPARED FIRST AND SEPARATELY. `timingSafeEqual` THROWS on unequal lengths, so
 * calling it without that guard turns a wrong-length guess into a 500 — a different response, which
 * is itself the leak the function exists to prevent.
 */
function secretMatches(presented: string, expected: string): boolean {
  const a = Buffer.from(presented, 'utf8')
  const b = Buffer.from(expected, 'utf8')
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}

/**
 * ⚠️ NARROWER THAN `SepayResult`, because `authorised` can only ever REFUSE or say nothing — it
 * never produces a transfer. The wider union left the caller unable to read `.reason` without a
 * redundant narrowing: the type describing a shape the function does not have.
 */
export type SepayRefusal = { ok: false; reason: SepayFailure }

/**
 * ⚠️ SePay SENDS `Authorization: Apikey <secret>`. The scheme word is theirs, not ours, and it is
 * matched case-insensitively because HTTP auth schemes are — but the SECRET is compared exactly.
 * ⛔ RETURNS null ON SUCCESS, a refusal otherwise, so a caller that forgets to check gets a value
 * it cannot use rather than a boolean it can accidentally invert.
 */
export function authorised(
  header: string | null | undefined,
  expected: string | undefined,
): SepayRefusal | null {
  if (!expected || !expected.trim()) return { ok: false, reason: 'not_configured' }
  const raw = (header ?? '').trim()
  const m = raw.match(/^apikey\s+(.+)$/i)
  if (!m) return { ok: false, reason: 'unauthorised' }
  return secretMatches(m[1].trim(), expected.trim()) ? null : { ok: false, reason: 'unauthorised' }
}

/**
 * Read a SePay notification body.
 *
 * ⚠️ EVERY FIELD IS TREATED AS ABSENT UNTIL PROVEN OTHERWISE. This is a public endpoint; the body
 * is whatever someone posted. A missing `transferType` must not default to "in", and an amount that
 * arrives as a string must be parsed rather than coerced by `==`.
 */
export function readTransfer(body: unknown): SepayResult {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { ok: false, reason: 'malformed' }
  const b = body as Record<string, unknown>

  /**
   * ⛔ ONLY MONEY COMING IN. SePay reports outgoing transfers on the same endpoint, and treating a
   * payment WE made as a payment we RECEIVED would mark an order paid because a seller was paid out.
   * Absent is refused, not assumed incoming.
   */
  const direction = typeof b.transferType === 'string' ? b.transferType.trim().toLowerCase() : ''
  if (direction !== 'in') return { ok: false, reason: 'not_incoming' }

  const amount = numeric(b.transferAmount)
  // ⚠️ A ZERO OR NEGATIVE "PAYMENT" IS NOT ONE. Whole dong only — VND has no subdivision, and a
  // fractional amount means the field is not what we think it is.
  if (amount === null || !Number.isSafeInteger(amount) || amount <= 0) return { ok: false, reason: 'not_incoming' }

  const id = text(b.id) ?? text(b.referenceCode)
  // ⛔ NO ID, NO IDEMPOTENCY. SePay retries; without a stable id a retry is indistinguishable from a
  // second payment, and the order state machine is the only thing standing between that and a
  // double credit. Refusing here keeps that guarantee at two levels rather than one.
  if (!id) return { ok: false, reason: 'malformed' }

  return {
    ok: true,
    transfer: {
      id,
      // ⚠️ SePay calls the memo `content`. `description` is the human-readable line it also sends;
      // both are checked because the field that carries the reference has moved between their
      // versions, and reading the wrong one means every payment silently fails to match.
      memo: text(b.content) ?? text(b.description) ?? '',
      amountVnd: amount,
      bankRef: text(b.referenceCode),
      accountNumber: text(b.accountNumber),
    },
  }
}

function text(v: unknown): string | null {
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : null
  return typeof v === 'string' && v.trim() ? v.trim() : null
}

/**
 * ⚠️ ACCEPTS A NUMBER OR A NUMERIC STRING, because SePay has sent both, and rejects everything else
 * rather than coercing. `Number('')` is 0 and `Number(null)` is 0 — either would turn a missing
 * amount into a zero-value payment, which the caller then refuses for the wrong reason.
 */
function numeric(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  if (typeof v === 'string' && /^-?\d+(\.\d+)?$/.test(v.trim())) return Number(v.trim())
  return null
}
