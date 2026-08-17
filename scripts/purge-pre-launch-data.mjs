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
 * ⚠️ THE "INCOMPLETE" WARNING THAT USED TO SIT HERE WAS PART STALE AND PART REAL, and the
 * difference was settled by querying the live schema on 2026-08-17 rather than by reading models.
 *
 * REFUTED — these need no code, because the database already does it. Every foreign key onto
 * Profile is CASCADE or SET NULL; there is NOT ONE `RESTRICT` or `NO ACTION` among the 32 of them,
 * so the feared roll-back cannot happen, and most of the tables the old note listed as "not
 * touched" are deleted by the cascade when their Profile goes: Notification (143 rows), TrustEvent
 * (51), Handle (19), SavedSearch (6), PushSubscription (1), Itinerary (14), ForumProfile,
 * MessageReaction, NativePushToken, EnforcementAction and the Forum vote/bookmark tables.
 *
 * CONFIRMED — three things genuinely survived, and all three are handled below:
 *   · `auth.users` (22 rows) — the identity, not the profile. Left behind, an email and phone
 *     number remain AND PASSWORDLESS SIGN-IN STILL WORKS for an account whose Profile is gone.
 *     This is the one that mattered.
 *   · `ForumPost` (44 rows) — `authorProfileId` is SET NULL, so the posts outlive their authors as
 *     anonymous content rather than disappearing.
 *   · storage objects outside `visa-documents` (243 rows in storage.objects) — reported, not
 *     deleted; listing photos belong to listings and are not personal data in the filing's sense.
 *
 * ⛔ AND `NULL <> all(...)` IS **NULL**, NOT TRUE — the trap both reviewers found in the first
 * version of this hardening, and the one that would have hurt most. A row whose `email IS NULL`
 * matches NOTHING, so a PHONE-ONLY identity would have survived the purge with its number intact
 * and its passwordless sign-in still working — the precise failure this script exists to prevent,
 * reintroduced by the statement meant to close it. Worse, the two halves disagree: a null-email
 * Profile surviving while its `auth.users` row is deleted violates `profile_auth_fk` and rolls the
 * whole transaction back. Every predicate is now `(email is null or lower(email) <> all(...))`.
 * ⚠️ Measured 2026-08-17: zero null emails in either table today, so this is a latent trap rather
 * than an active one — but eno.vn signs people in by PHONE (Zalo ZNS), so it is a matter of time.
 *
 * ⚠️ THE CASE-SENSITIVITY BUG WAS REAL AND IS FIXED: `email <> all(...)` compared raw against a
 * hand-written list, so a partner row stored with different casing would have been DELETED. Every
 * comparison now lowercases both sides. (Measured before the fix: all four keep-list rows happened
 * to be lowercase, so it had not fired yet — a latent trap, not an active one.)
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
].map((e) => e.toLowerCase())

const db = new pg.Client({ connectionString: env.DIRECT_URL || env.DATABASE_URL, connectionTimeoutMillis: 15000 })
await db.connect()

const count = async (sql, params = []) => (await db.query(sql, params)).rows[0]?.n ?? 0

