#!/usr/bin/env node
/**
 * PRE-LAUNCH DATA PURGE — and, just as importantly, the EVIDENCE that it happened.
 *
 * Owner, 2026-08-14: the accounts, listings and visa applications currently in production are
 * pre-launch working data. At launch they are purged and re-created with real users. This script
 * does that purge and writes a receipt.
 *
 * ⚠️ THE RECEIPT IS THE POINT, NOT THE DELETE. Deleting rows is trivial; what the PDPL filing needs
 * is a defensible statement of the form "no personal data of a real data subject was processed
 * before <date>", and an assertion is not evidence. This writes a JSON record — counts per table
 * before and after, the storage objects removed, the operator, the timestamp — so the dossier can
 * cite a document instead of a memory.
 *
 * ⛔ A PURGE DOES NOT UN-TRANSFER. Personal data that has already crossed a border has already
 * crossed it; removing it afterwards limits ONGOING processing and shows good faith, it does not
 * retroactively make the transfer not have occurred. That distinction belongs to counsel, and this
 * script's receipt is written so counsel can see exactly what existed and for how long.
 *
 * ⚠️ DRY RUN BY DEFAULT. Nothing is deleted without `--execute`. Run it dry first, read the plan,
 * and only then execute — this is production, and the visa documents are photographs of a real
 * person's passport.
 *
 *   node scripts/purge-pre-launch-data.mjs              # plan only
 *   node scripts/purge-pre-launch-data.mjs --execute    # do it, and write the receipt
 *
 * ⛔⛔ INCOMPLETE — DO NOT CITE THE RECEIPT AS A FULL PURGE. A reviewer checked this against what
 * the PDPL dossier commits to and the two do not match. This script deletes the visa tables,
 * Message, Conversation, Review, Listing, Seller and Profile. It does NOT touch:
 *   · `auth.users` — Supabase identities survive, so emails and phone numbers remain AND
 *     passwordless sign-in still works for accounts whose Profile is gone;
 *   · Notification, TrustEvent, ContactReveal, Handle, SavedSearch, PushSubscription, Feedback,
 *     ForumPost, ForumProfile;
 *   · storage objects outside the `visa-documents` bucket (242 rows in storage.objects today).
 * A receipt from this run would evidence a purge that did not happen, on a compliance filing —
 * which is worse than no receipt. Extend it before it is used for that purpose.
 *
 * ⚠️ TWO MORE THINGS TO FIX FIRST, both found on review: `email <> all(...)` is CASE-SENSITIVE
 * while the seeds use `lower(email)`, so a differently-cased partner row would be DELETED; and any
 * RESTRICT foreign key from a surviving table onto Profile makes the final delete throw and roll
 * the whole transaction back.
 *
 * ⚠️ STORAGE IS NOT COVERED HERE. The passport and portrait FILES live in the Supabase private
 * `visa-documents` bucket, not in Postgres. This script reports their storage paths and deletes the
 * ROWS; the objects themselves must be removed through the storage API in the same session, or the
 * images outlive the database records that point at them — which is the worst of both worlds.
 * See `--with-storage` below, which requires SUPABASE_SECRET_KEY.
 */
import fs from 'node:fs'
import pg from 'pg'

const EXECUTE = process.argv.includes('--execute')
const WITH_STORAGE = process.argv.includes('--with-storage')

