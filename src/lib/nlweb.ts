/**
 * NLWeb v0.55 `/ask` (ora.ai nlweb-ask + nlweb-streaming, owner 2026-11-16: "apply suggested fixes till it reaches 100").
 * Spec: https://github.com/nlweb-ai/website/blob/main/NLWEBSPEC.md — POST /ask with `query.text`; an `answer` whose
 * `results` are schema.org items, a `failure` with a standard code, or (prefer.streaming / Accept: text/event-stream) the
 * SSE events start, result…, complete.
 *
 * ⛔ NOTHING NEW BEHIND IT: the answer is the public MCP search server's own `search_listings` (src/app/api/mcp/search/
 * tools.ts) — the same edition scope, licensing filter, withheld aisles, keyword path (no paid ranking for an anonymous
 * caller) and row shape. This file only translates the request and the rows. The summary (mode "summarize") is a sentence
 * built from the counts, never generated text.
 * Served by src/app/ask/route.ts (a route module may export only its handlers, so this lives here).
 */

export const NLWEB_VERSION = '0.55'

export type AskRequest = { text: string; lang: 'en' | 'vi'; streaming: boolean; summarize: boolean }
export type Failure = { code: string; message: string }

type Row = {
  id: string
  title: string
  price: number | null
  price_unit: string | null
  listing_type: string | null
  condition: string | null
  location: string | null
  district: string | null
  city: string | null
  category: string | null
  image: string | null
  posted_at: string | null
  sponsored: boolean
  url: string
}

const MODES = new Set(['list', 'summarize'])
/** The search tool's own bound on `q` (tools.ts: z.string().max(120)). */
export const QUERY_MAX = 120

/** At most `max` UTF-16 units (the tool's own measure), never ending on half of a surrogate pair (an emoji). */
function cut(text: string, max: number): string {
  if (text.length <= max) return text
  const end = /[\uD800-\uDBFF]/.test(text[max - 1]) ? max - 1 : max
  return text.slice(0, end)
}

/** The request body → what to search, or the NLWeb failure that says why not. */
/** SSE only when asked for plainly: `prefer.streaming: true`, or an Accept whose FIRST choice is text/event-stream with no
 * JSON beside it — an MCP-style `application/json, text/event-stream` gets JSON (commit gate, codex + opus). */
export function wantsStream(prefer: Record<string, unknown>, accept: string | null): boolean {
  if (prefer.streaming === true) return true
  if (prefer.streaming === false) return false
  const ranges = (accept ?? '').toLowerCase().split(',').map((r) => r.trim()).filter(Boolean)
  if (!ranges[0]?.startsWith('text/event-stream') || ranges.some((r) => r.startsWith('application/json'))) return false
  // Its q, wherever it sits among the parameters ("text/event-stream; charset=utf-8; q=0" refuses it too).
  const q = /(?:^|;)\s*q\s*=\s*([0-9.]+)/.exec(ranges[0].slice('text/event-stream'.length))
  return !(q && Number(q[1]) === 0)
}

export function parseAsk(body: unknown, accept: string | null, acceptLanguage: string | null = null): AskRequest | Failure {
  const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>
  const query = (b.query && typeof b.query === 'object' ? b.query : {}) as Record<string, unknown>
  const prefer = (b.prefer && typeof b.prefer === 'object' ? b.prefer : {}) as Record<string, unknown>
  const text = typeof query.text === 'string' ? query.text.trim() : ''
  if (!text) return { code: 'INVALID_QUERY', message: 'query.text is required: what to look for, in English or Vietnamese.' }
  const format = prefer.response_format
  if (format !== undefined && format !== 'conversational_search') {
    return { code: 'UNSUPPORTED_FORMAT', message: 'This agent answers in the conversational_search format only.' }
  }
  const modes = typeof prefer.mode === 'string' ? prefer.mode.split(',').map((m) => m.trim()).filter(Boolean) : ['list']
  if (modes.some((m) => !MODES.has(m))) return { code: 'UNSUPPORTED_MODE', message: 'Supported modes: list, summarize.' }
  // prefer["accept-language"] first (the spec's own field), then the HTTP Accept-Language header.
  const wanted = typeof prefer['accept-language'] === 'string' ? prefer['accept-language'] : (acceptLanguage ?? '')
  const lang = wanted.trim().toLowerCase().startsWith('vi') ? 'vi' : 'en'
  return {
    text: cut(text, QUERY_MAX),
    lang,
    streaming: wantsStream(prefer, accept),
    summarize: modes.includes('summarize'),
  }
}

/** schema.org's OfferItemCondition for the conditions the site names; anything else is left out rather than guessed. */
const CONDITIONS: Record<string, string> = {
  new: 'https://schema.org/NewCondition',
  used: 'https://schema.org/UsedCondition',
  refurbished: 'https://schema.org/RefurbishedCondition',
}
/** The period in a price unit ("VND/month") as schema.org's unitText for a salary (MONTH, WEEK, DAY, HOUR, YEAR). */
function period(unit: string | null): string | undefined {
  const m = /\/(hour|day|week|month|year)\b/i.exec(unit ?? '')
  return m ? m[1].toUpperCase() : undefined
}

