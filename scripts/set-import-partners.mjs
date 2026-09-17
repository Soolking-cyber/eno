// GRANT THE OFFICIAL-PARTNER BADGE TO EVERY IMPORT-BACKED STOREFRONT.
//
//   node --env-file=.env scripts/set-import-partners.mjs            # DRY RUN — lists what it would do
//   node --env-file=.env scripts/set-import-partners.mjs --apply
//
// ⛔ THERE IS NO BULK REVOKE, AND ITS ABSENCE IS DELIBERATE (a reviewer's catch on the first cut,
// which had `--off` reuse this selection). The selection is "a storefront whose catalogue we fetch",
// and VinWonders — a genuinely negotiated partner — is one of those. A bulk `--off` would strip the
// badge from the real partners along with the imported ones, which is the one direction that makes a
// false statement about a commercial relationship. Revoking is per-seller work:
// scripts/set-official-partner.mjs <handle|id> --off --apply.
//
// ⛔ THIS REVERSES A RULE THE IMPORTERS USED TO STATE IN CAPITALS, AND THE REVERSAL IS THE OWNER'S.
// 2026-09-17: "also give all fetching stores a partner badge". Until today every importer created
// its storefront with `officialPartner: false` and a comment arguing that the badge is for
// negotiated partners like VinWonders and that stamping it on a datafeed devalues the real one.
// The owner has decided the opposite: a shop whose catalogue eno carries IS a partner of the site,
// and the badge says so. Those comments now record the decision instead of contradicting it.
//
// ⚠️ WHAT THE FLAG ACTUALLY DOES, beyond the gold badge: an official partner shares NO phone number
// (the reveal is suppressed). That is a no-op for these storefronts — they are catalogues, not
// accounts, and none of them has a phone stored — but it is the reason this is not pure decoration,
// and it is why a selected seller that DOES hold a number stops this script: hiding a public phone
// is not something a bulk pass should decide. set-official-partner.mjs handles those one at a time,
// naming the consequence.
//
// ⛔ SELECTION IS "A CATALOGUE WE FETCH", NOT "A SELLER WE LIKE": a storefront with NO owner account
// that has at least one listing carrying an outbound link. The owner check is the same guard every
// importer carries — a Seller with an `ownerId` belongs to a real person, and handing their account
// a commercial badge nobody agreed to is exactly the mistake the guard exists to prevent.
import { Client } from 'pg'

const args = process.argv.slice(2)
const APPLY = args.includes('--apply')
if (args.includes('--off')) {
  console.error('This script only GRANTS. To revoke, name the storefront: scripts/set-official-partner.mjs <handle|id> --off --apply')
  process.exit(1)
}
const DB = process.env.DIRECT_URL || process.env.DATABASE_URL
if (!DB) { console.error('Missing DIRECT_URL — run with node --env-file=.env'); process.exit(1) }

const c = new Client({ connectionString: DB })
await c.connect()
try {
  const { rows } = await c.query(`
    select s.id, s.name, s."officialPartner", s.phone,
           count(l.id) filter (where l."affiliateUrl" like 'https://%') as affiliate_listings,
           count(l.id) as listings
      from "Seller" s
      join "Listing" l on l."sellerId" = s.id
     where s."ownerId" is null
     group by s.id, s.name, s."officialPartner", s.phone
    -- ⚠️ A REAL https LINK, not merely non-null: an empty string or a hand-typed value is not
    -- evidence that eno fetches this shop's catalogue (a reviewer's catch).
    having count(l.id) filter (where l."affiliateUrl" like 'https://%') > 0
     order by 5 desc
  `)

  if (!rows.length) { console.log('no import-backed storefronts found'); process.exit(0) }

  const changing = rows.filter((r) => !r.officialPartner)
  /**
   * ⚠️ A STORED PHONE MAKES THIS THE WRONG TOOL: granting the badge HIDES a number that is public
   * today, and a bulk pass is no place to do that to a seller.
   * ⚠️ AN EMPTY STRING IS NOT A PHONE, AND JS AND SQL DISAGREED ABOUT IT (a reviewer's catch): `''`
   * is falsy here but is NOT NULL to Postgres, so such a row passed this check and was then silently
   * skipped by the `phone is null` in the UPDATE — reported as changed, never written. Both sides now
   * read "null or blank".
   */
  const hasPhone = (r) => typeof r.phone === 'string' && r.phone.trim() !== ''
  const withPhone = changing.filter(hasPhone)

  console.log(`${rows.length} import-backed storefront(s); ${changing.length} would gain the badge\n`)
  for (const r of rows) {
    console.log(`${r.officialPartner ? '   =' : '  +P'}  ${String(r.listings).padStart(6)} listings (${r.affiliate_listings} linked)  ${r.name}${hasPhone(r) ? '  ⚠️ has a stored phone' : ''}`)
  }

  if (withPhone.length) {
    console.error(`\n⛔ ${withPhone.length} of them store a phone number, which this script will not touch in bulk:`)
    for (const r of withPhone) console.error(`   ${r.name}`)
    console.error('Use scripts/set-official-partner.mjs for those, which makes you name the phone consequence.')
    process.exit(1)
  }

  if (!APPLY) { console.log('\nDRY RUN — nothing written. Re-run with --apply.'); process.exit(0) }
  if (!changing.length) { console.log('\nnothing to change'); process.exit(0) }

  const res = await c.query(
    `update "Seller" set "officialPartner" = true
      where id = any($1) and "ownerId" is null and coalesce(nullif(btrim(phone), ''), null) is null`,
    [changing.map((r) => r.id)],
  )
  console.log(`\n✓ ${res.rowCount} storefront(s) now carry the partner badge`)
  console.log('⚠️ Storefront and card HTML is edge-cached — purge Cloudflare (purge_everything) for the badge to appear.')
} finally {
  await c.end()
}
