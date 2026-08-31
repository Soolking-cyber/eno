/**
 * THE PAYMENT REFERENCE — the string that ties a bank transfer to an order.
 *
 * ⛔ THIS IS THE WHOLE RECONCILIATION MECHANISM FOR VIETQR, AND IT IS ONE SHORT STRING. A buyer
 * scans a QR, their banking app pre-fills a memo, and some seconds later a webhook arrives saying
 * "540,000 VND landed, memo `ENO7X2K9M`". Nothing else connects the two: no session, no callback
 * URL, no return trip through our site. If the reference collides, is mangled, or is matched
 * loosely, money lands against the wrong order — and unlike a card payment there is no gateway to
 * ask, only a bank statement.
 *
 * ⚠️ SO IT IS DESIGNED AROUND WHAT A BANK WILL DO TO IT, not around what looks tidy. It must
 * survive uppercasing, survive a 25-character truncation with room to spare, contain no characters
 * a Vietnamese banking app might strip, and be impossible to confuse with a neighbouring reference
 * after a single mistyped or dropped character.
 */

/**
 * ⛔ CROCKFORD BASE32, WHICH EXCLUDES I, L, O AND U ON PURPOSE. `I`/`1`, `O`/`0` and `L`/`1` are the
 * pairs a human reads wrong off a phone screen, and a buyer editing a memo by hand is an ordinary
 * event — some banking apps do not carry the pre-filled text through every screen. `U` is excluded
 * by the standard to avoid accidental profanity. What is left cannot produce an ambiguous glyph.
 */
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'

/** The fixed prefix, so a memo is recognisably ours on a bank statement a human is reading. */
export const REFERENCE_PREFIX = 'ENO'

/**
 * ⚠️ NINE RANDOM CHARACTERS ≈ 45 BITS. At a million orders that is a collision probability around
 * one in a hundred thousand — and the database has a UNIQUE constraint underneath, so a collision
 * is a failed insert and a retry rather than two orders sharing a reference. The length is chosen
 * against the 25-character memo ceiling: `ENO` + 9 leaves ample room, so nothing a bank does to the
 * tail can eat the reference.
 */
const RANDOM_CHARS = 9

/**
 * A fresh payment reference.
 *
 * ⚠️ `crypto.getRandomValues`, NOT `Math.random`. Not because a reference is a secret — it is
 * printed on a QR — but because a predictable sequence lets someone watch for the NEXT one and pay
 * against an order that is not theirs.
 * ⚠️ MASKED, NOT TAKEN MODULO. 256 is exactly 8 × 32, so `byte & 0x1f` is uniform and no rejection
 * is needed — but `% 32` would be too, and only by luck: change the alphabet to 31 symbols and the
 * modulo silently favours the first ones while the mask breaks loudly. The mask is the version that
 * cannot rot quietly.
 */
export function newReference(): string {
  let out = ''
  const buf = new Uint8Array(1)
  while (out.length < RANDOM_CHARS) {
    crypto.getRandomValues(buf)
    out += ALPHABET[buf[0] & 0x1f]
  }
  return REFERENCE_PREFIX + out
}

/**
 * ⛔ THE SAME NORMALISATION ON BOTH SIDES OF THE MATCH, WHICH IS THE ENTIRE POINT OF THIS FUNCTION.
 * A memo comes back from a bank uppercased, or lowercased, or with the spaces collapsed, or with
 * `Chuyen tien` prepended — and the reference we stored was generated here. Comparing raw strings
 * would fail on any of those; comparing normalised ones cannot.
 * ⛔ IT KEEPS SPACES, AND THE FIRST VERSION DID NOT — WHICH WAS A REAL BUG THIS FILE'S OWN TEST
 * CAUGHT. Stripping them looked harmless (a bank inserting or removing one means nothing) but it
 * destroys the only BOUNDARY a reference has: with spaces gone, `ENO7X2K9MQ4Z` is a substring of
 * the longer `ENO7X2K9MQ4ZY`, so a neighbouring order's reference would have taken the payment.
 * ⚠️ THE TRADE IS DELIBERATE AND ONE-WAY. Keeping spaces means a bank that DELETES one causes a
 * failure to match; stripping them means a wrong match. Unattributed money waits for an operator;
 * money paid to the wrong seller does not come back.
 */
export function normaliseForMatch(raw: string | null | undefined): string {
  return (raw ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, ' ')
    .trim()
}

