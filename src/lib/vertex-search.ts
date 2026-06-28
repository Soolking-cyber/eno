import 'server-only'
import { GoogleAuth } from 'google-auth-library'

// Vertex AI Search (Discovery Engine) — the eno listings catalog data store.
//
// THIS is the engine that draws the "GenAI App Builder" trial credit: catalog search
// + generated summaries bill under the "Vertex AI Search & Conversation" SKUs the
// credit covers. (The Gemini API is NOT covered — that's why the AI concierge runs its
// reasoning here, not on Gemini.) See docs/vertex-search-setup.md to stand up the data
// store + search app and wire the env below.
//
// Every export is env-gated and wrapped so it returns null / no-ops when the data
// store isn't configured yet — the concierge then falls back to Postgres search (which
// does NOT draw the credit) so the UI keeps working during setup.
//
// Env (reuses the Vertex SA creds from the Gemini setup):
//   GOOGLE_VERTEX_PROJECT       — GCP project id (the credit's billing account)
//   GOOGLE_VERTEX_CREDENTIALS   — SA JSON (raw or base64), needs Discovery Engine access
//   VERTEX_SEARCH_LOCATION      — data store location: "global" (default), "us", "eu"
//   VERTEX_SEARCH_DATASTORE_ID  — the data store id
//   VERTEX_SEARCH_ENGINE_ID     — (optional) search app/engine id; required for the
//                                 generated summary (set it once the app has LLM features)

const PROJECT = process.env.GOOGLE_VERTEX_PROJECT
const LOCATION = process.env.VERTEX_SEARCH_LOCATION || 'global'
const DATASTORE = process.env.VERTEX_SEARCH_DATASTORE_ID
const ENGINE = process.env.VERTEX_SEARCH_ENGINE_ID
const RAW_CREDS = process.env.GOOGLE_VERTEX_CREDENTIALS

export function vertexConfigured(): boolean {
  return !!(PROJECT && RAW_CREDS && (DATASTORE || ENGINE))
}

const HOST = LOCATION === 'global' ? 'discoveryengine.googleapis.com' : `${LOCATION}-discoveryengine.googleapis.com`
const COLLECTION = `projects/${PROJECT}/locations/${LOCATION}/collections/default_collection`
const SERVING_CONFIG = ENGINE
  ? `${COLLECTION}/engines/${ENGINE}/servingConfigs/default_search`
  : `${COLLECTION}/dataStores/${DATASTORE}/servingConfigs/default_search`
const DOC_PARENT = `${COLLECTION}/dataStores/${DATASTORE}/branches/default_branch`

let auth: GoogleAuth | null | undefined
let token: { value: string; exp: number } | null = null

function getAuth(): GoogleAuth | null {
  if (auth !== undefined) return auth
  try {
    if (!RAW_CREDS) { auth = null; return null }
    const json = RAW_CREDS.trim().startsWith('{') ? RAW_CREDS : Buffer.from(RAW_CREDS.trim(), 'base64').toString('utf8')
    const credentials = JSON.parse(json)
    auth = new GoogleAuth({ credentials, scopes: ['https://www.googleapis.com/auth/cloud-platform'], projectId: PROJECT })
  } catch (e) {
    console.error('[vertex-search] bad credentials', e)
    auth = null
  }
  return auth
}

async function accessToken(now: number): Promise<string | null> {
  if (token && token.exp > now + 60_000) return token.value
  const a = getAuth()
  if (!a) return null
  const t = await a.getAccessToken()
  if (!t) return null
  // SA tokens last ~1h; cache for 50 min (we pass `now` since Date.now is fine server-side).
  token = { value: t, exp: now + 50 * 60_000 }
  return t
}

async function call(path: string, method: string, body?: unknown): Promise<any | null> {
  const t = await accessToken(Date.now())
  if (!t) return null
  const res = await fetch(`https://${HOST}/v1/${path}`, {
    method,
    headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  })
  if (!res.ok) {
    console.error('[vertex-search]', method, path.split('?')[0], res.status, (await res.text()).slice(0, 300))
    return null
  }
  return res.json()
}

export type SearchFilters = { categorySlug?: string | null; minPriceVnd?: number | null; maxPriceVnd?: number | null; take?: number; lang?: 'en' | 'vi' }

// The AI concierge's voice: eno's friendly, trustworthy SHIELD mascot. This preamble
// is prepended to Vertex's answer generation so replies sound like a warm guardian who
// helps you shop AND keeps you safe — not a document-QA bot.
const CONCIERGE_PREAMBLE = `You are eno, the friendly shield mascot of eno.vn, a trusted marketplace in Vietnam. Reply with ONE short, warm sentence in the shopper's language (English or Vietnamese). Your sentence only gives a cheerful intro to the results, or kindly says nothing matched and offers to broaden the search. NEVER state any listing's price, location, trust score, dates, IDs, category, condition, or status — the product cards already show all of that, so don't repeat it. Good examples: "Here are some great motorbikes for you!" or "I couldn't find a BMW right now — want me to look at other cars?". eno keeps shoppers safe: higher-trust sellers rank first and fakes get reported. Never invent anything, and never sound robotic or mention "sources", "documents", or "context".`

function buildFilter(f: SearchFilters): string | undefined {
  const parts: string[] = []
  if (f.categorySlug) parts.push(`categorySlug: ANY("${f.categorySlug.replace(/"/g, '')}")`)
  if (f.minPriceVnd) parts.push(`price >= ${Math.round(f.minPriceVnd)}`)
  if (f.maxPriceVnd) parts.push(`price <= ${Math.round(f.maxPriceVnd)}`)
  return parts.length ? parts.join(' AND ') : undefined
}

