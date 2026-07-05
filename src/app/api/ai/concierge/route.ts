import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { fold } from '@/lib/fold'
import { serializeListing } from '@/lib/serialize'
import { aiGuard } from '@/lib/ai-guard'
import { rateLimit } from '@/lib/ratelimit'
import { conciergeSearch, vertexConfigured } from '@/lib/vertex-search'
import { getGemini, GEMINI_MODEL } from '@/lib/gemini'
import { matchBrand } from '@/lib/brand'
import type { Prisma } from '@/generated/prisma/client'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// AI shopping concierge — the "AI mode" chat (a conversation in the messages tab). A
// buyer describes what they want in natural language (EN/VI); we return a grounded
// reply + matching listings as cards. Public but IP-rate-limited.
//
// It UNDERSTANDS, not just retrieves: one Gemini call classifies intent (chat vs
// search), writes a natural reply in the buyer's language, and extracts structured
// search params (standalone query, brand, budget, sort, category) from the whole
// conversation. Greetings/small talk get a conversation, never a product dump; brand
// words resolve through the catalogue (typo-tolerant) into a brandSlug filter; and the
// guessed category is a SOFT preference — retrieval walks a relaxation ladder so a
// wrong guess can never produce a false "no match" (the "huawei watch existed but
// wasn't found" bug: the watch lived in fashion-beauty, the model guessed electronics,
// and the guess was applied as a hard filter).
//
// Retrieval + the reply summary run on VERTEX AI SEARCH when configured (draws the
// credit); the Postgres ladder is both the fallback and the freshness guarantee — it
// reads the LIVE Listing table, so a listing posted a minute ago is findable even if
// a search index lags, and index hits are re-validated against the live table.

type Msg = { role: 'user' | 'assistant'; content: string }
type Sort = 'price_asc' | 'price_desc' | null

const RANK: Prisma.ListingOrderByWithRelationInput = { rankScore: 'desc' }
const INCLUDE = { category: true, seller: { include: { owner: { select: { accountType: true } } } } } as const

// Folded EN + VI fillers (VI limited to non-colliding words) for the keyword fallback.
const STOP = new Set([
  'under', 'over', 'near', 'around', 'below', 'above', 'about', 'less', 'than', 'cheap', 'good', 'best',
  'find', 'want', 'need', 'looking', 'please', 'the', 'for', 'with', 'and', 'any', 'some', 'that', 'this',
  'million', 'thousand', 'budget', 'price', 'show', 'something',
  // price/sort words — stripped so "most expensive car" → "car" (the price intent is
  // captured separately as `sort`); critical for the no-Gemini heuristic path.
  'cheapest', 'expensive', 'most', 'lowest', 'highest', 'priciest', 'premium', 'luxury', 'affordable', 'dearest', 'top',
  'duoi', 'tren', 'quanh', 'khoang', 'trieu', 'nghin', 'ngan',
])
const keywords = (query: string) =>
  fold(query).split(/\s+/).filter((t) => t.length >= 3 && !/^\d+$/.test(t) && !STOP.has(t)).slice(0, 6)

type Understood = {
  intent: 'chat' | 'search'
  reply: string | null // chat: the whole answer; search: a short lead-in (used only when results exist)
  query: string
  brand: string | null // raw brand word, resolved against the catalogue below
  sort: Sort
  minPriceVnd: number | null
  maxPriceVnd: number | null
  categorySlug: string | null
}

const PRICE_ASC = /\b(cheap|cheapest|lowest|budget|affordable|least expensive)\b/i
const PRICE_DESC = /\b(most expensive|expensive|priciest|highest|premium|luxury|dearest)\b/i

// Pure conversation, no product ask: greetings/thanks/who-are-you in EN/VI. Matched
// against the WHOLE (short) message so "hi, need a bike" still searches. This guard
// runs before any AI/credit spend — "hi" must never cost money or dump products.
const CHAT_RE = /^(hi+|hey+|hello+|yo|sup|good (morning|afternoon|evening)|how are you\??|who are you\??|what can you do\??|help|thanks?( you)?( so much)?|thank you|ok(ay)?|xin ch[aà]o|ch[aà]o( b[aạ]n)?|c[aả]m [ơo]n( b[aạ]n)?( nhi[eề]u)?|b[aạ]n l[aà] ai\??)[.!?\s]*$/i

const chatReply = (lang: 'en' | 'vi') =>
  lang === 'vi'
    ? 'Chào bạn! Mình là eno AI — cứ nói bạn đang tìm gì là mình lo. Ví dụ: "xe máy Honda dưới 15 triệu ở Đà Nẵng", "đồng hồ Huawei", hay "phòng cho thuê gần Thảo Điền".'
    : 'Hey! I\'m eno AI — tell me what you\'re hunting for and I\'ll dig it up. Try "a Honda scooter under 15M in Da Nang", "a Huawei watch", or "a room near Thao Dien".'

