/**
 * The pure rules scripts/import-partners.ts applies to a staged product — here, because that script
 * imports the database at module scope and so cannot be unit-tested (the same reason feed-taxonomy.ts and
 * feed-model.ts left the importers).
 *
 * Second-hand focus (owner, 2026-10-03): see the header of scripts/import-partners.ts.
 */

/**
 * ⛔ ONLY A LIVE ROW IS REFRESHED. `hidden` is a journaled hide (ad-ban, import screen, the 2026-10-03
 * new-goods retirement) or a moderator's decision, `stale` / `expired` are their own retirements, and
 * `removed` is a tombstone kept as evidence. A refresh is a Prisma write that bumps `updatedAt`, and a row
 * touched after its hide is one the hide's rollback refuses — so anything but active|sold is left alone.
 */
export function isLiveForRefresh(status: string | null | undefined): boolean {
  return status === 'active' || status === 'sold'
}

/**
 * The same rule as a Prisma `where` fragment, for a maintenance script's SELECTION (enrich-electronics,
 * extract-specs, repair-bad-specs, backfill-brands, ai-describe-listings): each rewrites the rows it selects
 * through `db.listing.update`, which bumps `updatedAt`, so selecting a hidden row would silently make it
 * one its hide's rollback refuses (verify review, 2026-10-04). A fresh object per call: Prisma inputs are
 * mutable and a shared one could be edited by a caller.
 */
export function liveRowsOnly(): { status: { in: string[] } } {
  return { status: { in: ['active', 'sold'] } }
}

/**
 * ⛔ A `refreshOnly` shop (new AND used stock) gets no NEW listing — only its existing live rows refresh.
 * True when this staged product would be a create there.
 */
export function blockedCreate(store: { refreshOnly?: string }, existing: unknown): boolean {
  return !existing && !!store.refreshOnly
}

/**
 * ⛔ A TITLE THAT DECLARES THE GOODS BRAND-NEW IS NEVER CREATED AS USED (owner, 2026-10-05: "do it").
 * Thế Giới Số 365's endpoint is its "Laptop Like New" category, so the store's claim is `used` — but the shop
 * files sealed stock there too, titled "[New 100%] Dell …": 31 such rows went live labelled used and one took
 * a second-hand seat on the home page until the owner hid them (ids in ~/eno-ux2-work/tgs-new100-hidden.txt).
 * ⚠️ THE SAFE DIRECTION ONLY: this withholds a creation, so a false match costs one listing and never makes a
 * public claim — unlike "the title says used, so publish it as used", the cue `refreshOnly` rejected after
 * two gate rounds.
 * ⛔ THE SHOP'S OWN LEADING TAG AND NOTHING WIDER (gate, 2026-10-05): a bare "new 100%" / "mới 100%" also hits
 * "[Like New 100%]" (the top USED grade), "thay pin mới 100%" (a used laptop with a new battery) and "đẹp như
 * mới 100%". Measured on the shop's 517 rows: "^[New 100%]" / "^[New100%]" is exactly the 31 hidden ones, and
 * none of its 398 "[Like New …]" titles. NFC first: a scraped Vietnamese title can arrive decomposed.
 * The tag may carry more inside its bracket ("[New 100% Fullbox]", "[New 100% - Nguyên seal]") or have no
 * bracket at all ("New 100% Dell …"), and a sealed/brand-new tag says the same ("[Nguyên Seal]", "[Brand New]")
 * — always AT THE START, which is where this shop states the grade ("[Like New 99%]" opens the used ones).
 */
const DECLARED_NEW = /^\s*(?:[[(]\s*)?(?:(?:new|mới)\s*100\s*%|brand\s*new\b|nguyên\s*seal\b|new\s*seal\b)/iu

/** Does this product title open with a brand-new tag ("[New 100%] …", "[New100%] …", "(Mới 100%) …")? */
export function declaresBrandNew(title: string): boolean {
  return DECLARED_NEW.test(title.normalize('NFC'))
}

/** True when this staged product would be CREATED as used although its own title declares it brand-new. */
export function blockedAsDeclaredNew(store: { condition: 'used' | 'new' | null }, existing: unknown, title: string): boolean {
  return !existing && store.condition === 'used' && declaresBrandNew(title)
}
