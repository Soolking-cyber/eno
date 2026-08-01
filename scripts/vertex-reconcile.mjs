// Reconcile the Vertex AI Search branch against Postgres by DELETING documents that should
// not be there — the purge you can run without purge permission.
//
//   set -a; . ./.env; set +a; node scripts/vertex-reconcile.mjs            # dry run, prints only
//   set -a; . ./.env; set +a; node scripts/vertex-reconcile.mjs --apply    # actually deletes
//
// ── WHY THIS EXISTS ALONGSIDE vertex-backfill.mjs ────────────────────────────────────────
// The backfill imports with reconciliationMode INCREMENTAL, which upserts and never deletes,
// so it cannot remove a document whose listing is gone or was never allowed in. It tries to
// PURGE the whole branch first to compensate — but purging needs Discovery Engine ADMIN and
// the runtime service account only holds EDITOR, so in this project that call 403s and the
// script prints `purge skipped` and carries on. Measured 2026-08-01: it did exactly that,
// imported the correct 18 documents, and left the desk's 15 e-Visa/trip documents in place.
//
// Deleting one document at a time needs only EDITOR, which we have. So this script gets the
// same end state as a purge-and-reimport by subtraction instead: list what IS indexed, work
// out what SHOULD be, delete the difference.
//
// ⚠️ TWO CLASSES OF DOCUMENT GET REMOVED, AND ONLY ONE OF THEM IS COSMETIC.
//   · Stale listings — sold, hidden, deleted. Wrong answers from the AI concierge, no worse.
//   · DESK LISTINGS — the 14 e-Visa SKUs and the trip anchor. eno.vn is a licensed sàn TMĐT
//     that may not surface e-visa or itinerary services, and `ListingDoc` carries neither
//     sellerId nor subcategorySlug, so no Vertex-side filter can hide them after the fact.
//     Ingest-time exclusion (both ingests, since 2026-07-31) stops NEW ones landing; this is
//     what removes the ones already there. Until it runs, the only thing keeping them out of
//     eno.vn's answers is the live-table re-validation in /api/ai/concierge — a guard, not a
//     fix. See src/lib/edition-scope.ts.
//
// SAFE TO RE-RUN, AND SAFE TO GET WRONG: everything it deletes is derived from Postgres, so
// `node scripts/vertex-backfill.mjs` puts back anything removed in error. That is why the
// default is a dry run and not a refusal — look at the list, then pass --apply.
import pg from 'pg'
import { GoogleAuth } from 'google-auth-library'

const APPLY = process.argv.includes('--apply')

const url = process.env.DIRECT_URL || process.env.DATABASE_URL
const project = process.env.GOOGLE_VERTEX_PROJECT
const rawCreds = process.env.GOOGLE_VERTEX_CREDENTIALS
const location = process.env.VERTEX_SEARCH_LOCATION || 'global'
const dataStore = process.env.VERTEX_SEARCH_DATASTORE_ID
if (!url || !project || !rawCreds || !dataStore) {
  console.error('Set DIRECT_URL, GOOGLE_VERTEX_PROJECT, GOOGLE_VERTEX_CREDENTIALS, VERTEX_SEARCH_DATASTORE_ID')
  process.exit(1)
}

// ⚠️ THE UNION OF BOTH DESK VARS — byte-for-byte the block in scripts/vertex-backfill.mjs, for the
// reason stated at the query below: if the two predicates disagree, one script deletes what the
// other just wrote. deskSellerIds() in src/lib/edition-scope.ts resolves the same union in the app.
const DESK_OWNER_EMAILS = [
  ...(process.env.VISA_SHOP_OWNER_EMAIL || 'support@eno.forum').split(','),
  ...(process.env.TRIP_DESK_OWNER_EMAIL || 'support@eno.forum').split(','),
].map((e) => e.trim().toLowerCase()).filter(Boolean)
// Trimmed HERE because the SQL only lowercases and splits — it does not trim.
const DESK_OWNER_EMAIL_LIST = [...new Set(DESK_OWNER_EMAILS)].join(',')

