/**
 * ── IMPORTS THAT MUST NOT RUN AGAIN ───────────────────────────────────────────────────────────────────
 *
 * Owner, 2026-10-03: "remove tiki and cellphones products from the app, we will have tight focus on
 * second hand stores and rentals plus job postings". The new-goods catalogues were hidden (journaled,
 * reversible — scripts/retire-new-retail.ts) and the shops' used stock was kept. A re-run of the importer
 * that built a catalogue would undo that in two ways, both silent:
 *   · it CREATES every SKU the hide did not cover as `active` — new goods back on the site; and
 *   · its refresh UPSERT writes every existing row through Prisma, hidden ones included, which bumps
 *     `updatedAt` — and a row touched after the hide is exactly what the hide's --rollback refuses, so
 *     the reversal would be lost too. import-accesstrade.ts also writes `condition: 'new'` on refresh,
 *     which would relabel the 1,264 CellphoneS and 137 Điện Thoại Vui rows kept as second-hand.
 * So these imports are REFUSED, not merely "not scheduled" (none of them is on a timer; that was never
 * the risk — a person re-running a documented command is).
 *
 * ⛔ AND SINCE 2026-10-13 THE KEPT USED STOCK IS GONE TOO — owner: "remove all accesstrade products from the
 * website". CellphoneS' used shelf and Điện Thoại Vui were hidden (scripts/hide-accesstrade.ts,
 * src/lib/accesstrade-removal.ts; VinWonders kept by the owner's answer), the nightly price refresh lost its last
 * two campaigns (affiliate-price-refresh.ts MERCHANT_NAMES is empty) and its timer is POLICY, not SAFE
 * (infra/vn-node/cron/install-cron-timers.sh). It only ever wrote price and link on active|sold rows.
 *
 * ✅ AND SINCE 2026-11-14 THE TWO USED SHELVES ARE BACK — owner: "import all 2nd hand one with comission"
 * (AccessTrade pays on them: Điện Thoại Vui's used phones 1.59%, CellphoneS' "Hàng cũ" 2.59%/2.07%, excl. VAT).
 * cellphones_cps and dienthoaivui moved from the refusal list to the allow-list as USED-ONLY campaigns:
 * the importer creates only a feed row that isUsedTitle (src/lib/used-signal.ts) calls second-hand, and
 * creates it as condition 'used'. CellphoneS' new goods stay hidden and are never created. The hidden used
 * rows come back through scripts/restore-accesstrade-used.ts (journaled), not through the importer, which
 * still skips every non-live row.
 */

const DECISION = 'second-hand focus, owner 2026-10-03: new-goods catalogues are hidden and not re-imported'

/** AccessTrade campaign slug → why `scripts/import-accesstrade.ts --campaign <slug>` refuses it. */
export const RETIRED_ACCESSTRADE_IMPORTS: ReadonlyMap<string, string> = new Map([
  ['tiki_creator', `Tiki — every row is new goods (${DECISION})`],
  ['ben', `BỀN COMPUTER — every row is new goods (${DECISION})`],
])

/** How the importer may treat an allow-listed campaign. */
export type ImportableCampaign = {
  /** Whose decision put it here, quoted. */
  why: string
  /**
   * ⛔ USED-ONLY: a feed row is created only when isUsedTitle(name, null, url) says the shop calls it second-hand,
   * and it is created as condition 'used'. A row the rule does not call used is skipped, never created as 'new'.
   */
  usedOnly: true
  /**
   * ⛔ 'crawl' — the shop's used stock is NOT in its AccessTrade datafeed (Hoàng Hà: 2,275 feed rows, 0 used; ShopDunk: no
   * feed), so its used section is READ from the shop's own pages (src/lib/accesstrade-crawl.ts) by the importer's
   * `--crawl` mode and the nightly /api/cron/affiliate-crawl (src/lib/affiliate-night.ts). The section is the used
   * evidence: titles there do not say "cũ", so usedForShelf is not applied — the reader leaves out a title that DECLARES
   * new goods instead. A crawl campaign is never walked as a datafeed, and a datafeed campaign never as a crawl.
   */
  source?: 'crawl'
  /**
   * ⛔ CHAT ONLY (owner 2026-11-14: "no links that lead to another website"; "only admins should see the link"): every
   * listing write for the campaign — import or nightly — is REFUSED unless its storefront is a pinned eno-run pair
   * (src/lib/eno-run-partners.ts). So a row of it can only ever exist with a NULL public link and its tracking link in the
   * staff-only table; an un-pin or an un-claim stops every write rather than re-opening the public column.
   */
  chatOnly?: true
  /** The AccessTrade campaign id (a crawl campaign has no datafeed to ask) — the tracking link's second path segment. */
  campaignId?: string
}

