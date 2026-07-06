// End-to-end test of POST /api/account/delete against a local `next start` +
// the real DB, with EPHEMERAL users (cleaned up whatever happens).
import pg from 'pg'
import { createClient } from '@supabase/supabase-js'
import { createServerClient } from '@supabase/ssr'

const SUPA_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const PUB_KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
const SECRET = process.env.SUPABASE_SECRET_KEY
const BASE = 'http://localhost:3104'
const admin = createClient(SUPA_URL, SECRET, { auth: { autoRefreshToken: false, persistSession: false } })
const db = new pg.Client({ connectionString: process.env.DIRECT_URL })
await db.connect()

const stamp = Date.now() % 1e7
const emailA = `del-test-a-${stamp}@example.com`
const emailB = `del-test-b-${stamp}@example.com`
let uidA, uidB
const fail = (m) => { console.error('FAIL:', m); process.exitCode = 1 }

async function cookieHeaderFor(email) {
  const jar = []
  const supa = createServerClient(SUPA_URL, PUB_KEY, {
    cookies: { getAll: () => jar, setAll: (cs) => { for (const c of cs) jar.push({ name: c.name, value: c.value }) } },
  })
  const { data, error } = await admin.auth.admin.generateLink({ type: 'magiclink', email })
  if (error) throw new Error('generateLink: ' + error.message)
  const { error: v } = await supa.auth.verifyOtp({ type: 'email', token_hash: data.properties.hashed_token })
  if (v) throw new Error('verifyOtp: ' + v.message)
  return jar.map((c) => `${c.name}=${c.value}`).join('; ')
}

try {
  // ── Seed: A (deletee, seller) + B (counterparty buyer) ──
  uidA = (await admin.auth.admin.createUser({ email: emailA, email_confirm: true })).data.user.id
  uidB = (await admin.auth.admin.createUser({ email: emailB, email_confirm: true })).data.user.id
  await db.query(`INSERT INTO "Profile" (id, email, "updatedAt") VALUES ($1, $2, now()), ($3, $4, now())`, [uidA, emailA, uidB, emailB])
  const sellerId = 'sel-test-' + stamp
  await db.query(`INSERT INTO "Seller" (id, name, "ownerId") VALUES ($1, 'Delete Test Shop', $2)`, [sellerId, uidA])
  const { rows: [cat] } = await db.query(`SELECT id FROM "Category" WHERE slug = 'electronics' LIMIT 1`)
  const listingId = 'lst-test-' + stamp
  await db.query(
    `INSERT INTO "Listing" (id, title, description, price, location, city, images, "categoryId", "sellerId", "updatedAt")
     VALUES ($1, 'Test item', 'to be deleted', 100000, 'D1', 'Ho Chi Minh', '[]', $2, $3, now())`,
    [listingId, cat.id, sellerId])
  const convoId = 'cnv-test-' + stamp
  await db.query(
    `INSERT INTO "Conversation" (id, "listingId", "buyerProfileId", "sellerId", "sellerProfileId")
     VALUES ($1, $2, $3, $4, $5)`, [convoId, listingId, uidB, sellerId, uidA])
  await db.query(
    `INSERT INTO "Message" (id, "conversationId", "senderProfileId", body) VALUES
     ('msg-a-${stamp}', $1, $2, 'hello from A'), ('msg-b-${stamp}', $1, $3, 'hello from B')`,
    [convoId, uidA, uidB])
  const reportId = 'rep-test-' + stamp
  await db.query(
    `INSERT INTO "Report" (id, reason, status, "targetProfileId", "reporterProfileId") VALUES ($1, 'scam', 'open', $2, $3)`,
    [reportId, uidA, uidB])
  console.log('seeded A/B + listing + conversation + open report')

  const cookieA = await cookieHeaderFor(emailA)
  const post = (opts = {}) => fetch(`${BASE}/api/account/delete`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookieA, ...(opts.headers || {}) },
    body: JSON.stringify(opts.body ?? { confirm: 'DELETE' }),
  })

  // 1. Unauthenticated → 401
  const r1 = await fetch(`${BASE}/api/account/delete`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"confirm":"DELETE"}' })
  r1.status === 401 ? console.log('PASS 401 unauthenticated') : fail(`unauth got ${r1.status}`)
  // 2. Cross-origin → 403
  const r2 = await post({ headers: { Origin: 'https://evil.example' } })
  r2.status === 403 ? console.log('PASS 403 cross-origin') : fail(`cross-origin got ${r2.status}`)
  // 3. Missing confirmation → 400
  const r3 = await post({ body: {} })
  r3.status === 400 ? console.log('PASS 400 no confirmation') : fail(`no-confirm got ${r3.status}`)
  // 4. Open report → 409 investigation hold
  const r4 = await post()
  r4.status === 409 ? console.log('PASS 409 investigation hold (open report)') : fail(`open-report got ${r4.status}`)
  // 5. Resolve the report → deletion succeeds
  await db.query(`UPDATE "Report" SET status = 'dismissed' WHERE id = $1`, [reportId])
  const r5 = await post()
  r5.status === 200 ? console.log('PASS 200 delete') : fail(`delete got ${r5.status}: ${await r5.text()}`)

  // ── Verify state ──
  const q = async (sql, p) => (await db.query(sql, p)).rows[0].n
  const checks = [
    ['profile A gone', `SELECT count(*)::int n FROM "Profile" WHERE id = $1`, [uidA], 0],
    ['seller gone', `SELECT count(*)::int n FROM "Seller" WHERE id = $1`, [sellerId], 0],
    ['listing gone', `SELECT count(*)::int n FROM "Listing" WHERE id = $1`, [listingId], 0],
    ['conversation gone', `SELECT count(*)::int n FROM "Conversation" WHERE id = $1`, [convoId], 0],
    ['messages gone', `SELECT count(*)::int n FROM "Message" WHERE "conversationId" = $1`, [convoId], 0],
    ['counterparty B intact', `SELECT count(*)::int n FROM "Profile" WHERE id = $1`, [uidB], 1],
    ['resolved report retained', `SELECT count(*)::int n FROM "Report" WHERE id = $1`, [reportId], 1],
  ]
  for (const [label, sql, p, want] of checks) {
    const n = await q(sql, p)
    n === want ? console.log('PASS', label) : fail(`${label}: expected ${want}, got ${n}`)
  }
  const { data: gone } = await admin.auth.admin.getUserById(uidA)
  !gone?.user ? console.log('PASS auth user A removed') : fail('auth user A still exists')
} finally {
  // ── Cleanup everything the test created that survived ──
  await db.query(`DELETE FROM "Report" WHERE id LIKE 'rep-test-%'`)
  await db.query(`DELETE FROM "Listing" WHERE id LIKE 'lst-test-%'`)
  await db.query(`DELETE FROM "Seller" WHERE id LIKE 'sel-test-%'`)
  for (const uid of [uidA, uidB].filter(Boolean)) {
    await db.query(`DELETE FROM "Profile" WHERE id = $1`, [uid])
    await admin.auth.admin.deleteUser(uid).catch(() => {})
  }
  await db.end()
  console.log('cleanup done')
}