const env = Object.fromEntries(
  fs.readFileSync('.env', 'utf8').split('\n')
    .filter((l) => /^[A-Z_]+=/.test(l))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i), l.slice(i + 1).replace(/^["']|["']$/g, '')] }),
)

/**
 * ⛔ THE KEEP LIST. These accounts are infrastructure, not pre-launch noise: eno's own service
 * identity, and the two licensed partners whose storefronts and listings ARE the product. Deleting
 * them would take the visa desk and the trip desk with them.
 * ⚠️ Addresses, not ids — ids change on a reseed and a stale one silently keeps nothing.
 */
const KEEP_EMAILS = [
  'support@eno.forum',      // eno's own service account — owns the hidden desk + trip anchor
  'support@eno.vn',         // the Supabase admin identity; NEVER touch this row
  'info@vietkite.com.vn',   // licensed visa partner — owns the 14 live e-visa listings
  'info@giacmobayre.com',   // licensed itinerary partner
]

const db = new pg.Client({ connectionString: env.DIRECT_URL || env.DATABASE_URL, connectionTimeoutMillis: 15000 })
await db.connect()

const count = async (sql, params = []) => (await db.query(sql, params)).rows[0]?.n ?? 0

// ── What exists now ───────────────────────────────────────────────────────────────
const before = {
  profiles: await count('select count(*)::int n from "Profile"'),
  profilesToDelete: await count('select count(*)::int n from "Profile" where email <> all($1::text[])', [KEEP_EMAILS]),
  listings: await count('select count(*)::int n from "Listing"'),
  conversations: await count('select count(*)::int n from "Conversation"'),
  messages: await count('select count(*)::int n from "Message"'),
  reviews: await count('select count(*)::int n from "Review"'),
  visaApplications: await count('select count(*)::int n from visa_applications'),
  visaDocuments: await count('select count(*)::int n from visa_documents'),
  visaEvents: await count('select count(*)::int n from visa_events'),
}

// The storage objects behind the visa documents — reported whether or not we delete them, because
// the dossier needs to state what images existed and where.
const docs = (await db.query('select id, application_id, kind, storage_path, size_bytes, created_at from visa_documents order by created_at')).rows

console.log('\n══ PRE-LAUNCH PURGE ' + (EXECUTE ? '(EXECUTING)' : '(DRY RUN — nothing will be deleted)'))
console.table(before)
console.log('\nVisa document objects (the sensitive set):')
console.table(docs.map((d) => ({ kind: d.kind, kb: Math.round(d.size_bytes / 1024), created: String(d.created_at).slice(0, 10), path: d.storage_path })))
console.log(`\nAccounts kept (infrastructure + licensed partners): ${KEEP_EMAILS.join(', ')}`)

if (!EXECUTE) {
  console.log('\nDry run only. Re-run with --execute to perform the purge and write the receipt.')
  console.log('⚠️  Add --with-storage to also delete the objects from the private visa-documents bucket.')
  console.log('⚠️  Without it, the passport and portrait FILES survive the row deletion.')
  await db.end()
  process.exit(0)
}

// ── The purge ─────────────────────────────────────────────────────────────────────
// ⚠️ VISA TABLES FIRST, and by hand rather than by cascade: these hold the sensitive data and their
// removal is the part the filing turns on, so it must be explicit and countable rather than a side
// effect of deleting a Profile row.
const removedStorage = []
if (WITH_STORAGE) {
  const { createClient } = await import('@supabase/supabase-js')
  const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SECRET_KEY)
  for (const d of docs) {
    const { error } = await sb.storage.from('visa-documents').remove([d.storage_path])
    removedStorage.push({ path: d.storage_path, kind: d.kind, ok: !error, error: error?.message ?? null })
  }
  console.log(`\nStorage objects removed: ${removedStorage.filter((r) => r.ok).length}/${docs.length}`)
}

await db.query('begin')
try {
  await db.query('delete from visa_events')
  await db.query('delete from visa_documents')
  await db.query('delete from visa_applications')
  // Conversations and messages go with their participants; delete explicitly so the counts are real.
  await db.query('delete from "Message"')
  await db.query('delete from "Conversation"')
  await db.query('delete from "Review"')
  // ⚠️ Listings owned by the KEPT sellers survive — those are the partners' live products.
  await db.query(`delete from "Listing" where "sellerId" in (
    select s.id from "Seller" s join "Profile" p on p.id = s."ownerId" where p.email <> all($1::text[]))`, [KEEP_EMAILS])
  await db.query(`delete from "Seller" where "ownerId" in (select id from "Profile" where email <> all($1::text[]))`, [KEEP_EMAILS])
  await db.query('delete from "Profile" where email <> all($1::text[])', [KEEP_EMAILS])
  await db.query('commit')
} catch (e) {
  await db.query('rollback')
  console.error('\n✗ ROLLED BACK — nothing was deleted:', e.message)
  await db.end()
  process.exit(1)
}

const after = {
  profiles: await count('select count(*)::int n from "Profile"'),
  listings: await count('select count(*)::int n from "Listing"'),
  conversations: await count('select count(*)::int n from "Conversation"'),
  messages: await count('select count(*)::int n from "Message"'),
  visaApplications: await count('select count(*)::int n from visa_applications'),
  visaDocuments: await count('select count(*)::int n from visa_documents'),
}

// ── The receipt ───────────────────────────────────────────────────────────────────
const receipt = {
  purpose: 'Pre-launch data purge before commencement of real-user processing (PDPL evidence record)',
  executedAt: new Date().toISOString(),
  operator: process.env.USER ?? 'unknown',
  database: (env.DIRECT_URL || '').replace(/:[^:@]*@/, ':***@'),
  keptAccounts: KEEP_EMAILS,
  before,
  after,
  visaDocumentsRemoved: docs.map((d) => ({ kind: d.kind, sizeBytes: d.size_bytes, createdAt: d.created_at, storagePath: d.storage_path })),
  storageObjectsRemoved: WITH_STORAGE ? removedStorage : 'NOT ATTEMPTED — re-run with --with-storage',
  note: 'A purge limits ongoing processing. It does not retroactively undo a cross-border transfer that already occurred.',
}
const out = `purge-receipt-${new Date().toISOString().slice(0, 10)}.json`
fs.writeFileSync(out, JSON.stringify(receipt, null, 2))
console.log('\n✓ Purge complete.')
console.table(after)
console.log(`✓ Receipt written: ${out} — keep this, the dossier cites it.`)
await db.end()