/** Why the SuperSports importer refuses to run (all 5,955 rows hidden 2026-10-02, storefront 404s since 6ac6e6d73). */
export const SUPERSPORTS_RETIRED =
  `SuperSports — every row was hidden on 2026-10-02 and the storefront 404s; a re-import would re-create new goods and bump updatedAt on the hidden rows, which disables their rollback (${DECISION})`

/**
 * ⛔ AN ALLOW-LIST, NOT ONLY THE DENY-LIST ABOVE (commit-gate review): import-accesstrade.ts writes
 * `condition: 'new'` on every listing it creates, so ANY other approved campaign would publish new goods —
 * the thing the second-hand focus removed. EMPTY from 2026-10-03 to 2026-11-14; adding a campaign is a code change
 * that names the owner's decision, not a flag someone types, and every entry is used-only.
 */
export const IMPORTABLE_ACCESSTRADE_CAMPAIGNS: ReadonlyMap<string, ImportableCampaign> = new Map([
  ['cellphones_cps', { why: 'CellphoneS used shelf ("Hàng cũ") — owner 2026-11-14: "import all 2nd hand one with comission"', usedOnly: true }],
  ['dienthoaivui', { why: 'Điện Thoại Vui used phones (campaign /may-cu) — owner 2026-11-14: "import all 2nd hand one with comission"', usedOnly: true }],
  // Owner 2026-11-14 ("register the remaining 3 and import all 2nd hand one with comission"; Hoàng Hà + ShopDunk: "All of
  // them"; "Partners now, admins sell") and 11-15 ("Keep tracking link"). Both campaigns auto-approved 2026-11-14.
  ['hoanghamobile', { why: 'Hoàng Hà Mobile used units (/kho-san-pham-cu, crawled) — owner 2026-11-14 "All of them", chat only', usedOnly: true, source: 'crawl', chatOnly: true, campaignId: '5229340396064683522' }],
  ['shopdunk_web', { why: 'ShopDunk used Apple (/may-cu, crawled) — owner 2026-11-14 "All of them", chat only', usedOnly: true, source: 'crawl', chatOnly: true, campaignId: '6800497735607325103' }],
])

/** The refusal message for an AccessTrade campaign, or null when it may be imported. */
export function retiredImportReason(campaign: string | null | undefined): string | null {
  const slug = (campaign ?? '').trim()
  const retired = RETIRED_ACCESSTRADE_IMPORTS.get(slug)
  if (retired) return retired
  if (!IMPORTABLE_ACCESSTRADE_CAMPAIGNS.has(slug)) {
    return `"${slug}" is not on IMPORTABLE_ACCESSTRADE_CAMPAIGNS (src/lib/retired-imports.ts) — only a used-only campaign the owner named may be imported (${DECISION})`
  }
  return null
}

/** The allow-list entry for a campaign, or null. The importer reads `usedOnly` from here, never from a flag. */
export function importableCampaign(campaign: string | null | undefined): ImportableCampaign | null {
  return IMPORTABLE_ACCESSTRADE_CAMPAIGNS.get((campaign ?? '').trim()) ?? null
}
