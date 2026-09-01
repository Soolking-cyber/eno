/**
 * BASE UNITS → A STRING A PERSON CAN READ.
 *
 * ⛔ NO `Number` ANYWHERE ON THIS PATH, AND THAT IS THE ENTIRE REASON THE FILE EXISTS. A token
 * balance arrives as base units in a string — USDC has six decimals, so $10 is `"10000000"` — and
 * the obvious `Number(raw) / 10 ** decimals` is wrong in three separate ways at once: it silently
 * loses precision above 2^53, it reintroduces binary-float error on the division (0.1 + 0.2), and
 * past 1e21 it formats as `1e+21`. Two reviewers named the same trap independently. `BigInt` and
 * string surgery have none of those properties.
 *
 * ⚠️ THIS IS DISPLAY ONLY. Nothing here rounds money for arithmetic — the base-unit string stays
 * the value of record all the way down to order-state.ts, which takes bigint for the same reason.
 */

/**
 * ⛔ REFUSES RATHER THAN GUESSES. A malformed amount from a third party must not render as `0` — a
 * funded user being told they hold nothing is the failure this whole file is about. `null` is the
 * caller's cue to say "we could not read this balance", which is honest, rather than to print a
 * number that is wrong.
 */
export function formatTokenAmount(rawAmount: string, decimals: number): string | null {
  // ⚠️ NEGATIVE DECIMALS AND NON-INTEGERS ARE REFUSED, not clamped. `10 ** -2` and `10 ** 1.5` are
  // both perfectly valid JavaScript and both meaningless as a token scale.
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 36) return null
  const raw = rawAmount.trim()
  // ⚠️ A LEADING `+`, A DECIMAL POINT, `0x…`, `1e6` AND EMPTY ARE ALL REJECTED HERE. `BigInt()`
  // accepts more than this app should: `BigInt("0x10")` is 16 and `BigInt("")` is 0n, so a
  // hex-shaped or empty balance would parse to a confident wrong number rather than fail.
  if (!/^-?\d+$/.test(raw)) return null

  const negative = raw.startsWith('-')
  const digits = negative ? raw.slice(1) : raw

  /**
   * ⛔ `decimals === 0` IS A REAL CASE AND IT USED TO PRODUCE A TRAILING DOT. A zero-decimal token
   * has no fractional part at all, so there is nothing to split off and `"5."` would be the output
   * of the general path. codex named this one specifically.
   */
  if (decimals === 0) {
    const whole = stripLeadingZeros(digits)
    // ⛔ THE NEGATIVE-ZERO NORMALISATION HAS TO BE REPEATED HERE, NOT LEFT TO THE END. Both
    // reviewers found this independently: the early return jumped PAST the `-0` guard below, so
    // `formatTokenAmount('-0', 0)` produced "-0" — a minus sign in front of a zero balance, which
    // reads as a debt. My own test asserted this case at SIX decimals, where the general path
    // normalises it, and passed while the zero-decimal path was broken.
    return whole === '0' ? '0' : (negative ? '-' : '') + whole
  }

  // ⚠️ LEFT-PADDED, because a balance SMALLER than one whole unit is the common case for dust:
  // `"1"` at 6 decimals is 0.000001, and without the pad the split would read it as 1.0.
  const padded = digits.padStart(decimals + 1, '0')
  const whole = stripLeadingZeros(padded.slice(0, padded.length - decimals))
  const fraction = padded.slice(padded.length - decimals).replace(/0+$/, '')

  // ⚠️ AN EXACT ZERO IS `0`, NEVER `-0`. `"-0"` at any scale is still nothing, and a minus sign in
  // front of a zero balance reads as a debt.
  if (whole === '0' && fraction === '') return '0'
  return (negative ? '-' : '') + whole + (fraction ? `.${fraction}` : '')
}

// ⚠️ NEVER RETURNS THE EMPTY STRING. Stripping every zero from `"000"` leaves nothing, and the
// whole part of a balance below one unit is exactly that case.
function stripLeadingZeros(s: string): string {
  const stripped = s.replace(/^0+/, '')
  return stripped === '' ? '0' : stripped
}
