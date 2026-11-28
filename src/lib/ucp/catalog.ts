import { SEARCH_TOOLS_BY_NAME, SearchToolError } from '@/app/api/mcp/search/tools'
import { OAUTH_ISSUER } from '@/lib/api/oauth'
import { db } from '@/lib/db'
import { logError } from '@/lib/log'
import { PARTNER_RETURN_POLICIES, type PartnerReturnPolicy } from '@/lib/partner-return-policies'
import { TAXONOMY } from '@/lib/taxonomy'

/**
 * ── UNIVERSAL COMMERCE PROTOCOL: eno.vn's CATALOG (owner, 2026-11-27: "build ucp endpoints … catalog partner shops") ──
 *
 * UCP (ucp.dev, Google + Shopify) lets an AI agent find a business's products from the profile at /.well-known/ucp and
 * call its catalog. This is the 2026-08-25 release's shopping catalog over REST: `dev.ucp.shopping.catalog.search`
 * (POST {endpoint}/catalog/search) and `dev.ucp.shopping.catalog.lookup` (POST {endpoint}/catalog/lookup and
 * /catalog/product), endpoint https://eno.vn/api/ucp. Schemas read from https://ucp.dev/2026-08-25/schemas/… on
 * 2026-11-27: product (id, title, description{plain}, price_range, variants≥1), variant (id, title, description, price),
 * price (amount in ISO 4217 MINOR units — VND has none, so whole đồng), pagination (cursor, has_next_page).
 *
 * ⛔ NO CHECKOUT, NO PAYMENT HANDLERS. eno.vn's buyers pay sellers directly; the profile declares `payment_handlers: {}`
 * and only the two catalog capabilities. Checkout (ads, partner shops) is a separate, owner-gated step.
 * ⛔ GOODS FOR SALE ONLY. UCP's shopping catalog is products: a rental, a job or a service is not one, so every read here is
 * `type=sell` and a lookup of anything else is "not found".
 * ⛔ VISIBILITY AND TEXT ARE THE MCP SEARCH SERVER'S (src/app/api/mcp/search/tools.ts), REUSED, NEVER COPIED: its search
 * runs the site's own feed (verified, active, edition-scoped, teachers excluded, withheld aisles dropped) and its detail
 * read the listing page's rule; both strip contact details from seller text. A commission (affiliate) listing carries
 * the tag `sponsored`, the disclosure the site prints.
 * A PARTNER SHOP'S product names the shop and links its own return policy (src/lib/partner-return-policies.ts, owner
 * 2026-11-28): `variants[].seller` {name, links: refund_policy} and a response `policies` entry
 * (dev.ucp.shopping.policy.return) whose `applies_to` points at those products. Other sellers carry neither.
 */
export const UCP_VERSION = '2026-08-25'
const SPEC = `https://ucp.dev/${UCP_VERSION}`
export const UCP_ENDPOINT = `${OAUTH_ISSUER}/api/ucp`
export const UCP_SEARCH = 'dev.ucp.shopping.catalog.search'
export const UCP_LOOKUP = 'dev.ucp.shopping.catalog.lookup'

const LIMIT_DEFAULT = 10
const LIMIT_MAX = 20 // the MCP search's own page cap
const OFFSET_MAX = 200
const LOOKUP_MAX = 10 // each id is one detail read: the rate limit counts requests (commit gate 2026-11-27)

/** The business profile served at /.well-known/ucp (schemas/ucp.json `business_schema`). */
export function ucpProfile() {
  return {
    ucp: {
      version: UCP_VERSION,
      services: {
        'dev.ucp.shopping': [
          { version: UCP_VERSION, spec: `${SPEC}/specification/overview`, transport: 'rest', schema: `${SPEC}/services/shopping/rest.openapi.json`, endpoint: UCP_ENDPOINT },
        ],
      },
      capabilities: {
        [UCP_SEARCH]: [{ version: UCP_VERSION, spec: `${SPEC}/specification/shopping/catalog/search`, schema: `${SPEC}/schemas/shopping/catalog_search.json` }],
        [UCP_LOOKUP]: [{ version: UCP_VERSION, spec: `${SPEC}/specification/shopping/catalog/lookup`, schema: `${SPEC}/schemas/shopping/catalog_lookup.json` }],
      },
      payment_handlers: {},
    },
  }
}

