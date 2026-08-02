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
// Env:
//   GOOGLE_VERTEX_PROJECT       — GCP project id (the credit's billing account)
//   VERTEX_SEARCH_LOCATION      — data store location: "global" (default), "us", "eu"
//   VERTEX_SEARCH_DATASTORE_ID  — the data store id
//   VERTEX_SEARCH_ENGINE_ID     — (optional) search app/engine id; required for the
//                                 generated summary (set it once the app has LLM features)
// …plus EXACTLY ONE of these two credential modes:
//   GOOGLE_VERTEX_ADC=1         — use Application Default Credentials (the preferred mode)
//   GOOGLE_VERTEX_CREDENTIALS   — SA JSON (raw or base64), needs Discovery Engine access
//
// ⚠️ ADC IS NOT A CONVENIENCE, IT IS THE ONLY OPTION IN THE PROJECT THAT NOW HOSTS THE DATA STORE.
// The store used to live in project eno-vn and was reached with a downloaded SA key. It was moved
// to speedy-victory-500106-h8 (the credit project, and the project Cloud Run already runs in) on
// 2026-08-02, and that project carries the org policy
// `constraints/iam.disableServiceAccountKeyCreation` — `gcloud iam service-accounts keys create`
// fails with FAILED_PRECONDITION there. There is no key to paste even if we wanted one.
//
// That constraint turned out to be the better design anyway: with the data store in the SAME
// project as the service, Cloud Run's own runtime identity
// (eno-run@speedy-victory-500106-h8, granted roles/discoveryengine.editor) authenticates from the
// metadata server. No key in Secret Manager, nothing to rotate, nothing to leak.
//
// ⚠️ THE FLAG IS EXPLICIT ON PURPOSE — do NOT "simplify" it to `if (!RAW_CREDS) use ADC`. ADC
// resolves to whatever gcloud identity a developer happens to have locally, so an implicit
// fallback would silently point a laptop at the production index and start writing documents to
// it. Opting in by env means only the deployments that set it can reach Vertex at all.
const PROJECT = process.env.GOOGLE_VERTEX_PROJECT
const LOCATION = process.env.VERTEX_SEARCH_LOCATION || 'global'
const DATASTORE = process.env.VERTEX_SEARCH_DATASTORE_ID
const ENGINE = process.env.VERTEX_SEARCH_ENGINE_ID
const RAW_CREDS = process.env.GOOGLE_VERTEX_CREDENTIALS?.trim()
// ⚠️ `K_SERVICE` IS NOT DECORATION — it is what stops a LAPTOP reaching the production index, and
// the risk is higher here than for Gemini because this module WRITES (upsert/purge of documents).
// Production secrets carry GOOGLE_VERTEX_ADC=1 beside the production project id, and pulling prod
// env into a local `.env` is routine here; without this guard a developer who synced the env but
// not a key would authenticate as their own gcloud identity against the live data store. K_SERVICE
// is set only by the Cloud Run runtime — the same test cache-handler.cjs uses (line 186) — so ADC
// can only engage where the metadata server exists. Found by codex + Gemini 3.1 Pro reviewing the
// sibling change in gemini.ts, 2026-08-02, after this file had already shipped with the hole.
const USE_ADC = process.env.GOOGLE_VERTEX_ADC === '1' && !!process.env.K_SERVICE

export function vertexConfigured(): boolean {
  return !!(PROJECT && (RAW_CREDS || USE_ADC) && (DATASTORE || ENGINE))
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
    const scopes = ['https://www.googleapis.com/auth/cloud-platform']
    if (RAW_CREDS) {
      const json = RAW_CREDS.trim().startsWith('{') ? RAW_CREDS : Buffer.from(RAW_CREDS.trim(), 'base64').toString('utf8')
      const credentials = JSON.parse(json)
      auth = new GoogleAuth({ credentials, scopes, projectId: PROJECT })
    } else if (USE_ADC) {
      // No `credentials`: google-auth-library then walks the ADC chain, which on Cloud Run is the
      // metadata server and resolves to the service's own runtime identity. projectId is still
      // passed explicitly — ADC's inferred project is the one the CREDENTIAL belongs to, which is
      // not necessarily where the data store lives.
      auth = new GoogleAuth({ scopes, projectId: PROJECT })
    } else {
      auth = null
      return null
    }
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
  try {
    const res = await fetch(`https://${HOST}/v1/${path}`, {
      method,
      headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(8000),
    })
    if (!res.ok) {
      console.error('[vertex-search]', method, path.split('?')[0], res.status, (await res.text()).slice(0, 300))
      return null
    }
    return res.json()
  } catch (e) {
    // Timeout/abort or network failure → the callers' existing null fallback path.
    console.error('[vertex-search]', method, path.split('?')[0], e instanceof Error ? e.name : e)
    return null
  }
}

export type SearchFilters = { categorySlug?: string | null; minPriceVnd?: number | null; maxPriceVnd?: number | null; take?: number; lang?: 'en' | 'vi' }

// The AI concierge's voice: eno's friendly, trustworthy SHIELD mascot. This preamble
// is prepended to Vertex's answer generation so replies sound like a warm guardian who
// helps you shop AND keeps you safe — not a document-QA bot.
const CONCIERGE_PREAMBLE = `You are eno, the friendly shield mascot of eno.vn, a trusted marketplace in Vietnam. Reply with ONE short, warm sentence in the SAME language the shopper wrote in (any language — mirror theirs exactly). Your sentence only gives a cheerful intro to the results, or kindly says nothing matched and offers to broaden the search. NEVER state any listing's price, location, trust score, dates, IDs, category, condition, or status — the product cards already show all of that, so don't repeat it. Good examples: "Here are some great motorbikes for you!" or "I couldn't find a BMW right now — want me to look at other cars?". eno keeps shoppers safe: higher-trust sellers rank first and fakes get reported. Never invent anything, and never sound robotic or mention "sources", "documents", or "context".`