// VN money phrase -> VND: "5 trieu"/"5tr"/"5 million"/"5M"=5e6, "500k"/"500 nghin"=5e5, "1 ty"=1e9.
function toVnd(num: number, unit: string | undefined): number {
  const u = (unit || '').toLowerCase()
  if (/^(t[yỷ]|b)/.test(u)) return Math.round(num * 1e9)
  if (/^(tri|tr|m|mil)/.test(u)) return Math.round(num * 1e6)
  if (/^(ng|k)/.test(u)) return Math.round(num * 1e3)
  return Math.round(num) // bare number = VND
}
function amt(numRaw: string, unit: string | undefined): number | null {
  if (unit) { const n = parseFloat(numRaw.replace(',', '.')); return isFinite(n) ? toVnd(n, unit) : null }
  const n = parseInt(numRaw.replace(/[.,\s]/g, ''), 10); return isFinite(n) ? n : null // bare: dots/commas = thousands
}
const _U = '(t[yỷ]|b|tri[eệ]u|tr|million|mil|m|ngh[ìi]n|ng[aà]n|ng|k)?'
const CAP_RE = new RegExp(`(?:under|below|less than|max(?:imum)?|up to|within|d[ưu][ơờớoò]?i|<=?)\\s*([\\d.,]+)\\s*${_U}`, 'i')
const MIN_RE = new RegExp(`(?:over|above|more than|at least|from|tr[eê]n|>=?)\\s*([\\d.,]+)\\s*${_U}`, 'i')
function parsePrice(text: string): { minPriceVnd: number | null; maxPriceVnd: number | null } {
  const cap = CAP_RE.exec(text); const min = MIN_RE.exec(text)
  return { maxPriceVnd: cap ? amt(cap[1], cap[2]) : null, minPriceVnd: min ? amt(min[1], min[2]) : null }
}

// No-Gemini fallback: chat guard + keywords + regex price/sort, so "laptop under
// 5 trieu" → {query:"laptop", maxPriceVnd:5000000} even when Gemini is down.
function heuristicUnderstand(text: string): Understood {
  if (CHAT_RE.test(text.trim())) {
    return { intent: 'chat', reply: null, query: '', brand: null, sort: null, minPriceVnd: null, maxPriceVnd: null, categorySlug: null }
  }
  const sort: Sort = PRICE_ASC.test(text) ? 'price_asc' : PRICE_DESC.test(text) ? 'price_desc' : null
  const { minPriceVnd, maxPriceVnd } = parsePrice(text)
  return { intent: 'search', reply: null, query: keywords(text).join(' ') || text.trim().slice(0, 160), brand: null, sort, minPriceVnd, maxPriceVnd, categorySlug: null }
}

