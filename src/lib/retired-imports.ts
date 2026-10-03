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
 * ⚠️ THE NIGHTLY PRICE REFRESH IS A DIFFERENT JOB AND KEEPS RUNNING for the shops whose used stock was
 * kept (`cellphones_cps`, `dienthoaivui` — src/lib/affiliate-price-refresh.ts). It writes price and link
 * on active|sold rows only and never creates, never relabels, never touches a hidden row.
 */

const DECISION = 'second-hand focus, owner 2026-10-03: new-goods catalogues are hidden and not re-imported'

/** AccessTrade campaign slug → why `scripts/import-accesstrade.ts --campaign <slug>` refuses it. */
export const RETIRED_ACCESSTRADE_IMPORTS: ReadonlyMap<string, string> = new Map([
  ['tiki_creator', `Tiki — every row is new goods (${DECISION})`],
  ['cellphones_cps', `CellphoneS — its new goods are hidden and its used rows kept; the importer would relabel them 'new' (${DECISION})`],
  ['ben', `BỀN COMPUTER — every row is new goods (${DECISION})`],
  ['dienthoaivui', `Điện Thoại Vui — a used-phone shop whose rows the importer would relabel 'new' (${DECISION})`],
])

/** Why the SuperSports importer refuses to run (all 5,955 rows hidden 2026-10-02, storefront 404s since 6ac6e6d73). */
export const SUPERSPORTS_RETIRED =
  `SuperSports — every row was hidden on 2026-10-02 and the storefront 404s; a re-import would re-create new goods and bump updatedAt on the hidden rows, which disables their rollback (${DECISION})`

/**
 * ⛔ AN ALLOW-LIST, NOT ONLY THE DENY-LIST ABOVE (commit-gate review): import-accesstrade.ts writes
 * `condition: 'new'` on every listing it creates, so ANY other approved campaign would publish new goods —
 * the thing the second-hand focus removed. EMPTY since 2026-10-03; adding a campaign is a code change
 * that names the owner's decision, not a flag someone types.
 */
export const IMPORTABLE_ACCESSTRADE_CAMPAIGNS: ReadonlyMap<string, string> = new Map()

/** The refusal message for an AccessTrade campaign, or null when it may be imported. */
export function retiredImportReason(campaign: string | null | undefined): string | null {
  const slug = (campaign ?? '').trim()
  const retired = RETIRED_ACCESSTRADE_IMPORTS.get(slug)
  if (retired) return retired
  if (!IMPORTABLE_ACCESSTRADE_CAMPAIGNS.has(slug)) {
    return `"${slug}" is not on IMPORTABLE_ACCESSTRADE_CAMPAIGNS (src/lib/retired-imports.ts) — the importer creates every product as condition 'new', and ${DECISION}`
  }
  return null
}