type Json = Record<string, unknown>
/** The `ucp` member of a catalog response (ucp.json `response_catalog_schema`): version, status, the capability used. */
const meta = (capability: string, status: 'success' | 'error' = 'success') => ({ version: UCP_VERSION, status, capabilities: { [capability]: [{ version: UCP_VERSION }] } })

/** A UCP error body (common/types/error_response.json). */
export function ucpError(capability: string, code: string, content: string) {
  return { ucp: meta(capability, 'error'), messages: [{ type: 'error', code, content, severity: 'unrecoverable' }] }
}

export class UcpRequestError extends Error {
  constructor(readonly code: string, message: string) { super(message) }
}

/**
 * Đồng, whole (VND's ISO 4217 exponent is 0). Measured 2026-11-27: all 3,823 live listings for sale are priced in ₫ and none
 * at 0 — and a row whose price is not a positive number is never published (`priced`), so no product claims "0 VND".
 */
const money = (amount: number) => ({ amount: Math.round(amount), currency: 'VND' })
const priced = (r: { price: unknown }) => typeof r.price === 'number' && Number.isFinite(r.price) && r.price > 0

type Row = { id: string; title: string; price: number; condition: string | null; location: string | null; district: string | null; city: string | null; category: string; images: string[]; sponsored: boolean; url: string; description?: string }

function categoryName(slug: string): string {
  return TAXONOMY.find((c) => c.slug === slug)?.name ?? slug
}

/**
 * Which of these listings a partner shop sells: listing id → its return policy. One read, and only partner rows come back
 * (`sellerId IN` the policy map) — no other seller's id is ever read into this module, let alone sent.
 */
async function partnerPolicies(ids: string[]): Promise<Map<string, PartnerReturnPolicy>> {
  if (!ids.length) return new Map()
  try {
    const rows = await db.listing.findMany({ where: { id: { in: ids }, sellerId: { in: Object.keys(PARTNER_RETURN_POLICIES) } }, select: { id: true, sellerId: true } })
    return new Map(rows.map((r) => [r.id, PARTNER_RETURN_POLICIES[r.sellerId]] as const))
  } catch (e) {
    // Degrade, never fail: the products still go out, without the shop's policy (commit gate 2026-11-28).
    logError(e, { where: 'ucp.partner-policies' })
    return new Map()
  }
}

type Lang = 'en' | 'vi'
/** The request's `context.language` (context.json): Vietnamese when it starts with "vi", else English. */
function langOf(req: Json): Lang {
  const context = isRecord(req.context) ? req.context : {}
  return typeof context.language === 'string' && context.language.toLowerCase().startsWith('vi') ? 'vi' : 'en'
}
const policyText = (name: string, lang: Lang) =>
  lang === 'vi'
    ? `Bán bởi ${name}: đổi trả và hoàn tiền theo chính sách riêng của ${name} trên website của họ.`
    : `Sold by ${name}: returns, exchanges and refunds follow ${name}'s own policy on its website.`
const policyTitle = (name: string, lang: Lang) => (lang === 'vi' ? `Chính sách đổi trả của ${name}` : `${name} return policy`)

/** The response's `policies` (policy.json): one return policy per partner, over the products it sells (`applies_to`). */
type ReturnPolicyOut = { type: 'dev.ucp.shopping.policy.return'; description: { plain: string }; url: string; applies_to: string[] }
function returnPolicies(targets: { path: string; policy: PartnerReturnPolicy | undefined }[], lang: Lang): ReturnPolicyOut[] {
  const byUrl = new Map<string, { policy: PartnerReturnPolicy; paths: string[] }>()
  for (const t of targets) {
    if (!t.policy) continue
    const g = byUrl.get(t.policy.url) ?? { policy: t.policy, paths: [] }
    g.paths.push(t.path)
    byUrl.set(t.policy.url, g)
  }
  return [...byUrl.values()].map(({ policy, paths }) => ({
    type: 'dev.ucp.shopping.policy.return' as const,
    description: { plain: policyText(policy.name, lang) },
    url: policy.url,
    applies_to: paths,
  }))
}

