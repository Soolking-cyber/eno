// Platform fee model (mediation + buyer-safety insurance on every on-platform
// transaction). Small deals pay a flat fee so they're not nickel-and-dimed;
// larger deals pay 1%. Single source of truth for checkout + UI copy.

export const FEE_FLAT = 10_000 // VND — flat fee for transactions under the threshold
export const FEE_THRESHOLD = 1_000_000 // VND — at/above this, switch to a percentage
export const FEE_RATE = 0.01 // 1%

/** The platform fee (VND) for a transaction of `amount` VND. */
export function transactionFee(amount: number): number {
  if (!Number.isFinite(amount) || amount <= 0) return 0
  return amount < FEE_THRESHOLD ? FEE_FLAT : Math.round(amount * FEE_RATE)
}

/** What the seller nets after the platform fee. */
export function sellerNet(amount: number): number {
  return Math.max(0, Math.round(amount) - transactionFee(amount))
}
