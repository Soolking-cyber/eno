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
if (!url || !project || !rawCreds || !dataStore) { console.error('Set DIRECT_URL, GOOGLE_VERTEX_PROJECT, GOOGLE_VERTEX_CREDENTIALS, VERTEX_SEARCH_DATASTORE_ID'); process.exit(1) }

const credsJson = rawCreds.trim().startsWith('{') ? rawCreds : Buffer.from(rawCreds.trim(), 'base64').toString('utf8')
const auth = new GoogleAuth({ credentials: JSON.parse(credsJson), scopes: ['https://www.googleapis.com/auth/cloud-platform'], projectId: project })
const token = await auth.getAccessToken()
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
  ORDER BY l.id ASC`)
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