/** One listing → a UCP product with its single variant (a listing is one item; its id is both). */
function toProduct(r: Row, inputs?: { id: string; match: string }[], policy?: PartnerReturnPolicy, lang: Lang = 'en') {
  const where = [r.location, r.district, r.city].filter(Boolean).join(', ')
  // Required and non-empty (description.json minProperties 1): the seller's text when the read has it, else what the card shows.
  const plain = r.description?.trim() || [r.title, r.condition && `Condition: ${r.condition}`, where].filter(Boolean).join('. ')
  const price = money(r.price)
  const variant: Json = {
    id: r.id,
    title: r.title,
    description: { plain },
    url: r.url,
    price,
    availability: { available: true, status: 'in_stock' },
    // `seller` only for a partner shop (its public name and its own return policy); a private seller is named on the page.
    ...(policy ? { seller: { name: policy.name, links: [{ type: 'refund_policy', url: policy.url, title: policyTitle(policy.name, lang) }] } } : {}),
    ...(inputs ? { inputs } : {}),
  }
  return {
    id: r.id,
    title: r.title,
    description: { plain },
    url: r.url,
    categories: [{ value: categoryName(r.category) }],
    price_range: { min: price, max: price },
    media: r.images.map((url) => ({ type: 'image', url })),
    tags: r.sponsored ? ['sponsored'] : [],
    variants: [variant],
  }
}

const isRecord = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v)

/** A category filter value → one of the marketplace's category slugs (by slug or name, any case), else null. */
function categorySlug(value: string): string | null {
  const v = value.trim().toLowerCase()
  const hit = TAXONOMY.find((c) => c.slug !== 'teachers' && (c.slug === v || c.name.toLowerCase() === v || c.nameVi.toLowerCase() === v))
  return hit?.slug ?? null
}

/** Cursor = the next offset, base64url-encoded JSON (opaque to the platform, as pagination.json asks). */
const encodeCursor = (offset: number) => Buffer.from(JSON.stringify({ o: offset })).toString('base64url')
function decodeCursor(c: unknown): number {
  if (c === undefined || c === null || c === '') return 0
  try {
    const o = JSON.parse(Buffer.from(String(c), 'base64url').toString('utf8')).o
    if (Number.isInteger(o) && o >= 0 && o <= OFFSET_MAX) return o
  } catch { /* fall through */ }
  throw new UcpRequestError('invalid_cursor', 'The pagination cursor is not one this catalog issued.')
}

/** POST /catalog/search (catalog_search.json `search_request` → `search_response`). */
export async function ucpSearch(body: unknown) {
  const req = isRecord(body) ? body : {}
  const filters = isRecord(req.filters) ? req.filters : {}
  const pagination = isRecord(req.pagination) ? req.pagination : {}
  const limitIn = Number(pagination.limit ?? LIMIT_DEFAULT)
  if (!Number.isInteger(limitIn) || limitIn < 1) throw new UcpRequestError('invalid_request', '`pagination.limit` must be a whole number of at least 1.')
  const limit = Math.min(limitIn, LIMIT_MAX)
  const offset = decodeCursor(pagination.cursor)
  const messages: Json[] = []
  // `categories` are OR'd (search_filters.json); the feed takes one category, so the first one this catalog knows is used.
  const cats = Array.isArray(filters.categories) ? filters.categories.filter((c): c is string => typeof c === 'string') : []
  const slugs = cats.map(categorySlug).filter((s): s is string => s !== null)
  if (cats.length && !slugs.length) messages.push({ type: 'info', code: 'not_found', content: `No category here matches ${cats.slice(0, 3).join(', ')}; searched every category.` })
  else if (slugs.length > 1) messages.push({ type: 'info', content: `Searched the first matching category (${slugs[0]}) only.` })
  const price = isRecord(filters.price) ? filters.price : {}
  const lang = langOf(req)
  const tool = SEARCH_TOOLS_BY_NAME.get('search_listings')!
  const out = (await tool.handler({
    q: typeof req.query === 'string' ? req.query : undefined,
    category: slugs[0],
    type: 'sell',
    // At least 1 đồng: "contact for price" rows never reach a catalog that must state one (as the model pages ask, priceMin=1).
    price_min: Math.max(1, Number.isInteger(price.min) ? Number(price.min) : 1),
    price_max: Number.isInteger(price.max) ? price.max : undefined,
    limit,
    offset,
    lang,
  })) as { total: number; listings: (Omit<Row, 'images'> & { image: string | null })[]; next_offset: number | null }
  const rows = out.listings.filter(priced)
  const partners = await partnerPolicies(rows.map((l) => l.id))
  const products = rows.map((l) => toProduct({ ...l, images: l.image ? [l.image] : [] }, undefined, partners.get(l.id), lang))
  const policies = returnPolicies(rows.map((l, i) => ({ path: `$.products[${i}]`, policy: partners.get(l.id) })), lang)
  // The MCP search already stops at offset 200; held here too, so a cursor this catalog issues always decodes.
  const hasNext = out.next_offset !== null && out.next_offset <= OFFSET_MAX
  return {
    ucp: meta(UCP_SEARCH),
    products,
    pagination: { has_next_page: hasNext, ...(hasNext ? { cursor: encodeCursor(out.next_offset!) } : {}), total_count: out.total },
    ...(policies.length ? { policies } : {}),
    ...(messages.length ? { messages } : {}),
  }
}

