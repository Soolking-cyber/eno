/**
 * eno.vn's own free answer to Cloudflare "Search for Agents" (GET /.well-known/search?q=…).
 *
 * Owner 2026-11-27: "make it available for whole site but after free quota ends offer free mcp connection or any
 * alternative free we have for ais to continue" + "no alert make it automatic switch". Cloudflare serves
 * /.well-known/search itself, ahead of our Worker; when the month's free AI Search allowance is nearly used, the
 * guard Worker (infra/cloudflare/eno-agent-search-guard.js) turns on a redirect rule that sends that path here, and turns
 * it off when the month resets. Same contract as Cloudflare's: a GET with `q`, Markdown passages with their source URLs,
 * never a generated answer.
 *
 * ⛔ NOTHING NEW BEHIND IT: listings are the public MCP search server's own `search_listings` (as /ask uses it), guides
 * are the live registry's titles and descriptions. The footer names the free ways an agent can keep going: the MCP search
 * server, NLWeb /ask and the docs.
 */
import { GUIDES, guideBlurb, guideLabel, guidePath, isGuideLive, type GuideEntry } from '@/lib/guides/registry'
import { formatMoneyFull } from '@/lib/vnd'
import { logError } from '@/lib/log'

export const AGENT_QUERY_MAX = 200
export const AGENT_GUIDES_MAX = 3

export type AgentListing = {
  title?: unknown; url?: unknown; price?: unknown; price_unit?: unknown; location?: unknown; city?: unknown
  category?: unknown; subcategory?: unknown; listing_type?: unknown; sponsored?: unknown; posted_at?: unknown
}

/** The query from `q` (GET) or a body: text/plain, or JSON {"q": "…"} / {"query": "…"}. null = none or unusable. */
export function readQuery(q: string | null, body?: { type: string; text: string }): string | null {
  let s = q
  if ((s === null || s.trim() === '') && body && body.text) {
    if (body.type.includes('application/json')) {
      try {
        const j = JSON.parse(body.text) as Record<string, unknown>
        const v = j.q ?? j.query
        s = typeof v === 'string' ? v : null
      } catch {
        s = null
      }
    } else s = body.text
  }
  if (typeof s !== 'string') return null
  const t = s.replace(/\s+/g, ' ').trim()
  return t ? t.slice(0, AGENT_QUERY_MAX) : null
}

/** Vietnamese diacritics off, lower case, so "Bình Thạnh" matches "binh thanh". */
export const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').toLowerCase()

const STOP = new Set(['the', 'a', 'an', 'in', 'of', 'for', 'to', 'and', 'or', 'is', 'how', 'what', 'where', 'can', 'i', 'my', 'on', 'with', 'at', 'vn', 'vietnam', 'viet', 'nam'])

/** Live guides whose title or description share the query's words, best first. */
export function matchGuides(q: string, entries: readonly GuideEntry[] = GUIDES, now: Date = new Date(), max = AGENT_GUIDES_MAX) {
  const words = fold(q).split(/[^a-z0-9]+/).filter((w) => w.length > 1 && !STOP.has(w))
  if (!words.length) return []
  return entries
    .filter((e) => isGuideLive(e, now))
    .map((e) => {
      const title = fold(guideLabel(e)), blurb = fold(guideBlurb(e))
      const score = words.reduce((n, w) => n + (title.includes(w) ? 2 : 0) + (blurb.includes(w) ? 1 : 0), 0)
      return { e, score }
    })
    .filter((x) => x.score >= Math.min(2, words.length))
    .sort((a, b) => b.score - a.score)
    .slice(0, max)
    .map(({ e }) => ({ title: guideLabel(e), url: `https://eno.vn${guidePath(e)}`, blurb: guideBlurb(e), lang: e.lang }))
}

/** A listing field as ONE line: a seller's newline must not add a heading or a fake `- Source:` line (commit gate, opus). */
const str = (v: unknown) => (typeof v === 'string' ? v : typeof v === 'number' ? String(v) : '').replace(/[\r\n\u2028\u2029]+/g, ' ').replace(/\s+/g, ' ').trim().replace(/^#+\s*/, '')

/** One listing as a passage: title as heading, then price, place, kind and its page. */
export function listingPassage(l: AgentListing): string {
  const price = typeof l.price === 'number' && l.price > 0 ? `${formatMoneyFull(l.price, '₫', 'en')}${str(l.price_unit).replace(/^VND/, '') || ''}` : 'Price on request'
  const place = [str(l.location), str(l.city)].filter((x, i, a) => x && a.indexOf(x) === i).join(', ')
  const kind = [str(l.category), str(l.subcategory), str(l.listing_type)].filter(Boolean).join(' / ')
  const lines = [`## ${str(l.title) || 'Listing'}${l.sponsored === true ? ' (ad)' : ''}`, '', `- Price: ${price}`]
  if (place) lines.push(`- Where: ${place}`)
  if (kind) lines.push(`- Kind: ${kind}`)
  if (str(l.posted_at)) lines.push(`- Posted: ${str(l.posted_at).slice(0, 10)}`)
  lines.push(`- Source: ${str(l.url)}`)
  return lines.join('\n')
}

export const FOOTER = [
  '---',
  'This answer comes from eno.vn\'s own free search. More free ways for AI agents to keep going, no key or sign-in needed:',
  '- MCP server (search, listing details, categories): https://eno.vn/api/mcp/search',
  '- NLWeb: POST https://eno.vn/ask with {"query": {"text": "…"}}',
  '- Docs: https://eno.vn/developers/mcp and https://eno.vn/llms.txt',
].join('\n')

/** The whole Markdown answer. */
export function renderAnswer(q: string, listings: AgentListing[], total: number, guides: ReturnType<typeof matchGuides>): string {
  const out = [`# eno.vn search: ${q}`, '']
  if (!listings.length && !guides.length) out.push('No live listings or guides on eno.vn match that.', '')
  if (listings.length) out.push(`${total} live listing${total === 1 ? '' : 's'} match; the first ${listings.length}:`, '', ...listings.map((l) => listingPassage(l) + '\n'))
  if (guides.length) out.push('# Guides', '', ...guides.map((g) => `## ${g.title}\n\n${g.blurb}\n\n- Source: ${g.url}\n`))
  out.push(FOOTER, '')
  return out.join('\n')
}

/** The body as text, read as a stream and abandoned once it passes `max` BYTES, with or without a Content-Length (a chunked
 * body has none) — the same guard as /ask (commit gate, opus). null = too large. */
export async function readCapped(req: Request, max: number): Promise<string | null> {
  if (!req.body) return ''
  const reader = req.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.byteLength
    if (size > max) {
      void reader.cancel().catch((e) => logError(e, { op: 'agent-search.cancel' }))
      return null
    }
    chunks.push(value)
  }
  const all = new Uint8Array(size)
  let at = 0
  for (const c of chunks) { all.set(c, at); at += c.byteLength }
  return new TextDecoder().decode(all)
}