// Trust-first ranking (the app's core signal), expressed as Vertex boost conditions
// over the trustScore we index on each document.
const BOOST_SPEC = {
  conditionBoostSpecs: [
    { condition: 'trustScore >= 110', boost: 0.5 },
    { condition: 'trustScore < 60', boost: -0.5 },
  ],
}

function idsFrom(data: any): string[] {
  return ((data?.results || []) as any[]).map((r) => r?.document?.id || r?.id).filter(Boolean)
}

// AI concierge: search the catalog + generate a grounded summary reply. Draws the
// credit. Returns null when unconfigured/errored → caller falls back to Postgres.
export async function conciergeSearch(query: string, f: SearchFilters = {}): Promise<{ answer: string; listingIds: string[] } | null> {
  if (!vertexConfigured() || !query.trim()) return null
  const data = await call(`${SERVING_CONFIG}:search`, 'POST', {
    query,
    pageSize: f.take || 8,
    filter: buildFilter(f),
    boostSpec: BOOST_SPEC,
    // The generated summary needs an engine/app with LLM features enabled; if only a
    // data store is configured this is ignored and we still return ranked results.
    contentSearchSpec: {
      summarySpec: {
        summaryResultCount: 3,
        ignoreAdversarialQuery: true,
        includeCitations: false,
        languageCode: f.lang === 'vi' ? 'vi' : 'en',
        modelPromptSpec: { preamble: CONCIERGE_PREAMBLE },
      },
    },
  })
  if (!data) return null
  return { answer: String(data?.summary?.summaryText || ''), listingIds: idsFrom(data) }
}

// Plain semantic search → ordered listing ids (for a future semantic results page).
export async function vertexSearchListingIds(query: string, f: SearchFilters = {}): Promise<string[] | null> {
  if (!vertexConfigured() || !query.trim()) return null
  const data = await call(`${SERVING_CONFIG}:search`, 'POST', { query, pageSize: f.take || 24, filter: buildFilter(f), boostSpec: BOOST_SPEC })
  return data ? idsFrom(data) : null
}

// ---- Ingestion (keep the data store in sync with Postgres) -------------------------
// PUBLIC fields ONLY — never index seller phone / PII.
export type ListingDoc = {
  id: string; title: string; titleVi?: string | null; description?: string | null
  categorySlug?: string | null; categoryName?: string | null; brandSlug?: string | null; model?: string | null
  price?: number | null; currency?: string | null; district?: string | null; province?: string | null; ward?: string | null
  condition?: string | null; listingType?: string | null; trustScore?: number | null; featured?: boolean | null; postedAt?: number | null
}

// Map a Prisma listing (with category + seller included) to its indexed document.
// PUBLIC fields only — deliberately omits seller phone / contact / PII.
export function listingToDoc(l: Record<string, any>): ListingDoc {
  return {
    id: l.id,
    title: l.title,
    titleVi: l.titleVi ?? null,
    description: l.description ?? null,
    categorySlug: l.category?.slug ?? null,
    categoryName: l.category?.name ?? null,
    brandSlug: l.brandSlug ?? null,
    model: l.model ?? null,
    price: typeof l.price === 'number' ? l.price : null,
    currency: l.currency ?? null,
    district: l.district ?? null,
    province: l.province ?? null,
    ward: l.ward ?? null,
    condition: l.condition ?? null,
    listingType: l.listingType ?? null,
    trustScore: l.seller?.trustScore ?? null,
    featured: !!l.featured,
    postedAt: l.postedAt ? new Date(l.postedAt).getTime() : null,
  }
}

// Upsert one document (create or update). allowMissing makes PATCH create-if-absent.
export async function upsertListingDocument(doc: ListingDoc): Promise<void> {
  if (!vertexConfigured()) return
  await call(`${DOC_PARENT}/documents/${encodeURIComponent(doc.id)}?allowMissing=true`, 'PATCH', { jsonData: JSON.stringify(doc) })
}

export async function deleteListingDocument(id: string): Promise<void> {
  if (!vertexConfigured()) return
  await call(`${DOC_PARENT}/documents/${encodeURIComponent(id)}`, 'DELETE')
}

// Bulk ingest — the documents:import API (inline, up to 100 docs/call) for backfill.
// INCREMENTAL = upsert (won't delete docs missing from a batch). Returns the count
// submitted. Each call kicks off a server-side operation; we don't block on it.
export async function importListingDocuments(docs: ListingDoc[]): Promise<number> {
  if (!vertexConfigured() || !docs.length) return 0
  let submitted = 0
  for (let i = 0; i < docs.length; i += 100) {
    const chunk = docs.slice(i, i + 100)
    const r = await call(`${DOC_PARENT}/documents:import`, 'POST', {
      inlineSource: { documents: chunk.map((d) => ({ id: d.id, jsonData: JSON.stringify(d) })) },
      reconciliationMode: 'INCREMENTAL',
    })
    if (r) submitted += chunk.length
  }
  return submitted
}

// Fire-and-forget sync wrapper for hot mutation routes — never throws into the request.
export function syncListingToVertex(action: 'upsert' | 'delete', payload: ListingDoc | string): void {
  if (!vertexConfigured()) return
  const p = action === 'upsert' ? upsertListingDocument(payload as ListingDoc) : deleteListingDocument(payload as string)
  p.catch((e) => console.error('[vertex-search] sync', action, e))
}