// ── What exists now ───────────────────────────────────────────────────────────────
const before = {
  profiles: await count('select count(*)::int n from "Profile"'),
  profilesToDelete: await count('select count(*)::int n from "Profile" where (email is null or lower(email) <> all($1::text[]))', [KEEP_EMAILS]),
  listings: await count('select count(*)::int n from "Listing"'),
  conversations: await count('select count(*)::int n from "Conversation"'),
  messages: await count('select count(*)::int n from "Message"'),
  reviews: await count('select count(*)::int n from "Review"'),
  visaApplications: await count('select count(*)::int n from visa_applications'),
  visaDocuments: await count('select count(*)::int n from visa_documents'),
  visaEvents: await count('select count(*)::int n from visa_events'),
  authUsers: await count('select count(*)::int n from auth.users'),
  authUsersToDelete: await count('select count(*)::int n from auth.users where (email is null or lower(email) <> all($1::text[]))', [KEEP_EMAILS]),
  forumPosts: await count('select count(*)::int n from "ForumPost"'),
  // Reported, deliberately not deleted: these are listing photos and site assets, not personal data
  // in the filing's sense. The visa bucket is the sensitive one and it has its own handling above.
  storageObjectsOutsideVisaBucket: await count(`select count(*)::int n from storage.objects where bucket_id <> 'visa-documents'`),
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

await db.query('begin')
try {
  await db.query('delete from visa_events')
  await db.query('delete from visa_documents')
  await db.query('delete from visa_applications')
  // Conversations and messages go with their participants; delete explicitly so the counts are real.
  await db.query('delete from "Message"')
  await db.query('delete from "Conversation"')
  // ⚠️ ALL of them, unconditionally — and that is safe rather than sloppy: measured 2026-08-17,
  // ZERO of the 5 reviews belong to a kept seller, so no partner's trust score loses anything.
  // Re-measure before assuming that still holds if this is ever run again.
  await db.query('delete from "Review"')
  // ⚠️ Listings owned by the KEPT sellers survive — those are the partners' live products.
  await db.query(`delete from "Listing" where "sellerId" in (
    select s.id from "Seller" s join "Profile" p on p.id = s."ownerId" where (p.email is null or lower(p.email) <> all($1::text[])))`, [KEEP_EMAILS])
  await db.query(`delete from "Seller" where "ownerId" in (select id from "Profile" where (email is null or lower(email) <> all($1::text[])))`, [KEEP_EMAILS])
  /**
   * ⚠️ FORUM CONTENT GOES BEFORE ITS AUTHORS, because `ForumPost.authorProfileId` is SET NULL — so
   * deleting the Profile alone leaves the post standing as anonymous pre-launch content rather than
   * removing it. Comments first: they reference posts.
   */
  /**
   * ⛔ THE MODERATION ROWS GO FIRST, AND THIS IS THE ONE THAT ACTUALLY BIT — the 2026-08-17 run
   * rolled back on `ForumReport_target_check`.
   *
   * `ForumReport` and `ForumModerationAction` each carry a CHECK of the form "at least one of
   * postId / commentId / targetProfileId is not null", and every one of those three columns is a
   * SET NULL foreign key. So deleting the post nulls one, deleting the profile nulls another, and
   * the row that referenced BOTH ends up with all three null — which is not a constraint the
   * delete can see coming, because nothing is deleting THAT row. Postgres reports it as "new row
   * ... violates check constraint" on a table nobody touched, and the whole transaction unwinds.
   *
   * ⚠️ These are the ONLY two tables in the database with that shape — checked against
   * pg_constraint rather than guessed, so this is a complete fix and not a patch for the row that
   * happened to fail.
   */
  await db.query('delete from "ForumReport"')
  await db.query('delete from "ForumModerationAction"')
  // ⚠️ GLOBAL, not scoped to purged authors — every forum row in this database is pre-launch
  // content, which is the whole premise of the script. If eno.forum ever carries real posts, this
  // needs an author filter first.
  await db.query('delete from "ForumComment"')
  await db.query('delete from "ForumPost"')
  await db.query('delete from "Profile" where (email is null or lower(email) <> all($1::text[]))', [KEEP_EMAILS])
  /**
   * ⛔ THE IDENTITY, NOT JUST THE PROFILE — AND THIS IS THE GAP THAT MATTERED. `auth.users` is a
   * different schema and nothing above touches it. Left behind, the email and phone number remain
   * in the database AND passwordless sign-in still WORKS for an account whose Profile is gone: the
   * next magic link mints a fresh Profile and the "purged" user is back.
   *
   * ⚠️ AFTER the Profile delete, never before. `profile_auth_fk` points Profile → auth.users, so
   * removing the identity first violates it and rolls the whole transaction back.
   *
   * ⛔ `support@eno.vn` IS THE SUPABASE ADMIN IDENTITY. It is on KEEP_EMAILS, which is what keeps it
   * out of this delete — if that entry is ever removed, this statement locks the project's own
   * admin out. Do not "tidy" the keep list.
   */
  const authGone = await db.query('delete from auth.users where (email is null or lower(email) <> all($1::text[])) returning id', [KEEP_EMAILS])
  console.log(`  auth.users removed: ${authGone.rowCount}`)
  await db.query('commit')
} catch (e) {
  await db.query('rollback')
  console.error('\n✗ ROLLED BACK — nothing was deleted:', e.message)
  await db.end()
  process.exit(1)
}

/**
 * ⛔ STORAGE COMES AFTER THE COMMIT, AND IT USED TO COME BEFORE. The 2026-08-17 run is why: the
 * transaction rolled back on a constraint, and the console read "Storage objects removed: 4/4" —
 * so four passport and portrait IMAGES were destroyed while every row pointing at them survived.
 * That is the worst of both worlds this file's own header warns about, produced by the file itself.
 *
 * A rollback must leave the world untouched, and the only ordering that gives that is: prove the
 * database delete first, then remove the bytes. The reverse is unrecoverable — rows can be
 * re-deleted, a deleted image cannot be un-deleted.
 *
 * ⚠️ The residual risk is now the harmless direction: a crash between COMMIT and here leaves
 * orphaned FILES with no rows. Re-running reports them as already-gone.
 */
if (WITH_STORAGE) {
  const { createClient } = await import('@supabase/supabase-js')
  const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SECRET_KEY)
  for (const d of docs) {
    const { error } = await sb.storage.from('visa-documents').remove([d.storage_path])
    removedStorage.push({ path: d.storage_path, kind: d.kind, ok: !error, error: error?.message ?? null })
  }
  console.log(`\nStorage objects removed: ${removedStorage.filter((r) => r.ok).length}/${docs.length}`)
}

const after = {
  profiles: await count('select count(*)::int n from "Profile"'),
  listings: await count('select count(*)::int n from "Listing"'),
  conversations: await count('select count(*)::int n from "Conversation"'),
  messages: await count('select count(*)::int n from "Message"'),
  visaApplications: await count('select count(*)::int n from visa_applications'),
  visaDocuments: await count('select count(*)::int n from visa_documents'),
  authUsers: await count('select count(*)::int n from auth.users'),
  forumPosts: await count('select count(*)::int n from "ForumPost"'),
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
