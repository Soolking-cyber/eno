import { randomUUID } from 'node:crypto'
import { PrismaClient } from '../src/generated/prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { TAXONOMY } from '../src/lib/taxonomy'

// ─────────────────────────────────────────────────────────────────────────────
// CI FIXTURES — the deterministic marketplace a browser gate can assert against.
//
// ⛔ THROWAWAY DATABASES ONLY, AND THE GUARD BELOW IS NOT DECORATION. This script
// writes sellers and PUBLIC (verified) listings. A verified row on production is
// visible to every visitor, so the connection is refused unless it points at a
// loopback host. Review Q01 asked for "fixtures, not live rows"; this is the
// other half of that rule — fixtures that can never leave the CI container.
//
// ⚠️ WHY THE DESK SELLER EXISTS HERE. The marketplace edition FAILS CLOSED when it
// cannot resolve the visa/trip desk it must exclude (edition-scope.ts:360,
// DeskResolutionError) — that is the licensing control, and it means an empty
// database cannot even render `/`. So the fixtures seed the desk account too,
// with one listing, and the gate asserts that listing is NOT in the feed. The
// exclusion is then covered by the browser suite rather than by unit tests alone.
//
// Run: DATABASE_URL=postgresql://…@127.0.0.1:…/eno npx tsx scripts/ci-fixtures.ts
// ─────────────────────────────────────────────────────────────────────────────

const url = process.env.DIRECT_URL || process.env.DATABASE_URL
if (!url) { console.error('Set DATABASE_URL'); process.exit(1) }
const parsed = (() => { try { return new URL(url) } catch { return null } })()
const host = parsed?.hostname ?? ''
const port = parsed?.port ?? ''

// ⛔ LOOPBACK IS NOT A SAFETY CHECK IN THIS REPO, AND ASSUMING IT WAS WOULD HAVE BEEN THE WHOLE
// ACCIDENT. `DATABASE_URL` here points at 127.0.0.1:5433, which is an SSH TUNNEL TO PRODUCTION —
// so the obvious "only localhost" guard would have waved this script straight into the live
// database, where every row it writes is a PUBLIC, verified listing. Caught in review before it
// ran anywhere but a container. Three independent conditions now, and all three must hold:
//   1. an explicit opt-in variable, which no ordinary shell has set;
//   2. a loopback (or the CI service alias) host that is NOT the tunnel port;
//   3. a database with no listing rows of its own.
if (process.env.ALLOW_FIXTURE_WRITES !== '1') {
  console.error('ci-fixtures: refusing to run without ALLOW_FIXTURE_WRITES=1 — it writes PUBLIC listings.')
  process.exit(1)
}
if (!['127.0.0.1', 'localhost', '::1', 'postgres'].includes(host)) {
  console.error(`ci-fixtures: refusing to write to "${host}" — loopback (or the CI service alias "postgres") only.`)
  process.exit(1)
}
if (port === '5433') {
  console.error('ci-fixtures: 127.0.0.1:5433 is the production SSH tunnel in this repo. Refusing.')
  process.exit(1)
}

const adapter = new PrismaPg({ connectionString: url })
const db = new PrismaClient({ adapter, log: ['warn', 'error'] })

/** The desk the marketplace must EXCLUDE. Its address is what `deskSellerIds()` resolves. */
const DESK_EMAIL = (process.env.HIDDEN_DESK_OWNER_EMAILS || 'support@eno.forum').split(',')[0].trim().toLowerCase()
const SELLER_EMAIL = 'ci-seller@eno.vn'

/** Fixed uuids/ids so a re-run updates one set of rows instead of growing the fixture. */
const DESK_PROFILE = '00000000-0000-4000-8000-0000000000d1'
const SELLER_PROFILE = '00000000-0000-4000-8000-0000000000s1'.replace('s', 'a')
const DESK_SELLER_ID = 'ci-desk-store'
const SELLER_ID = 'ci-fixture-store'

/** Six listings across three categories, with the cheapest and the newest deliberately last —
 *  a sort that only touches the first page cannot find them (review U01's regression case). */
const LISTINGS = [
  { id: 'ci-l-1', title: 'Fixture laptop 14"', price: 18_500_000, cat: 'electronics', city: 'Ho Chi Minh City' },
  { id: 'ci-l-2', title: 'Fixture phone 128GB', price: 7_900_000, cat: 'electronics', city: 'Hanoi' },
  { id: 'ci-l-3', title: 'Fixture desk lamp', price: 450_000, cat: 'furniture-appliances', city: 'Da Nang' },
  // ⚠️ THE UNIT SUFFIX IS THE POINT OF THIS ROW, NOT DECORATION. A price with no unit is short and
  // fits any card; "2,370,000 VND / month ≈ $91" is the string that overflowed into the NEXT card
  // on every phone width (owner, twice). The overflow spec is only a regression guard while at
  // least one fixture carries a unit, so keep one here.
  { id: 'ci-l-4', title: 'Fixture studio flat', price: 12_300_000, unit: 'month', cat: 'rentals', city: 'Ho Chi Minh City' },
  { id: 'ci-l-5', title: 'Fixture city scooter', price: 26_000_000, cat: 'vehicles', city: 'Hanoi' },
  { id: 'ci-l-6', title: 'Fixture bicycle', price: 1_200_000, cat: 'vehicles', city: 'Da Nang' },
]

