import { isCommissionLink } from './affiliate-commission'

/**
 * ── THE ACCESSTRADE REMOVAL (owner, 2026-10-13: "remove all accesstrade products from the website") ──
 *
 * Every listing whose buy link is an AccessTrade tracker (isCommissionLink: go.isclix.com, shorten.asia,
 * click.accesstrade.vn — the same rule that prints the "Ad / Quảng cáo" chip) leaves the site, through the
 * journaled, reversible hide (src/lib/journaled-hide.ts, scripts/hide-accesstrade.ts). On 2026-10-13 that
 * meant the second-hand shelves the 2026-10-03 cleanup had kept: CellphoneS (702 active + 580 sold) and
 * Điện Thoại Vui (105 active + 47 sold). Tiki, BỀN COMPUTER, CellphoneS' new goods and SuperSports were
 * already hidden.
 *
 * ⛔ VINWONDERS STAYS — the owner's answer the same day, asked because its 17 ticket listings book through
 * AccessTrade short links (shorten.asia) and the 2026-10-03 cleanup had been told "esim vinwonders … dont
 * touch". Keeping it is a decision, not an oversight: it is named here so a later sweep cannot sweep it.
 */
export const ACCESSTRADE_KEPT_SELLERS: ReadonlyMap<string, string> = new Map([
  ['cmt6v9x4o00004fq4v6qokman', 'VinWonders — owner 2026-10-13: "Keep VinWonders" (tickets book through AccessTrade short links)'],
])

/**
 * PROVENANCE, NOT ONLY THE LINK (commit gate, 2026-10-13): the storefronts whose catalogue came from AccessTrade (its
 * datafeed, or — SuperSports — its minted checkout links). Any live row of theirs goes, whatever its affiliateUrl says
 * (a null or direct merchant link would otherwise keep a product of theirs up). Measured read-only 2026-10-13: these
 * five + VinWonders are every storefront holding an AccessTrade link; none has an owner.
 */
export const ACCESSTRADE_SOURCED_SELLERS: ReadonlyMap<string, string> = new Map([
  ['cmt78nvif0000gpq48kvzmxjw', 'CellphoneS (campaign cellphones_cps)'],
  ['cmtr9qva90000glq44fkjs18b', 'Điện Thoại Vui (campaign dienthoaivui)'],
  ['cmtu2fppp000008q44x4pvrz2', 'Tiki (campaign tiki_creator)'],
  ['cmtba6iyc00006iq4m6qkwjjf', 'BỀN COMPUTER (campaign ben)'],
  ['cmu52jkld0000czq443snv0jh', 'SuperSports (AccessTrade checkout links)'],
])

export type AccessTradeRow = { sellerId: string; affiliateUrl: string | null; ownerId: string | null }

/** Why a row is NOT removed, or null when it is. Only an ownerless storefront's row is ever removed. */
export function accessTradeKeepReason(row: AccessTradeRow): string | null {
  if (row.ownerId !== null) return 'a person owns this storefront — never touched by an operator sweep'
  const kept = ACCESSTRADE_KEPT_SELLERS.get(row.sellerId)
  if (kept) return kept
  if (ACCESSTRADE_SOURCED_SELLERS.has(row.sellerId)) return null
  return isCommissionLink(row.affiliateUrl) ? null : 'not an AccessTrade link'
}

/** The cheap SQL prefilter the script reads with (link hosts OR the sourced storefronts); accessTradeKeepReason decides. */
export const ACCESSTRADE_URL_PREFILTER = ['isclix.com', 'shorten.asia', 'accesstrade.vn'] as const