/**
 * ⚠️ CATEGORY IS NOT IN HERE, AND THAT IS THE FIX FOR "AI SEARCH CANNOT FIND THINGS THAT EXIST".
 *
 * A hard filter is for what the BUYER said. `categorySlug` is not that — it is Gemini's guess, and
 * the concierge prompt says so in as many words: "the single best match … This is only a HINT — when
 * unsure use null". `buildFilter` then turned that hint into an `AND` constraint, so a wrong guess
 * did not rank the right listing lower, it removed it from the result set entirely.
 *
 * Measured 2026-08-02 on the live index, which is what proved it rather than the reasoning:
 *   query "apartment", no filter                    → Căn hộ chung cư cao cấp
 *   query "apartment", categorySlug ANY("property") → Căn hộ chung cư cao cấp
 *   query "apartment", categorySlug ANY("rentals")  → NOTHING
 * The listing is filed under `property`; "apartment" reads like a rental, and BOTH categories exist
 * (they were deliberately separated). One plausible model guess made a live listing invisible.
 *
 * The failure is silent and total: Vertex returns zero ids, the route falls through to the Postgres
 * keyword ladder, and that cannot bridge languages — an English query never matches a Vietnamese
 * title. So the buyer is told nothing exists while it sits on the browse page.
 *
 * PRICE STAYS A HARD FILTER, and the distinction is the whole point: "under 5 triệu" is the buyer's
 * own words and a listing above it is genuinely not an answer. Category is inference. Inference
 * boosts; statements filter.
 */
function buildFilter(f: SearchFilters): string | undefined {
  const parts: string[] = []
  if (f.minPriceVnd) parts.push(`price >= ${Math.round(f.minPriceVnd)}`)
  if (f.maxPriceVnd) parts.push(`price <= ${Math.round(f.maxPriceVnd)}`)
  return parts.length ? parts.join(' AND ') : undefined
}

/**
 * Trust bands (always) plus the category HINT expressed the way a hint should be — as a boost that
 * lifts the guessed category without hiding anything else.
 *
 * The boost is deliberately below the top trust band: a good guess should reorder the page, not
 * outweigh the trust signal this marketplace ranks on.
 */
function buildBoostSpec(f: SearchFilters) {
  const specs = [...BOOST_SPEC.conditionBoostSpecs]
  if (f.categorySlug) {
    specs.push({ condition: `categorySlug: ANY("${f.categorySlug.replace(/"/g, '')}")`, boost: 0.5 })
  }
  return { conditionBoostSpecs: specs }
}

// Trust-first ranking (the app's core signal), expressed as Vertex boost conditions
// over the trustScore we index on each document.
const BOOST_SPEC = {
  conditionBoostSpecs: [
    // Bands match the TRUST V2 tier ladder (85 Trusted / 110 Exceptional). The old
    // single ">= 110" band was v1-calibrated — under v2's evidence-based scores it
    // boosted almost nobody. Disjoint conditions so a document gets exactly one boost.
    { condition: 'trustScore >= 110', boost: 0.6 },
    { condition: 'trustScore >= 85 AND trustScore < 110', boost: 0.4 },
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
    boostSpec: buildBoostSpec(f),
    /**
     * ⚠️ LOW, NOT MEDIUM — MEDIUM SILENTLY BROKE EVERY CROSS-LANGUAGE SEARCH.
     *
     * This is a bilingual marketplace: sellers title listings in Vietnamese OR English, buyers
     * search in either, and `titleVi` is null on every row today — so a listing carries ONE
     * language and roughly half of all queries have to cross over. Vertex does make that match
     * semantically, but it scores it lower than a same-language hit, and MEDIUM cut exactly
     * there. The old comment's worry (padding a sparse catalogue) was real but it was tuned
     * against same-language queries only.
     *
     * Measured 2026-08-02 against the live index, threshold varied and nothing else:
     *   query        title language   HIGH  MEDIUM  LOW              LOWEST
     *   "căn hộ"     Vietnamese        ∅     ✓      ✓                ✓ + noise
     *   "apartment"  Vietnamese        ∅     ∅      ✓ the apartment  ✓ + noise
     *   "ba lô"      English           ∅     ∅      ✓ the backpack   ✓ + noise
     *   "túi xách"   English           ∅     ∅      ✓ the bags       ✓ + noise
     *   "iphone"     English           ∅     ∅      ✓ the smartphone ✓ + noise
     *   "laptop"     English           ✓     ✓      ✓                ✓ + noise
     * Same-language passes MEDIUM; every cross-language match fails it. LOW recovers them and
     * still returns ONE sensible row for "iphone" rather than the four-item pile LOWEST gives —
     * so the padding this was raised against is what LOWEST does, not LOW.
     *
     * ⚠️ THE FAILURE WAS INVISIBLE FROM INSIDE THE APP. Vertex returned zero ids, the route fell
     * through to the Postgres keyword ladder, and that cannot bridge languages either — so the
     * buyer was told nothing exists while the listing sat on the browse page. Nothing errored and
     * nothing logged.
     *
     * If this is ever retuned, vary ONLY the threshold and test at least one query in each
     * direction across languages. A same-language-only test set will call MEDIUM correct again.
     */
    relevanceThreshold: 'LOW',
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
  const data = await call(`${SERVING_CONFIG}:search`, 'POST', { query, pageSize: f.take || 24, filter: buildFilter(f), boostSpec: buildBoostSpec(f) })
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