/** A reference is well-formed if it is our prefix followed by exactly nine alphabet characters. */
export function isReference(candidate: string): boolean {
  return new RegExp(`^${REFERENCE_PREFIX}[${ALPHABET}]{${RANDOM_CHARS}}$`).test(candidate)
}

/**
 * Find our reference inside whatever the bank sent.
 *
 * ⛔ EXTRACTION, NOT `includes()`, AND THE DIFFERENCE IS MONEY. A memo often carries the bank's own
 * decoration — `CHUYEN TIEN ENO7X2K9M GD 123456` — so the reference has to be located rather than
 * compared. But a substring search for a STORED reference would also match a LONGER one that
 * contains it, and pulling the reference out of the memo and comparing whole strings is the only
 * shape that cannot.
 *
 * ⚠️ AND IT RETURNS null WHEN THERE ARE TWO. A memo naming several references is not a payment we
 * can attribute — it is a human doing something unusual, and guessing which order they meant is
 * precisely the guess that must never be automated. Better an operator looks at it.
 */
export function extractReference(memo: string | null | undefined): string | null {
  const found = findReferences(memo)
  if (!found.length) return null
  const unique = [...new Set(found)]
  return unique.length === 1 ? unique[0] : null
}

/**
 * ⛔ BOUNDED ON BOTH SIDES, WHICH IS WHY THIS IS ONE FUNCTION RATHER THAN AN INLINE REGEX IN TWO
 * PLACES. The lookarounds are what stop `ENO7X2K9MQ4Z` matching inside `ENO7X2K9MQ4ZY` — a longer
 * reference that merely starts with ours. They only work because `normaliseForMatch` KEEPS spaces;
 * the two decisions are a pair and neither survives alone.
 */
function findReferences(memo: string | null | undefined): string[] {
  const flat = normaliseForMatch(memo)
  const re = new RegExp(`(?<![A-Z0-9])${REFERENCE_PREFIX}[${ALPHABET}]{${RANDOM_CHARS}}(?![A-Z0-9])`, 'g')
  return flat.match(re) ?? []
}

export type MatchFailure =
  /** No reference of ours anywhere in the memo. */
  | 'no_reference'
  /** More than one distinct reference — ambiguous, needs a human. */
  | 'ambiguous_reference'
  /** A reference we do not know. Someone typed it, or it belongs to another environment. */
  | 'unknown_reference'
  /** The right order, the wrong money. */
  | 'amount_mismatch'

export type OrderForMatch = {
  reference: string
  /** Minor units of `currency`. For VND that is whole dong. */
  amount: number | bigint
  currency: 'USD' | 'VND'
}

/**
 * Does this incoming transfer belong to this order, for this amount?
 *
 * ⛔ PURE, AND SEPARATE FROM THE WEBHOOK ROUTE ON PURPOSE. Deciding whether money belongs to an
 * order is the one judgement in this system that must be examinable without a network, a signature
 * or a database. The route's job is to authenticate the sender and look up the order; this decides.
 *
 * ⛔ EXACT AMOUNT, NO TOLERANCE. It is tempting to accept "close enough" — a buyer rounding, a bank
 * fee — but a marketplace that accepts an underpayment has silently discounted the seller's item,
 * and one that accepts an overpayment owes change it has no mechanism to return. Both are decided
 * by a human. VND has no minor units, so there is not even a rounding argument.
 */
export function matchesOrder(
  order: OrderForMatch,
  incoming: { memo: string | null | undefined; amount: number | bigint; currency: string },
): { ok: true } | { ok: false; reason: MatchFailure } {
  const found = findReferences(incoming.memo)
  if (!found.length) return { ok: false, reason: 'no_reference' }
  if (new Set(found).size > 1) return { ok: false, reason: 'ambiguous_reference' }
  if (found[0] !== normaliseForMatch(order.reference)) return { ok: false, reason: 'unknown_reference' }

  /**
   * ⚠️ COMPARED AS BIGINT, because `Order.amount` is int8 and Prisma hands back a bigint while a
   * webhook body carries a number. `1000n === 1000` is false and `Number(bigint)` loses precision
   * above 2^53 — converting both to BigInt is the only comparison that is right at every size.
   */
  const want = BigInt(order.amount)
  let got: bigint
  try {
    got = BigInt(incoming.amount)
  } catch {
    return { ok: false, reason: 'amount_mismatch' }
  }
  if (want !== got) return { ok: false, reason: 'amount_mismatch' }
  if (incoming.currency.trim().toUpperCase() !== order.currency) return { ok: false, reason: 'amount_mismatch' }
  return { ok: true }
}
