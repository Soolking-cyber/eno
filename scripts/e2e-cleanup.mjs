// Remove every ephemeral e2e artifact seeded by scripts/e2e-seed.mjs (users + Profile + Seller +
// any listings/conversations they produced). Safe to run anytime.
//
//   node --env-file=.env scripts/e2e-cleanup.mjs
//
// ⚠️ THIS SCRIPT USED TO REPORT SUCCESS WHILE DELETING ALMOST NOTHING, and it put test data on
// the public homepage for nine days. Two defects compounded:
//   1. The Conversation predicates said `"buyerId"`. That column does not exist — it is
//      `"buyerProfileId"` — so both statements threw every single run.
//   2. Every statement ended in `.catch(() => {})`, so the throw was swallowed, and the
//      Seller/Profile deletes that FK-depend on the Conversation delete then failed the same
//      silent way. The script still printed "Cleaned up 3 profile(s)" and exited 0.
// Measured 2026-07-28: `e2e-listing-1` ("E2E Test Item", seller "E2E Test Shop") was live in the
// production catalogue since 07-27 and appeared THREE times in the homepage HTML, on a site whose
// real third-party supply is eighteen listings.
//
// So: errors are reported, never swallowed, and the run ENDS BY VERIFYING that nothing is left —
// a cleanup that cannot prove it cleaned is exactly the failure above wearing a success message.
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
// ⚠️ ORDER IS FK ORDER and each step is REPORTED. A failure here does not abort the run — the
// later steps may still be able to remove their own rows, and a partial clean beats none — but it
// is recorded and makes the process exit non-zero at the end.
const failures = []
async function step(label, sql) {
  try {
    const res = await db.query(sql, [ids])
    console.log(`  ${label}: ${res.rowCount} row(s)`)
  } catch (e) {
    failures.push(`${label}: ${e.message}`)
    console.error(`  ${label}: FAILED — ${e.message}`)
  }
}

// The Seller ids are resolved ONCE, up front, because every predicate below needs them and the
// Seller rows are themselves deleted partway through — a subquery would find nothing after that.
const SELLERS = `SELECT id FROM "Seller" WHERE "ownerId" = ANY($1)`

if (ids.length) {
  // Visa cases the applicant story (e2e/visa-authed.spec.ts) may have left behind on a
  // crash — visa_documents/events/payments/prefill_sessions all cascade off the row.
  // The spec is deliberately upload-free, so there are no storage objects to chase.
  await step('visa_applications', `DELETE FROM visa_applications WHERE user_id = ANY($1)`)
  // Children first (FKs). Conversations/Messages/Listings a test may have created.
  // ⚠️ "buyerProfileId", NOT "buyerId" — see the header. The wrong name threw on every run.
  await step('Message', `DELETE FROM "Message" WHERE "conversationId" IN (SELECT id FROM "Conversation" WHERE "buyerProfileId" = ANY($1) OR "sellerId" IN (${SELLERS}))`)
  await step('Conversation', `DELETE FROM "Conversation" WHERE "buyerProfileId" = ANY($1) OR "sellerId" IN (${SELLERS})`)
  await step('Listing', `DELETE FROM "Listing" WHERE "sellerId" IN (${SELLERS})`)
  await step('Seller', `DELETE FROM "Seller" WHERE "ownerId" = ANY($1)`)
  await step('Profile', `DELETE FROM "Profile" WHERE id = ANY($1)`)
}

// ⚠️ THE VERIFICATION IS THE POINT OF THIS SCRIPT, not a nicety. Without it the previous version
// could delete nothing and still say "Cleaned up 3 profile(s)". Anything still standing is named.
const leftovers = await db.query(`
  SELECT 'Profile' AS kind, id::text FROM "Profile" WHERE email LIKE 'e2e-%@eno.vn'
  UNION ALL SELECT 'Seller', s.id FROM "Seller" s JOIN "Profile" p ON p.id = s."ownerId" WHERE p.email LIKE 'e2e-%@eno.vn'
  UNION ALL SELECT 'Listing', l.id FROM "Listing" l JOIN "Seller" s ON s.id = l."sellerId" JOIN "Profile" p ON p.id = s."ownerId" WHERE p.email LIKE 'e2e-%@eno.vn'
`)
await db.end()

if (leftovers.rowCount > 0) {
  console.error(`\n⚠️  ${leftovers.rowCount} e2e artifact(s) STILL PRESENT — these are live in the catalogue:`)
  for (const r of leftovers.rows) console.error(`    ${r.kind} ${r.id}`)
}

// Then the auth users. Counted only when the delete actually succeeds — the old version
// incremented on every match and swallowed the error, which is how the summary line came to
// overstate what had happened.
const { data: list } = await admin.auth.admin.listUsers({ page: 1, perPage: 200 })
let removed = 0
for (const u of list?.users ?? []) {
  if (!u.email || !/^e2e-.*@eno\.vn$/.test(u.email)) continue
  const { error } = await admin.auth.admin.deleteUser(u.id)
  if (error) { failures.push(`auth user ${u.email}: ${error.message}`); console.error(`  auth ${u.email}: FAILED — ${error.message}`) }
  else removed++
}
console.log(`Cleaned up ${ids.length} profile(s) + ${removed} auth user(s).`)

// ⚠️ EXIT NON-ZERO ON ANY RESIDUE OR ANY FAILED STEP. `npm run e2e:cleanup` is called from the
// authed-e2e runbook; a silent partial clean is what left a test listing on the public homepage,
// so the only safe default is to be noisy and fail the command.
if (failures.length || leftovers.rowCount > 0) {
  console.error(`\nCleanup did NOT complete: ${failures.length} failed step(s), ${leftovers.rowCount} artifact(s) left.`)
  process.exit(1)
}
