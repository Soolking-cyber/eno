// Re-runnable backfill of the Vertex AI Search data store (the AI concierge's catalog,
// the surface that draws the "GenAI App Builder" credit — see docs/vertex-search-setup.md).
// PURGES the branch first, then re-imports every public listing, so stale docs (delisted
// listings, outdated trust scores) never linger. Run after a DB reset, a trust backfill,
// or any bulk listing change:
//
//   set -a; . ./.env; set +a; node scripts/vertex-backfill.mjs
//
// Uses raw pg + REST (not src/lib — scripts convention). PUBLIC fields only, mirror of
// listingToDoc in src/lib/vertex-search.ts — keep the two in sync.
import pg from 'pg'
import { GoogleAuth } from 'google-auth-library'

const url = process.env.DIRECT_URL || process.env.DATABASE_URL
const project = process.env.GOOGLE_VERTEX_PROJECT
const rawCreds = process.env.GOOGLE_VERTEX_CREDENTIALS
const location = process.env.VERTEX_SEARCH_LOCATION || 'global'
const dataStore = process.env.VERTEX_SEARCH_DATASTORE_ID
// ⚠️ A KEY IS NO LONGER OBTAINABLE, SO THIS ACCEPTS A BEARER TOKEN INSTEAD. The data store moved
// to project speedy-victory-500106-h8 on 2026-08-02, and that project enforces
// `constraints/iam.disableServiceAccountKeyCreation` — `gcloud iam service-accounts keys create`
// fails there with FAILED_PRECONDITION, so GOOGLE_VERTEX_CREDENTIALS cannot be produced at all.
// An operator runs this with their OWN gcloud identity instead:
//   GOOGLE_VERTEX_ACCESS_TOKEN=$(gcloud auth print-access-token --account=support@eno.forum)
// The token is short-lived (~1h) and never written anywhere, which is strictly better than a
// long-lived key on a laptop. GOOGLE_VERTEX_CREDENTIALS still works for any environment that has
// one; the app itself uses ADC (see src/lib/vertex-search.ts).
const staticToken = process.env.GOOGLE_VERTEX_ACCESS_TOKEN
if (!url || !project || (!rawCreds && !staticToken) || !dataStore) {
  console.error('Set DIRECT_URL, GOOGLE_VERTEX_PROJECT, VERTEX_SEARCH_DATASTORE_ID, and one of GOOGLE_VERTEX_ACCESS_TOKEN / GOOGLE_VERTEX_CREDENTIALS')
  process.exit(1)
}

// The desk's owner addresses, as ONE comma-separated string for the query below.
//
// ⚠️ THE UNION OF BOTH DESK VARS, matching deskSellerIds() in src/lib/edition-scope.ts. They
// default to the same address and resolve to the same Seller row today (Seller.ownerId is @unique,
// so one support account owns one storefront and both features hang off it) — but the two env vars
// are independent, and reading only the visa one meant that setting TRIP_DESK_OWNER_EMAIL to a
// separate address would silently re-import the trip desk here while the app excluded it. Same
// list, same order, in scripts/vertex-reconcile.mjs; the two predicates must stay identical or each
// run undoes the other.
const DESK_OWNER_EMAILS = [
  ...(process.env.VISA_SHOP_OWNER_EMAIL || 'support@eno.forum').split(','),
  ...(process.env.TRIP_DESK_OWNER_EMAIL || 'support@eno.forum').split(','),
].map((e) => e.trim().toLowerCase()).filter(Boolean)
// Trimmed HERE because the SQL only lowercases and splits — it does not trim.
const DESK_OWNER_EMAIL_LIST = [...new Set(DESK_OWNER_EMAILS)].join(',')

let token = staticToken
if (!token) {
  const credsJson = rawCreds.trim().startsWith('{') ? rawCreds : Buffer.from(rawCreds.trim(), 'base64').toString('utf8')
  const auth = new GoogleAuth({ credentials: JSON.parse(credsJson), scopes: ['https://www.googleapis.com/auth/cloud-platform'], projectId: project })
  token = await auth.getAccessToken()
}
const host = location === 'global' ? 'discoveryengine.googleapis.com' : `${location}-discoveryengine.googleapis.com`
const branch = `projects/${project}/locations/${location}/collections/default_collection/dataStores/${dataStore}/branches/default_branch`