const IMAGE = '/icons/ui/rest/camera.svg'

async function profile(id: string, email: string, displayName: string) {
  await db.profile.upsert({
    where: { id },
    update: { email, displayName },
    // ⚠️ NO auth.users ROW EXISTS IN CI. The FK to Supabase's auth schema is added by raw SQL in
    // production and is absent from `prisma migrate diff --from-empty`, which is what builds the CI
    // database — so a bare Profile insert is valid here and only here.
    create: { id, email, displayName, accountType: 'individual' },
  })
}

async function seller(id: string, ownerId: string, name: string) {
  await db.seller.upsert({
    where: { id },
    update: { name, ownerId },
    create: { id, name, ownerId, verified: true, verifiedSeller: true },
  })
}

async function main() {
  // Condition 3: a database that already holds listings is somebody's real data, tunnel or not.
  const foreign = await db.listing.count({ where: { id: { not: { startsWith: 'ci-' } } } })
  if (foreign > 0) {
    console.error(`ci-fixtures: this database already holds ${foreign} listing(s) that are not fixtures. Refusing.`)
    process.exit(1)
  }
  for (const c of TAXONOMY) {
    await db.category.upsert({
      where: { slug: c.slug },
      update: { name: c.name, nameVi: c.nameVi, icon: c.icon, color: c.color, description: c.description },
      create: { name: c.name, nameVi: c.nameVi, slug: c.slug, icon: c.icon, color: c.color, description: c.description },
    })
  }
  const categories = new Map((await db.category.findMany({ select: { id: true, slug: true } })).map((c) => [c.slug, c.id]))

  await profile(DESK_PROFILE, DESK_EMAIL, 'CI Desk')
  await profile(SELLER_PROFILE, SELLER_EMAIL, 'CI Fixture Seller')
  await seller(DESK_SELLER_ID, DESK_PROFILE, 'CI Desk Storefront')
  await seller(SELLER_ID, SELLER_PROFILE, 'CI Fixture Shop')

  const now = Date.now()
  let i = 0
  for (const l of LISTINGS) {
    const categoryId = categories.get(l.cat)
    if (!categoryId) throw new Error(`taxonomy has no category "${l.cat}"`)
    i++
    const createdAt = new Date(now - (LISTINGS.length - i) * 3_600_000)
    const data = {
      title: l.title,
      description: `${l.title} — a deterministic CI fixture. Not a real listing.`,
      price: l.price,
      priceUnit: (l as { unit?: string }).unit ?? 'VND',
      location: l.city,
      city: l.city,
      images: JSON.stringify([IMAGE]),
      categoryId,
      sellerId: SELLER_ID,
      verified: true,
      status: 'active',
      searchText: `${l.title} ${l.city}`.toLowerCase(),
      createdAt,
    }
    await db.listing.upsert({ where: { id: l.id }, update: data, create: { id: l.id, ...data } })
  }

  // The one row the marketplace must never show. Same shape as the others so a leak is a
  // visible product card, not a subtle field difference.
  const deskCategory = categories.get('services') ?? categories.values().next().value!
  const deskData = {
    title: 'Fixture e-visa service',
    description: 'Desk listing — the marketplace edition must exclude this.',
    price: 2_370_000,
    priceUnit: 'service',
    location: 'Hanoi',
    city: 'Hanoi',
    images: JSON.stringify([IMAGE]),
    categoryId: deskCategory,
    sellerId: DESK_SELLER_ID,
    verified: true,
    status: 'active',
    searchText: 'fixture e-visa service hanoi',
  }
  await db.listing.upsert({ where: { id: 'ci-l-desk' }, update: deskData, create: { id: 'ci-l-desk', ...deskData } })

  const counts = {
    categories: await db.category.count(),
    sellers: await db.seller.count(),
    listings: await db.listing.count({ where: { verified: true, status: 'active' } }),
    deskExcludedFromFeed: 1,
    runId: randomUUID().slice(0, 8),
  }
  console.log('ci-fixtures ready:', JSON.stringify(counts))
}

main()
  .catch((e) => { console.error(e); process.exit(1) })
  .finally(async () => { await db.$disconnect() })