const credsJson = rawCreds.trim().startsWith('{') ? rawCreds : Buffer.from(rawCreds.trim(), 'base64').toString('utf8')
const auth = new GoogleAuth({ credentials: JSON.parse(credsJson), scopes: ['https://www.googleapis.com/auth/cloud-platform'], projectId: project })
const token = await auth.getAccessToken()
const host = location === 'global' ? 'discoveryengine.googleapis.com' : `${location}-discoveryengine.googleapis.com`
const branch = `projects/${project}/locations/${location}/collections/default_collection/dataStores/${dataStore}/branches/default_branch`

async function call(path, method) {
  const res = await fetch(`https://${host}/v1/${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  })
  if (!res.ok) throw new Error(`${method} ${path.split('?')[0]} → ${res.status} ${(await res.text()).slice(0, 300)}`)
  return res.status === 204 ? null : res.json()
}

// ── 1. WHAT SHOULD BE INDEXED ────────────────────────────────────────────────────────────
// The predicate is a copy of the one in scripts/vertex-backfill.mjs and must stay identical:
// if the two disagree, this script deletes what that one just wrote and the next run puts it
// back, forever. Resolved by owner EMAIL rather than a hardcoded seller id, so a reseed that
// changes ids does not silently stop matching (the visa desk and the trip desk are the same
// Seller row — `Seller.ownerId` is @unique — so one address covers both).
const client = new pg.Client({ connectionString: url })
await client.connect()
const { rows } = await client.query(`
  SELECT l.id
  FROM "Listing" l
  LEFT JOIN "Seller" s ON s.id = l."sellerId"
  WHERE l.verified = true AND l.status = 'active'
    AND (s.id IS NULL OR s."ownerId" IS NULL OR s."ownerId" NOT IN (
      SELECT p.id FROM "Profile" p
      WHERE lower(p.email) = ANY (string_to_array(lower($1), ','))
    ))`,
  [DESK_OWNER_EMAIL_LIST])
await client.end()
const wanted = new Set(rows.map((r) => r.id))
console.log(`postgres: ${wanted.size} listings should be indexed`)

// ── 2. WHAT IS INDEXED ───────────────────────────────────────────────────────────────────
// documents.list caps pageSize at 1000 and paginates; the catalog is far smaller than that
// today, but paging is three lines and its absence would be a silent truncation later.
const indexed = []
let pageToken = ''
for (let page = 0; page < 50; page++) {
  const q = `${branch}/documents?pageSize=1000${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ''}`
  const data = await call(q, 'GET')
  for (const d of data?.documents ?? []) indexed.push(d.id ?? String(d.name ?? '').split('/').pop())
  pageToken = data?.nextPageToken ?? ''
  if (!pageToken) break
}
console.log(`vertex:   ${indexed.length} documents currently in the branch`)

// ── 3. THE DIFFERENCE ────────────────────────────────────────────────────────────────────
const orphans = indexed.filter((id) => id && !wanted.has(id))
const missing = [...wanted].filter((id) => !indexed.includes(id))

if (missing.length) {
  // Not this script's job to fix — it only deletes — but silence here would hide a broken
  // import behind a clean-looking reconcile.
  console.warn(`⚠️  ${missing.length} listing(s) missing from the index — run scripts/vertex-backfill.mjs`)
}

if (!orphans.length) {
  console.log('nothing to delete — index matches Postgres')
  process.exit(0)
}

console.log(`\n${orphans.length} document(s) to delete:`)
for (const id of orphans) console.log(`  ${id}`)

if (!APPLY) {
  console.log('\ndry run — nothing was deleted. Re-run with --apply to remove them.')
  process.exit(0)
}

// ── 4. DELETE ────────────────────────────────────────────────────────────────────────────
// Sequential on purpose: a few dozen documents, and a 429 from a burst would cost more than
// the seconds saved. A 404 is success — the document is already gone, which is the point.
let removed = 0
for (const id of orphans) {
  try {
    await call(`${branch}/documents/${encodeURIComponent(id)}`, 'DELETE')
    removed++
  } catch (e) {
    if (String(e.message).includes('404')) { removed++; continue }
    console.error(`  failed ${id}: ${String(e.message).slice(0, 160)}`)
  }
}
console.log(`\ndone — ${removed}/${orphans.length} removed`)
