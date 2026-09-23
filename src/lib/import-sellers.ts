/**
 * THE PLATFORM-OWNED SELLERS WHOSE ROWS ARE IMPORTED REFERENCE LISTINGS — one list, pinned by id.
 *
 * ⛔ BY ID, NEVER BY NAME. `Seller.name` is not unique and a user can set it, so a name lookup could
 * sweep a real shop's listings into an operator script that hides or re-ranks rows in bulk.
 *
 * ⚠️ ONE LIST FOR EVERY OPERATOR SCRIPT THAT ACTS ON "ALL IMPORTS". It used to be a literal inside
 * scripts/hide-imageless-imports.ts, and three new importers shipped seller ids it did not carry — so
 * their imageless rows would never have been hidden and nothing would have said so. The unit test
 * beside this file scans every importer for a `*-import-seller-NNNN` id and fails until it is here.
 *
 * ⚠️ PURE DATA, NO IMPORTS. Scripts (tsx) and unit tests both read it; a Prisma or server-only import
 * here would drag a database client into a test that only needs the strings.
 */
export const IMPORT_SELLERS = [
  'bds-vn-import-seller-0001', // Batdongsan.com.vn — scripts/import-batdongsan-rentals.ts
  'cmub0wead0000zrq418bqq27m', // Rever.vn — scripts/import-rever-rentals.ts (a cuid: created before the fixed-id convention)
  'nhatot-import-seller-0001', // Chợ Tốt Nhà — NHATOT_SELLER_ID in src/lib/nhatot-listing.ts
  'muaban-net-import-seller-0001', // Muaban.net — SELLER_ID in scripts/muaban-net-map.ts
  'honeycomb-import-seller-0001', // Honeycomb House — HONEYCOMB_SELLER_ID in src/lib/honeycomb-listing.ts
  // Reserved for two importers that were built and are PARKED, not shipped (lead, 2026-09-24): Mogi's
  // photo host answers robots.txt with HTTP 500 (= disallow everything) and Alonhadat serves a
  // CAPTCHA. Their code sits outside the repo in ~/eno-import-journals/parked/. Listing an id with no
  // importer is harmless — every script scopes by `sellerId IN (…)`, so an id with no rows matches
  // nothing — and it means a revived importer is covered from its first run.
  'mogi-vn-import-seller-0001',
  'alonhadat-com-vn-import-seller-0001',
] as const

export type ImportSellerId = (typeof IMPORT_SELLERS)[number]

export function isImportSeller(id: string): id is ImportSellerId {
  return (IMPORT_SELLERS as readonly string[]).includes(id)
}
