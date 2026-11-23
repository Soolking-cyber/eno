import { parseVnPrice, type PriceRefusal } from './vn-price'

/**
 * The arithmetic behind the four rent tools — pure, so the pages' worked examples and the live calculators print the same
 * numbers, and every edge (empty, zero, negative, absurd) is a named error, never NaN or Infinity on screen.
 * ⚠️ Inputs are the reader's own figures; nothing here knows what rent "should" be, and nothing is stored or sent.
 */

/** A monthly amount above this is a typo, not a household budget (10 tỷ đồng a month). */
export const MAX_MONTHLY_VND = 10_000_000_000
/** A one-off amount above this is a typo (100 tỷ đồng). */
export const MAX_ONE_OFF_VND = 100_000_000_000

export type FieldError = 'empty' | 'zero' | 'negative' | 'tooLarge' | 'notNumber' | 'noUnit' | 'ambiguous' | 'notWhole'
export type Field<T> = { ok: true; value: T } | { ok: false; error: FieldError }

const bad = (error: FieldError): { ok: false; error: FieldError } => ({ ok: false, error })

function moneyError(r: PriceRefusal): FieldError {
  switch (r.code) {
    case 'empty': return 'empty'
    case 'zero': return 'zero'
    case 'negative': return 'negative'
    case 'tooLarge': return 'tooLarge'
    case 'noUnit':
    case 'decimalNoUnit': return 'noUnit'
    case 'ambiguousSeparator':
    case 'ambiguousTail':
    case 'ambiguousCurrency': return 'ambiguous'
    default: return 'notNumber'
  }
}

/**
 * An amount of đồng typed into a field: "15000000", "15.000.000", "15,000,000", or the shorthand the converter reads
 * ("15tr", "1,5 tỷ", "800k"). `optional`: an empty field is 0 and so is "0" (a fee nobody charges); otherwise both are errors.
 */
export function readMoney(text: string, opts: { optional?: boolean; max: number }): Field<number> {
  const t = (text ?? '').trim()
  if (!t) return opts.optional ? { ok: true, value: 0 } : bad('empty')
  const r = parseVnPrice(t)
  if (!r.ok) return r.refusal.code === 'zero' && opts.optional ? { ok: true, value: 0 } : bad(moneyError(r.refusal))
  if (r.vnd > opts.max) return bad('tooLarge')
  return { ok: true, value: r.vnd }
}

/** A count of months: a whole number unless `halves` (a deposit of 1,5 months), within [min, max]. */
export function readMonths(text: string, opts: { min: number; max: number; halves?: boolean }): Field<number> {
  const t = (text ?? '').trim()
  if (!t) return bad('empty')
  if (/^[-−]/.test(t)) return bad('negative')
  if (!/^\d+(?:[.,]\d+)?$/.test(t)) return bad('notNumber')
  const v = Number(t.replace(',', '.'))
  if (!Number.isFinite(v)) return bad('notNumber')
  if (opts.halves ? !Number.isInteger(v * 2) : !Number.isInteger(v)) return bad('notWhole')
  if (v === 0 && opts.min > 0) return bad('zero')
  if (v > opts.max) return bad('tooLarge')
  if (v < opts.min) return bad('zero')
  return { ok: true, value: v }
}

/* ── 1. Rent affordability ─────────────────────────────────────────────────────────────────── */

export type Affordability = {
  /**
   * Rent ÷ take-home pay, as a fraction (0.32 = 32%), ROUNDED TO ONE DECIMAL OF A PERCENT — the figure `percent` prints
   * and the one the band is decided from, so 30.01% can never print "30%" beside "Above the 30% rule of thumb".
   */
  share: number
  /** Take-home pay − rent; negative when the rent is more than the pay. */
  left: number
  /** 30% and 40% of the pay — budgeting rules of thumb, not a standard. */
  at30: number
  at40: number
  band: 'upTo30' | 'upTo40' | 'over40' | 'overPay'
}

/** A share rounded to one decimal of a percent (0.30049 → 0.3, 0.3005 → 0.301): what the page prints and judges by. */
export const roundShare = (share: number) => Math.round(share * 1000) / 1000

export function affordability(pay: number, rent: number): Affordability {
  const share = roundShare(rent / pay)
  return {
    share,
    left: pay - rent,
    at30: Math.round(pay * 0.3),
    at40: Math.round(pay * 0.4),
    band: share > 1 ? 'overPay' : share > 0.4 ? 'over40' : share > 0.3 ? 'upTo40' : 'upTo30',
  }
}

/** A share as a percent with at most one decimal, rounded exactly as `roundShare` rounds — never "NaN%". */
export function percent(share: number, locale: 'en' | 'vi'): string {
  if (!Number.isFinite(share)) return ''
  const tenths = Math.round(share * 1000) // the share in tenths of a percent, the same rounding as roundShare
  const digits = tenths % 10 === 0 ? 0 : 1
  return `${new Intl.NumberFormat(locale === 'vi' ? 'vi-VN' : 'en-US', { maximumFractionDigits: digits, minimumFractionDigits: digits }).format(tenths / 10)}%`
}

/* ── 2. Move-in cost ───────────────────────────────────────────────────────────────────────── */

export type MoveInInput = { rent: number; depositMonths: number; advanceMonths: number; agentFee: number; setup: number }
export type MoveIn = {
  deposit: number
  advance: number
  agentFee: number
  setup: number
  /** Cash at signing: deposit + rent paid in advance + agent fee + setup costs. */
  atSigning: number
  /** The rent each month once the months paid in advance run out — the advance is never counted again. */
  monthly: number
  /** The first month whose rent is not already paid at signing (1 when nothing is paid in advance). */
  firstMonthDue: number
}

export function moveInCost(i: MoveInInput): MoveIn {
  const deposit = Math.round(i.rent * i.depositMonths)
  const advance = i.rent * i.advanceMonths
  return {
    deposit,
    advance,
    agentFee: i.agentFee,
    setup: i.setup,
    atSigning: deposit + advance + i.agentFee + i.setup,
    monthly: i.rent,
    firstMonthDue: i.advanceMonths + 1,
  }
}

/* ── 4. Rental cost comparison ─────────────────────────────────────────────────────────────── */

export type RentalOption = { rent: number; deposit: number; fees: number; utilities: number; commute: number }
export type ComparedOption = RentalOption & {
  /** Where the option was in the form (0-based), so a ranked list can still say "Home B". */
  index: number
  /** Rent + monthly fees + utilities + commute. */
  perMonth: number
  /** perMonth × lease months. The deposit is not in it: it is assumed to come back in full. */
  total: number
  /** Deposit + the first month's rent: what has to be paid before moving in. */
  upFront: number
  /** total − the cheapest option's total (0 for the cheapest). */
  overCheapest: number
}

/** Cheapest total first; a tie goes to the smaller sum up front, then to the order the homes were entered in. */
export function compareRentals(options: readonly RentalOption[], months: number): ComparedOption[] {
  const rows = options.map((o, index) => {
    const perMonth = o.rent + o.fees + o.utilities + o.commute
    return { ...o, index, perMonth, total: perMonth * months, upFront: o.deposit + o.rent, overCheapest: 0 }
  })
  rows.sort((a, b) => a.total - b.total || a.upFront - b.upFront || a.index - b.index)
  const cheapest = rows[0]?.total ?? 0
  return rows.map((r) => ({ ...r, overCheapest: r.total - cheapest }))
}