// One Gemini call = the concierge's brain: intent + a natural reply + structured
// search params resolved from the WHOLE conversation ("cheapest one" after "i need a
// computer" → "computer"; a new topic replaces the old).
async function understand(messages: Msg[], cats: { slug: string }[], lang: 'en' | 'vi'): Promise<Understood> {
  const lastUser = [...messages].reverse().find((m) => m.role === 'user')!
  const fallback = heuristicUnderstand(lastUser.content)
  // The free chat guard fires regardless of Gemini availability/budget.
  if (fallback.intent === 'chat') return fallback
  const ai = getGemini()
  if (!ai) return fallback
  // Global daily Gemini budget breaker — caps total real-money understanding spend.
  // Over budget, or Redis down (strict), we degrade to the heuristic instead.
  const budget = await rateLimit('ai-concierge-gemini', 'global', 5000, '1 d', { strict: true })
  if (!budget.success) return fallback
  const transcript = messages.slice(-8).map((m) => `${m.role === 'user' ? 'Buyer' : 'Assistant'}: ${m.content}`).join('\n')
  const prompt = `You are "eno AI", the friendly shopping assistant of eno.vn — Vietnam's marketplace for the international community. A buyer is chatting with you. Decide what their LAST message needs and answer in ${lang === 'vi' ? 'Vietnamese' : 'English'}.

intent:
- "chat" — greeting, small talk, thanks, questions about you or the site, or anything that is NOT a product request. Write a warm, short reply (1-2 sentences, at most 1 emoji). If they seem lost, give ONE concrete example of what they can ask.
- "search" — they want to find something (including follow-ups like "cheaper", "the red one", "what about a watch"). Write a SHORT natural lead-in reply (under 12 words, e.g. "Here's what I found for a Huawei watch —"), and extract:
  - query: ONE concise standalone product query, resolving references from the conversation. A NEW topic replaces the old. No filler/price words.
  - brand: the brand name if one is mentioned or implied (e.g. "huawei"), else null.
  - sort: "price_asc" (cheapest/lowest) | "price_desc" (most expensive/priciest) | null.
  - maxPriceVnd / minPriceVnd: budget in VND ("5 trieu"/"5tr"/"5 million"=5000000, "500k"=500000, "1 ty"=1000000000); "under/duoi X"→max, "over/tren X"→min, else null.
  - categorySlug: the single best match from [${cats.map((c) => c.slug).join(', ')}], or null. This is only a HINT — when unsure use null.

Return ONLY JSON: {"intent":"chat"|"search","reply":"...","query":"...","brand":"..."|null,"sort":"price_asc"|"price_desc"|null,"maxPriceVnd":number|null,"minPriceVnd":number|null,"categorySlug":"..."|null}

Conversation:
${transcript}`
  try {
    const res = await ai.models.generateContent({
      model: GEMINI_MODEL,
      contents: prompt,
      config: { temperature: 0.4, maxOutputTokens: 220, thinkingConfig: { thinkingBudget: 0 }, responseMimeType: 'application/json' },
    })
    const j = JSON.parse((res.text || '').trim().replace(/^```json\s*/i, '').replace(/```$/, '')) as Partial<Record<keyof Understood, unknown>>
    const num = (v: unknown) => (typeof v === 'number' && v > 0 ? Math.round(v) : null)
    const reply = typeof j.reply === 'string' && j.reply.trim() ? j.reply.trim().slice(0, 500) : null
    if (j.intent === 'chat') {
      return { intent: 'chat', reply, query: '', brand: null, sort: null, minPriceVnd: null, maxPriceVnd: null, categorySlug: null }
    }
    return {
      intent: 'search',
      reply,
      query: String(j.query || '').trim().slice(0, 160) || fallback.query,
      brand: typeof j.brand === 'string' && j.brand.trim() ? j.brand.trim().slice(0, 40) : null,
      sort: j.sort === 'price_asc' || j.sort === 'price_desc' ? j.sort : null,
      maxPriceVnd: num(j.maxPriceVnd) ?? fallback.maxPriceVnd,
      minPriceVnd: num(j.minPriceVnd) ?? fallback.minPriceVnd,
      categorySlug: typeof j.categorySlug === 'string' && cats.some((c) => c.slug === j.categorySlug) ? j.categorySlug : null,
    }
  } catch (e) {
    console.error('[ai/concierge] understand', e)
    return fallback
  }
}

// Trust-first live-DB retrieval with a RELAXATION LADDER. Brand (resolved slug) and
// budget are what the buyer SAID — they stay hard. The category is a model guess — it
// relaxes first; then precise-AND relaxes to ANY-token. First non-empty rung wins, so
// an over-eager guess can narrow results but never fabricate an empty set.
async function fallbackSearch(
  query: string, take: number,
  f: { minPriceVnd: number | null; maxPriceVnd: number | null; categorySlug: string | null; brandSlug: string | null },
) {
  const price: Prisma.FloatFilter = {}
  if (f.minPriceVnd) price.gte = f.minPriceVnd
  if (f.maxPriceVnd) price.lte = f.maxPriceVnd
  const base: Prisma.ListingWhereInput = {
    verified: true, status: 'active',
    ...(price.gte || price.lte ? { price } : {}),
    ...(f.brandSlug ? { brandSlug: f.brandSlug } : {}),
  }
  const order: Prisma.ListingOrderByWithRelationInput[] = [RANK, { id: 'desc' }]
  // The brand word is carried by the brandSlug filter — drop it from the text tokens
  // so "huawei watch" needs only "watch" in the searchText.
  const tokens = keywords(query).filter((t) => !f.brandSlug || !f.brandSlug.includes(t))
  const clauses = tokens.map((t) => ({ searchText: { contains: t } }))
  const cat = f.categorySlug ? { category: { slug: f.categorySlug } } : null

  const rungs: Prisma.ListingWhereInput[] = []
  if (clauses.length && cat) rungs.push({ ...base, ...cat, AND: clauses })
  if (clauses.length) rungs.push({ ...base, AND: clauses })
  if (f.brandSlug) rungs.push(cat ? { ...base, ...cat } : base) // brand alone still honors budget
  if (clauses.length) rungs.push({ ...base, OR: clauses })
  if (!rungs.length) rungs.push(cat ? { ...base, ...cat } : base)

  for (const where of rungs) {
    const rows = await db.listing.findMany({ where, orderBy: order, take, include: INCLUDE })
    if (rows.length) return rows
  }
  return []
}

