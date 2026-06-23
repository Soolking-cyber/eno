// Launch prep: delete the mock/seed catalog from the LIVE database.
// Removes the ~2,520 "Sample mock listing for testing" rows + the 10 mock
// "seller-%" storefronts (+ all seed reviews, which have no real write path yet).
// Preserves real Profiles, real Sellers, real Listings, and the Category taxonomy.
//
// Run:  cd /Users/mk1e3/eno.vn && \
//   DATABASE_URL='postgresql://postgres.xihiryllwmjoouipkyhw:doXVkbI6nPqbHSW0@aws-1-ap-southeast-1.pooler.supabase.com:6543/postgres?pgbouncer=true' \
//   node scripts/purge-mock.mjs
import { PrismaClient } from '@prisma/client'

const db = new PrismaClient()
const MARKER = 'Sample mock listing for testing'

const count = async () => ({
  listings: await db.listing.count(),
  mockListings: await db.listing.count({ where: { description: { contains: MARKER } } }),
  sellers: await db.seller.count(),
  mockSellers: await db.seller.count({ where: { id: { startsWith: 'seller-' } } }),
  reviews: await db.review.count(),
})

console.log('BEFORE:', await count())

// FK-safe order (mirrors prisma/seed.ts wipe): reviews -> listings -> sellers.
// All reviews are seed data (no buyer-review write path exists yet) -> safe to clear.
const rev = await db.review.deleteMany({})
const lis = await db.listing.deleteMany({ where: { description: { contains: MARKER } } })
const sel = await db.seller.deleteMany({ where: { id: { startsWith: 'seller-' } } })

console.log('DELETED:', { reviews: rev.count, mockListings: lis.count, mockSellers: sel.count })
console.log('AFTER:', await count())
await db.$disconnect()