/** One search row as a schema.org item: a JobPosting for a job, otherwise a Product with its Offer (price in VND). */
export function toItem(r: Row): Record<string, unknown> {
  const place = [r.district, r.city].filter(Boolean).join(', ') || r.location || undefined
  const common = {
    name: r.title,
    url: r.url,
    ...(r.image ? { image: r.image } : {}),
    ...(r.posted_at ? { datePosted: r.posted_at } : {}),
    // A paid or commission listing says so (the search tool's own rule: "say so when you show it").
    ...(r.sponsored ? { sponsored: true } : {}),
    grounding: { source: r.url },
  }
  // A Wanted ad is someone asking to BUY or rent: schema.org's Demand, never an Offer that reads as "for sale" (commit gate, opus).
  if (r.listing_type === 'wanted') {
    return {
      '@type': 'Demand',
      ...common,
      ...(r.category ? { category: r.category } : {}),
      ...(r.price != null ? { priceSpecification: { '@type': 'PriceSpecification', price: r.price, priceCurrency: 'VND' } } : {}),
      ...(place ? { availableAtOrFrom: { '@type': 'Place', address: place } } : {}),
    }
  }
  if (r.listing_type === 'job') {
    return {
      '@type': 'JobPosting',
      title: r.title,
      ...common,
      ...(place ? { jobLocation: { '@type': 'Place', address: place } } : {}),
      // The salary's period goes inside a QuantitativeValue, as schema.org shapes it (commit gate, codex).
      ...(r.price != null
        ? { baseSalary: { '@type': 'MonetaryAmount', currency: 'VND', value: { '@type': 'QuantitativeValue', value: r.price, ...(period(r.price_unit) ? { unitText: period(r.price_unit) } : {}) } } }
        : {}),
    }
  }
  return {
    '@type': 'Product',
    ...common,
    ...(r.category ? { category: r.category } : {}),
    ...(r.condition && CONDITIONS[r.condition.toLowerCase()] ? { itemCondition: CONDITIONS[r.condition.toLowerCase()] } : {}),
    ...(r.price != null
      ? {
          offers: {
            '@type': 'Offer',
            price: String(r.price),
            priceCurrency: 'VND',
            url: r.url,
            ...(r.price_unit && r.price_unit !== 'VND' ? { priceSpecification: { '@type': 'UnitPriceSpecification', price: r.price, priceCurrency: 'VND', unitText: r.price_unit } } : {}),
            ...(r.listing_type === 'rent' ? { businessFunction: 'http://purl.org/goodrelations/v1#LeaseOut' } : {}),
            ...(place ? { availableAtOrFrom: { '@type': 'Place', address: place } } : {}),
          },
        }
      : {}),
  }
}

/** The results array: the items, led by a counted (never generated) summary when "summarize" was asked for. */
export function toResults(search: { total: number; listings: Row[] }, req: AskRequest, site: string): Record<string, unknown>[] {
  const items = search.listings.map(toItem)
  if (!req.summarize) return items
  const shown = search.listings.length
  const total = Math.max(search.total, shown) // never "3 of about 0" (commit gate, opus)
  // ⛔ The caller's own words are never quoted back under the site's name (commit gate, opus: a query can carry a scam line).
  const text = req.lang === 'vi'
    ? `${shown} trong khoảng ${total} tin đang đăng trên ${site} khớp với câu hỏi; mỗi tin dẫn tới trang của nó, nơi có ảnh và liên hệ người bán.`
    : `${shown} of about ${total} live listings on ${site} match the question; each links to its page, where the photos are and the seller is contacted.`
  return [{ '@type': 'SearchSummary', text }, ...items]
}

export const meta = (responseType: 'answer' | 'failure', extra: Record<string, unknown> = {}) =>
  ({ response_type: responseType, ...(responseType === 'answer' ? { response_format: 'conversational_search' } : {}), version: NLWEB_VERSION, ...extra })

export function failureBody(f: Failure) {
  return { _meta: meta('failure'), error: { code: f.code, message: f.message } }
}

/** A failure as an SSE stream (spec §6.1: an `error` event carries the failure structure), for a caller that asked to stream. */
export function sseFailure(f: Failure): string {
  const event = (name: string, data: unknown) => `event: ${name}\ndata: ${JSON.stringify(data)}\n\n`
  // Opens as a FAILURE (commit gate, opus): a client that branches on the first _meta never reads this as an answer.
  return [event('start', { _meta: meta('failure', { streaming: true }) }), event('error', failureBody(f)), event('complete', { _meta: meta('failure') })].join('')
}

/** The SSE stream (spec §6): start, one result per item with its index, complete. */
export function sseBody(results: Record<string, unknown>[]): string {
  const event = (name: string, data: unknown) => `event: ${name}\ndata: ${JSON.stringify(data)}\n\n`
  return [
    event('start', { _meta: meta('answer', { streaming: true }) }),
    ...results.map((item, index) => event('result', { index, item })),
    event('complete', { _meta: meta('answer') }),
  ].join('')
}
