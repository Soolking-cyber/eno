/**
 * Give the affiliate partner's storefront its clean handle — eno.vn/vinwonders.
 *
 *   npx tsx scripts/set-partner-handle.ts            # DRY RUN
 *   npx tsx scripts/set-partner-handle.ts --apply
 *
 * ⚠️ WHY IT MATTERS BEYOND TIDINESS. The home-page promo slide has to link somewhere, and a raw
 * `/sellers/<cuid>` is a database id baked into source: it does not exist in any other environment,
 * so the hero CTA 404s on a reseeded database. VietKite and GMBR both have handles already; this is
 * the third partner catching up. The catalogue has declared `partner.handle: "vinwonders"` since
 * the listings were seeded — this makes it real.
 *
 * ⚠️ THE HANDLE MUST PASS THE SAME VALIDATOR THE SIGNUP FORM USES, or it is reachable by URL but
 * unclaimable and unsearchable. validateHandle() is imported rather than re-implemented.
 */
import 'dotenv/config'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { db } from '../src/lib/db'
import { validateHandle } from '../src/lib/handle-format'

async function main() {
  const apply = process.argv.includes('--apply')
  const cat = JSON.parse(readFileSync(join(process.cwd(), 'data/vinwonders-destinations.json'), 'utf8'))
  const name: string = cat.partner?.name
  const handle: string = (cat.partner?.handle || '').toLowerCase()
  if (!name || !handle) { console.error('catalogue has no partner.name / partner.handle'); process.exit(1) }

  // ⚠️ validateHandle RETURNS null FOR A VALID HANDLE and a reason string otherwise — the
  // inverted-looking check is correct. Comparing against 'ok' compiles to a type error, which is
  // the only reason this was caught rather than silently rejecting every handle.
  const problem = validateHandle(handle)
  if (problem) { console.error(`handle "${handle}" is ${problem} — refusing`); process.exit(1) }

  // Identified by its listings, not by name: Seller.name is not unique, and handing the partner's
  // clean URL to an impersonator would be worse than having no handle at all.
  const anchor = await db.listing.findFirst({
    where: { affiliateUrl: { not: null } },
    select: { seller: { select: { id: true, name: true, handle: { select: { handle: true } } } } },
  })
  const seller = anchor?.seller
  if (!seller) { console.error('no affiliate listing found'); process.exit(1) }
  if (seller.name !== name) { console.error(`storefront behind the affiliate listings is "${seller.name}", not "${name}" — refusing`); process.exit(1) }
  if (seller.handle) { console.log(`already has /${seller.handle.handle} — nothing to do`); await db.$disconnect(); return }

  const taken = await db.handle.findUnique({ where: { handle }, select: { handle: true } })
  if (taken) { console.error(`/${handle} is already taken — refusing to move it`); process.exit(1) }

  console.log(`${seller.name} (${seller.id}) -> /${handle}`)
  if (!apply) { console.log('\nDRY RUN — re-run with --apply.'); await db.$disconnect(); return }
  await db.handle.create({ data: { handle, sellerId: seller.id } })
  console.log(`APPLIED: /${handle}`)
  await db.$disconnect()
}
main().catch((e) => { console.error(e); process.exit(1) })
