/**
 * ── WHICH MONEY A ListingAd ROW IS IN (owner 2026-11-25: ads by VietQR bank transfer beside x402). An x402 row's `amount`
 * is USDC in atomic units (6 decimals: 3760000 = 3.76 USDC); a bank-transfer row's (bank.ts: asset 'VND', network
 * 'vietqr') is whole đồng (99000 = 99.000 đ). ⛔ Every figure built on `amount` — spend, eCPM, eCPC, a refund — is stated in
 * the row's OWN currency: a đồng amount read as USDC atomic units would print 99.000 đ as 0.099 USDC.
 */
export type AdCurrency = 'USDC' | 'VND'

export const adCurrency = (ad: { asset: string }): AdCurrency => (ad.asset === 'VND' ? 'VND' : 'USDC')
