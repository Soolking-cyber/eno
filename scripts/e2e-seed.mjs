// Seed ephemeral e2e users (seller + admin + buyer) for the authed Playwright suite.
// Idempotent + non-destructive to real data — every row is namespaced `e2e-%@eno.vn` and removed
// by scripts/e2e-cleanup.mjs. Users are created with the Supabase admin key (email_confirmed) so
// auth.setup.ts can mint a magic-link and redeem it (captcha-proof); Profile/Seller rows go in over
// DIRECT_URL because Prisma 7 has no @prisma/client package to import here (see eno-e2e-authed).
//
//   node --env-file=.env scripts/e2e-seed.mjs
import { createClient } from '@supabase/supabase-js'
import { mkdirSync, writeFileSync } from 'node:fs'
import pg from 'pg'

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SECRET = process.env.SUPABASE_SECRET_KEY
const DIRECT = process.env.DIRECT_URL
if (!URL || !SECRET || !DIRECT) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SECRET_KEY / DIRECT_URL (run with node --env-file=.env)')
  process.exit(1)
}

const admin = createClient(URL, SECRET, { auth: { autoRefreshToken: false, persistSession: false } })
// Random password — never used (auth.setup.ts signs in via magic-link), but createUser wants one.
const PW = 'E2e!' + Math.random().toString(36).slice(2, 10) + 'Aa1'
const SELLER_ID_ROW = 'e2e-seller-store' // fixed Seller.id so re-runs upsert one row

const USERS = [
  { email: 'e2e-seller@eno.vn', displayName: 'E2E Seller', account: 'business', businessName: 'E2E Test Shop', phone: '+84900000001' },
  { email: 'e2e-admin@eno.vn', displayName: 'E2E Admin', account: 'individual', phone: '+84900000002' },
  { email: 'e2e-buyer@eno.vn', displayName: 'E2E Buyer', account: 'individual', phone: '+84900000003' },
]

async function ensureUser(email) {
  const { data, error } = await admin.auth.admin.createUser({ email, email_confirm: true, password: PW })
  if (!error) return data.user.id
  // Already registered → look it up.
  const { data: list } = await admin.auth.admin.listUsers({ page: 1, perPage: 200 })
  const u = list?.users?.find((x) => x.email === email)
  if (u) return u.id
  throw new Error(`createUser failed for ${email}: ${error.message}`)
}

const db = new pg.Client({ connectionString: DIRECT })
await db.connect()
const ids = {}
for (const u of USERS) {
  const id = await ensureUser(u.email)
  ids[u.email] = id
  await db.query(
    `INSERT INTO "Profile" (id, email, "displayName", phone, "accountType", "businessName", "updatedAt")
     VALUES ($1,$2,$3,$4,$5,$6, now())
     ON CONFLICT (id) DO UPDATE SET email=$2, "displayName"=$3, phone=$4, "accountType"=$5, "businessName"=$6, "updatedAt"=now()`,
    [id, u.email, u.displayName, u.phone, u.account, u.businessName ?? null],
  )
}
// One storefront for the seller (ownerId is what the dashboard resolves by).
await db.query(`DELETE FROM "Seller" WHERE "ownerId" = $1 AND id <> $2`, [ids['e2e-seller@eno.vn'], SELLER_ID_ROW])
await db.query(
  `INSERT INTO "Seller" (id, name, "ownerId") VALUES ($1,$2,$3)
   ON CONFLICT (id) DO UPDATE SET name=$2, "ownerId"=$3`,
  [SELLER_ID_ROW, 'E2E Test Shop', ids['e2e-seller@eno.vn']],
)
// ── Offer fixture: a negotiable listing + a conversation carrying ONE pending buyer offer, so the
// authed "Counter" spec has something to act on. verified=false keeps the listing OFF the public feed
// (public needs verified=true AND status='active'); it's only reachable inside the conversation.
const LISTING_ID = 'e2e-listing-1'
const CONV_ID = 'e2e-conv-1'
const MSG_ID = 'e2e-offer-1'
const sellerPid = ids['e2e-seller@eno.vn']
const buyerPid = ids['e2e-buyer@eno.vn']
// status='active' is reset on re-seed so a mark-sold/relist test is idempotent.
await db.query(
  `INSERT INTO "Listing" (id, title, description, price, location, city, images, "categoryId", "sellerId", negotiable, verified, status, "updatedAt")
   VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9, true, false, 'active', now())
   ON CONFLICT (id) DO UPDATE SET price=$4, negotiable=true, verified=false, status='active', "updatedAt"=now()`,
  [LISTING_ID, 'E2E Test Item', 'Seeded listing for the authed offer/counter e2e.', 5_000_000, 'Bến Nghé', 'Thành phố Hồ Chí Minh', '["https://eno.vn/logo.svg"]', 'cmqubxrzh0005u3q4xuuwam5i', SELLER_ID_ROW],
)
await db.query(
  `INSERT INTO "Conversation" (id, "listingId", "buyerProfileId", "sellerId", "sellerProfileId", "lastMessageText")
   VALUES ($1,$2,$3,$4,$5,$6)
   ON CONFLICT (id) DO UPDATE SET "listingId"=$2, "buyerProfileId"=$3, "sellerId"=$4, "sellerProfileId"=$5`,
  [CONV_ID, LISTING_ID, buyerPid, SELLER_ID_ROW, sellerPid, 'Would you take 5,000,000?'],
)
// Re-runs must RESET the offer to pending (a prior test run may have countered/accepted it).
await db.query(
  `INSERT INTO "Message" (id, "conversationId", "senderProfileId", body, kind, "offerAmount", "offerStatus")
   VALUES ($1,$2,$3,$4,'offer',$5,'pending')
   ON CONFLICT (id) DO UPDATE SET "offerAmount"=$5, "offerStatus"='pending', kind='offer'`,
  [MSG_ID, CONV_ID, buyerPid, 'Would you take 5,000,000?', 4_500_000],
)

mkdirSync('e2e/.auth', { recursive: true })
writeFileSync('e2e/.auth/seed-fixtures.json', JSON.stringify({ conversationId: CONV_ID, listingId: LISTING_ID, offerAmount: 4_500_000 }, null, 2))

await db.end()
console.log('Seeded e2e users:\n' + Object.entries(ids).map(([e, id]) => `  ${e} = ${id}`).join('\n') + `\n  + offer fixture: conversation ${CONV_ID} (pending 4,500,000 from buyer)`)
