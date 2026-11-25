/**
 * ── AN AD BOUGHT BY BANK TRANSFER: THE THREE PERIODS (owner 2026-11-25: "our acb bank account deposit via qr minimal weekly
 * monthly quarterly ad options"). Pure and client-safe: the dashboard form prints these prices, the server sells at them
 * (bank.ts), the offer and the advertising policy state them — one table, so no surface can quote another price.
 * A period is whole days: a month is 30 days and a quarter 90 (2,160 hours, x402/config.ts AD_MAX_HOURS).
 */
export const BANK_PERIODS = ['week', 'month', 'quarter'] as const
export type BankPeriod = (typeof BANK_PERIODS)[number]

export const BANK_PERIOD: Readonly<Record<BankPeriod, { days: number; priceVnd: number }>> = {
  week: { days: 7, priceVnd: 99_000 },
  month: { days: 30, priceVnd: 349_000 },
  quarter: { days: 90, priceVnd: 899_000 },
}

export const isBankPeriod = (v: unknown): v is BankPeriod => typeof v === 'string' && (BANK_PERIODS as readonly string[]).includes(v)
/** How long an ad of `p` runs once paid, in seconds (ListingAd.durationSec). */
export const bankPeriodSec = (p: BankPeriod): number => BANK_PERIOD[p].days * 86_400

/** An unpaid order lapses this long after it was made (bank.ts reads it lazily: no sweep job). */
export const BANK_ORDER_DAYS = 7

/** A bank order's own ListingAd statuses (bank.ts). Neither is an ad: every reader of paid ads (serve, reconcile, stats,
 *  shopAds, the dashboard's figures) lists the statuses it reads, and neither of these is among them. */
export const BANK_AWAITING = 'awaiting_transfer'
export const BANK_CANCELLED = 'cancelled'