/** One listing in full (the MCP detail read), or null when no live listing for sale has that id. */
async function readOne(id: string): Promise<Row | null> {
  const tool = SEARCH_TOOLS_BY_NAME.get('get_listing_details')!
  try {
    const { listing } = (await tool.handler({ id })) as { listing: Row & { listing_type: string; status: string; description: string } }
    if (listing.listing_type !== 'sell' || listing.status !== 'active' || !priced(listing)) return null
    return listing
  } catch (e) {
    if (e instanceof SearchToolError) return null
    throw e
  }
}

/** POST /catalog/lookup (catalog_lookup.json `lookup_request` → `lookup_response`): product and variant ids are one id here. */
export async function ucpLookup(body: unknown) {
  const req = isRecord(body) ? body : {}
  const ids = Array.isArray(req.ids) ? req.ids.filter((x): x is string => typeof x === 'string' && x.trim() !== '').map((x) => x.trim()) : []
  if (!ids.length) throw new UcpRequestError('invalid_request', '`ids` must list at least one product or variant id.')
  if (ids.length > LOOKUP_MAX) throw new UcpRequestError('invalid_request', `At most ${LOOKUP_MAX} ids per lookup.`)
  const unique = [...new Set(ids)]
  const found = await Promise.all(unique.map(async (id) => [id, await readOne(id)] as const))
  const hits = found.filter(([, r]) => r)
  const partners = await partnerPolicies(hits.map(([, r]) => r!.id))
  const lang = langOf(req)
  const products = hits.map(([id, r]) => toProduct(r!, [{ id, match: 'exact' }], partners.get(r!.id), lang))
  const policies = returnPolicies(hits.map(([, r], i) => ({ path: `$.products[${i}]`, policy: partners.get(r!.id) })), lang)
  const missing = found.filter(([, r]) => !r).map(([id]) => id)
  return {
    ucp: meta(UCP_LOOKUP),
    products,
    ...(policies.length ? { policies } : {}),
    ...(missing.length ? { messages: missing.map((id) => ({ type: 'info', code: 'not_found', content: id })) } : {}),
  }
}

/** POST /catalog/product (catalog_lookup.json `get_product_request` → `get_product_response`). */
export async function ucpProduct(body: unknown): Promise<{ status: number; body: Json }> {
  const req = isRecord(body) ? body : {}
  const id = typeof req.id === 'string' ? req.id.trim() : ''
  if (!id) throw new UcpRequestError('invalid_request', '`id` is required.')
  const r = await readOne(id)
  // A business outcome, not a transport failure: HTTP 200 with ucp.status "error" (the catalog REST binding's rule).
  if (!r) return { status: 200, body: ucpError(UCP_LOOKUP, 'not_found', `No live listing for sale has the id ${id}.`) }
  const policy = (await partnerPolicies([r.id])).get(r.id)
  const lang = langOf(req)
  const policies = returnPolicies([{ path: '$.product', policy }], lang)
  return { status: 200, body: { ucp: meta(UCP_LOOKUP), product: toProduct(r, undefined, policy, lang), ...(policies.length ? { policies } : {}) } }
}
