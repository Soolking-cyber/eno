/**
 * `--seller <id>` for the catalogue-maintenance scripts (enrich-electronics, extract-specs,
 * ai-describe-listings, backfill-brands, repair-bad-specs).
 *
 * ⛔ AN ID, REQUIRED — NOT A NAME, AND NEVER A DEFAULT (second-hand focus, owner 2026-10-03). Each of those
 * scripts defaulted to `--seller CellphoneS` by NAME: run bare, it rewrote the catalogue the owner has
 * just taken off the site, and `Seller.name` is not unique — anyone can open a storefront called
 * "CellphoneS" (src/lib/import-sellers.ts says the same). An id names exactly one storefront.
 * ⛔ AND AN OWNED STOREFRONT IS REFUSED: these scripts bulk-rewrite text, specs and brands; a storefront
 * with an `ownerId` belongs to a real person, whose listings are theirs to edit.
 */

/** A seller id as stored: cuid-like or a seeded slug id, lower-case — a display name ("CellphoneS") is not one. */
const SELLER_ID = /^[a-z0-9][a-z0-9_-]{5,63}$/

export function sellerIdArg(argv: readonly string[]): { id: string | null; error: string | null } {
  // Both `--seller <id>` and `--seller=<id>`; more than one is refused rather than silently taking the first.
  const values: (string | undefined)[] = []
  argv.forEach((a, i) => {
    if (a === '--seller') values.push(argv[i + 1])
    else if (a.startsWith('--seller=')) values.push(a.slice('--seller='.length))
  })
  if (values.length > 1) return { id: null, error: '--seller given more than once — pass exactly one Seller.id.' }
  const value = values[0]
  if (!value || value.startsWith('--')) {
    return { id: null, error: '--seller <id> is required — the storefront\'s Seller.id (e.g. from /sellers/<id>), not its name. There is no default.' }
  }
  if (!SELLER_ID.test(value)) {
    return { id: null, error: `--seller ${JSON.stringify(value)} is not a seller id — pass the Seller.id (lower-case, no spaces), not the storefront's name.` }
  }
  return { id: value, error: null }
}

export type SellerLookupDb = {
  seller: { findUnique(args: { where: { id: string }; select: { id: true; name: true; ownerId: true } }): Promise<{ id: string; name: string; ownerId: string | null } | null> }
}

/** The ownerless import storefront `id` names — or an Error saying why it may not be rewritten. */
export async function resolveImportSeller(db: SellerLookupDb, id: string): Promise<{ id: string; name: string }> {
  const seller = await db.seller.findUnique({ where: { id }, select: { id: true, name: true, ownerId: true } })
  if (!seller) throw new Error(`no storefront with id ${id}`)
  if (seller.ownerId) throw new Error(`storefront ${id} ("${seller.name}") is owned by a real account — refusing to rewrite its listings`)
  return { id: seller.id, name: seller.name }
}