async function call(path, method, body) {
  const res = await fetch(`https://${host}/v1/${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  })
  if (!res.ok) throw new Error(`${method} ${path.split('?')[0]} → ${res.status} ${(await res.text()).slice(0, 300)}`)
  return res.json()
}

// 1. Purge everything — the import below repopulates; INCREMENTAL alone can't drop
// documents for listings that were sold/hidden/deleted since the last run. Best-effort:
// the runtime SA's discoveryengine.editor role can't purge (needs admin), so when this
// 403s, purge manually first (`gcloud auth print-access-token` as the project owner)
// and let the import continue — it still refreshes every currently-active listing.
try {
  const purge = await call(`${branch}/documents:purge`, 'POST', { filter: '*', force: true })
  console.log('purge started:', purge.name || JSON.stringify(purge).slice(0, 120))
  // Purge is an ASYNC operation — importing before it finishes lets it delete the fresh
  // docs. Poll the operation until done (bounded), then import.
  if (purge.name) {
    for (let i = 0; i < 24; i++) {
      await new Promise((r) => setTimeout(r, 5000))
      const op = await call(purge.name, 'GET')
      if (op.done) { console.log('purge complete'); break }
      if (i === 23) console.warn('purge still running after 2 min — importing anyway; re-run if docs look missing')
    }
  }
} catch (e) {
  console.warn(`purge skipped (${String(e.message).slice(0, 80)}…) — stale docs for delisted listings may linger`)
}

// 2. Stream all public listings out of Postgres and inline-import in chunks of 100.
const client = new pg.Client({ connectionString: url })
await client.connect()
const { rows } = await client.query(`
  SELECT l.id, l.title, l."titleVi", l.description, l."brandSlug", l.model, l.price,
         l.currency, l.district, l.city AS province, NULL AS ward, l.condition, l."listingType",
         l.featured, l."postedAt", c.slug AS "categorySlug", c.name AS "categoryName",
         s."trustScore"
  FROM "Listing" l
  LEFT JOIN "Category" c ON c.id = l."categoryId"
  LEFT JOIN "Seller"   s ON s.id = l."sellerId"
  WHERE l.verified = true AND l.status = 'active'
    -- ⚠️ THE DESK IS EXCLUDED AT INGEST, BECAUSE NO VERTEX-SIDE FILTER CAN DO IT LATER.
    -- eno.vn is a licensed sàn TMĐT and may not surface e-visa or itinerary services, but the
    -- ListingDoc schema below carries neither sellerId nor subcategorySlug — so buildFilter() is
    -- structurally incapable of expressing the exclusion, and a code fix in the app leaves the
    -- documents sitting in the index. The only enforcement inside a request is the live-table
    -- re-validation in /api/ai/concierge; this keeps them out of the index in the first place.
    --
    -- Resolved by owner email, matching src/lib/visa-shop.ts and src/lib/trips/dm-thread.ts, rather
    -- than by a hardcoded seller id that would silently stop matching after a reseed.
    AND (s.id IS NULL OR s."ownerId" IS NULL OR s."ownerId" NOT IN (
      SELECT p.id FROM "Profile" p
      WHERE lower(p.email) = ANY (string_to_array(lower($1), ','))
    ))
  ORDER BY l.id ASC`,
  [DESK_OWNER_EMAIL_LIST])
await client.end()
console.log(`importing ${rows.length} listings…`)

const toDoc = (l) => ({
  id: l.id, title: l.title, titleVi: l.titleVi ?? null, description: l.description ?? null,
  categorySlug: l.categorySlug ?? null, categoryName: l.categoryName ?? null,
  brandSlug: l.brandSlug ?? null, model: l.model ?? null,
  price: l.price == null ? null : Number(l.price), currency: l.currency ?? null,
  district: l.district ?? null, province: l.province ?? null, ward: l.ward ?? null,
  condition: l.condition ?? null, listingType: l.listingType ?? null,
  trustScore: l.trustScore == null ? null : Number(l.trustScore), featured: !!l.featured,
  postedAt: l.postedAt ? new Date(l.postedAt).getTime() : null,
})

let submitted = 0
for (let i = 0; i < rows.length; i += 100) {
  const chunk = rows.slice(i, i + 100).map(toDoc)
  await call(`${branch}/documents:import`, 'POST', {
    inlineSource: { documents: chunk.map((d) => ({ id: d.id, jsonData: JSON.stringify(d) })) },
    reconciliationMode: 'INCREMENTAL',
  })
  submitted += chunk.length
  process.stdout.write(`\r${submitted}/${rows.length}`)
  await new Promise((r) => setTimeout(r, 250))
}
console.log(`\ndone — ${submitted} documents submitted (indexing continues server-side for a few minutes)`)