export async function POST(req: NextRequest) {
  // Login required + strict 10/h per account (shared AI gate) so the concierge — which
  // draws the paid Vertex/Gemini credit — can't be drained by anonymous bots. The
  // global daily Vertex/Gemini budget breakers below are the second line of defence.
  const gate = await aiGuard('concierge')
  if (!gate.ok) return gate.res

  let body: { messages?: Msg[]; lang?: string }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'bad_request' }, { status: 400 }) }
  const lang = body.lang === 'vi' ? 'vi' : 'en'
  const messages = (body.messages || []).filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string').slice(-12)
  if (![...messages].some((m) => m.role === 'user')) return NextResponse.json({ error: 'bad_request' }, { status: 400 })

  // Understand the turn: intent + natural reply + structured search params.
  const cats = await db.category.findMany({ select: { slug: true } })
  const u = await understand(messages, cats, lang)

  // Conversation, not commerce: reply warmly, show nothing for sale. Free.
  if (u.intent === 'chat') {
    return NextResponse.json({ reply: u.reply || chatReply(lang), listings: [], source: 'chat' })
  }

  // Resolve the brand word through the catalogue (typo-tolerant, read-only). Also try
  // the first query token when the model didn't flag one ("huawei watch" typed cold).
  let brandSlug: string | null = null
  if (u.brand) brandSlug = await matchBrand(u.brand, 1)
  if (!brandSlug) {
    const first = keywords(u.query)[0]
    if (first) brandSlug = await matchBrand(first, 1)
  }

  // Pull a wider set when sorting OR budget-filtering, so "cheapest under 5M" is the
  // cheapest of MANY matches; we slice back to 8 after.
  const { query, sort, minPriceVnd, maxPriceVnd, categorySlug } = u
  const take = sort || minPriceVnd || maxPriceVnd ? 24 : 8

  let reply = ''
  let source: 'vertex' | 'fallback' | 'chat' = 'fallback'
  let listingIds: string[] = []

  // Global daily Vertex AI Search budget breaker — Vertex draws the finite $1000 credit
  // (real money once exhausted), and 40/hr/IP x rotated IPs would otherwise be unbounded.
  // Over budget / Redis-down (strict) -> skip Vertex and use the free Postgres fallback.
  const vBudget = vertexConfigured()
    ? await rateLimit('ai-concierge-vertex', 'global', 20000, '1 d', { strict: true })
    : { success: false }
  if (vBudget.success) {
    const r = await conciergeSearch(query, { take, lang, categorySlug, minPriceVnd, maxPriceVnd }).catch((e) => { console.error('[ai/concierge] vertex', e); return null })
    if (r && r.listingIds.length) { listingIds = r.listingIds; reply = r.answer; source = 'vertex' }
  }

  let rows
  if (source === 'vertex' && listingIds.length) {
    // Re-validate against the LIVE table (freshness: sold/hidden items drop out even
    // if the index lags), preserving relevance order.
    const found = await db.listing.findMany({ where: { id: { in: listingIds }, verified: true, status: 'active' }, include: INCLUDE })
    rows = listingIds.map((id) => found.find((r) => r.id === id)).filter((r): r is NonNullable<typeof r> => !!r)
    // An index miss must not hide a live listing — if validation emptied the set,
    // fall through to the live-DB ladder instead of claiming "no match".
    if (!rows.length) { source = 'fallback'; reply = '' }
  }
  if (source !== 'vertex' || !rows?.length) {
    rows = await fallbackSearch(query, take, { minPriceVnd, maxPriceVnd, categorySlug, brandSlug })
  }

  // Apply explicit price-sort, then cap to 8 cards.
  if (sort) rows = [...rows].sort((a, b) => (sort === 'price_asc' ? a.price - b.price : b.price - a.price))
  rows = rows.slice(0, 8)

  const listings = rows.map(serializeListing)
  if (listings.length) {
    if (!reply) reply = u.reply || (lang === 'vi' ? 'Đây là vài lựa chọn phù hợp:' : 'Here are some good matches:')
  } else {
    // Honest empty: name what was searched so the buyer knows we understood them.
    const what = [brandSlug, ...keywords(query).filter((t) => !brandSlug || !brandSlug.includes(t))].filter(Boolean).join(' ') || query
    reply = lang === 'vi'
      ? `Hiện chưa có "${what}" nào đang bán — tin mới lên liên tục, bạn thử mô tả khác hoặc quay lại sau nhé.`
      : `Nothing matching "${what}" is live right now — new listings land all the time, so try different wording or check back soon.`
  }
  return NextResponse.json({ reply, listings, source })
}
