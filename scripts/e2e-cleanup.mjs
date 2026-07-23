// Remove every ephemeral e2e artifact seeded by scripts/e2e-seed.mjs (users + Profile + Seller +
// any listings/conversations they produced). Leaves zero trace. Safe to run anytime.
//
//   node --env-file=.env scripts/e2e-cleanup.mjs
import { createClient } from '@supabase/supabase-js'
import pg from 'pg'

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SECRET = process.env.SUPABASE_SECRET_KEY
const DIRECT = process.env.DIRECT_URL
if (!URL || !SECRET || !DIRECT) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SECRET_KEY / DIRECT_URL (run with node --env-file=.env)')
  process.exit(1)
}

const admin = createClient(URL, SECRET, { auth: { autoRefreshToken: false, persistSession: false } })
const db = new pg.Client({ connectionString: DIRECT })
await db.connect()

// Collect the profile ids first (before their auth.users rows vanish).
const { rows } = await db.query(`SELECT id FROM "Profile" WHERE email LIKE 'e2e-%@eno.vn'`)
const ids = rows.map((r) => r.id)
if (ids.length) {
  // Visa cases the applicant story (e2e/visa-authed.spec.ts) may have left behind on a
  // crash — visa_documents/events/payments/prefill_sessions all cascade off the row.
  // The spec is deliberately upload-free, so there are no storage objects to chase.
  await db.query(`DELETE FROM visa_applications WHERE user_id = ANY($1)`, [ids]).catch(() => {})
  // Children first (FKs). Conversations/Messages/Listings a test may have created.
  await db.query(`DELETE FROM "Message" WHERE "conversationId" IN (SELECT id FROM "Conversation" WHERE "buyerId" = ANY($1) OR "sellerId" IN (SELECT id FROM "Seller" WHERE "ownerId" = ANY($1)))`, [ids]).catch(() => {})
  await db.query(`DELETE FROM "Conversation" WHERE "buyerId" = ANY($1) OR "sellerId" IN (SELECT id FROM "Seller" WHERE "ownerId" = ANY($1))`, [ids]).catch(() => {})
  await db.query(`DELETE FROM "Listing" WHERE "sellerId" IN (SELECT id FROM "Seller" WHERE "ownerId" = ANY($1))`, [ids]).catch(() => {})
  await db.query(`DELETE FROM "Seller" WHERE "ownerId" = ANY($1)`, [ids]).catch(() => {})
  await db.query(`DELETE FROM "Profile" WHERE id = ANY($1)`, [ids]).catch(() => {})
}
await db.end()

// Then the auth users.
const { data: list } = await admin.auth.admin.listUsers({ page: 1, perPage: 200 })
let removed = 0
for (const u of list?.users ?? []) {
  if (u.email && /^e2e-.*@eno\.vn$/.test(u.email)) { await admin.auth.admin.deleteUser(u.id).catch(() => {}); removed++ }
}
console.log(`Cleaned up ${ids.length} profile(s) + ${removed} auth user(s).`)
