import { marketplaceListingScope, scopedListingWhere } from '@/lib/edition-scope'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { TAXONOMY } from '@/lib/taxonomy'
import { fold } from '@/lib/fold'
import { serializeListing } from '@/lib/serialize'
import { aiGuard } from '@/lib/ai-guard'
import { rateLimit } from '@/lib/ratelimit'
import { extractSpecs } from '@/lib/electronics-specs'

/**
 * The spec keys that are a NUMBER SOMEONE TYPED, as opposed to a product noun the extractor
 * inferred. Only these drive the spec ladder, the Vertex bypass and the exact/relaxed decision.
 */
const NUMERIC_SPEC_KEYS = new Set(['ram', 'storage', 'caseSize', 'screenSize', 'laptopSize', 'refreshRate', 'wattage', 'capacity'])
import { conciergeSearch, vertexConfigured } from '@/lib/vertex-search'
import { getGemini, GEMINI_MODEL } from '@/lib/gemini'
import { matchBrand } from '@/lib/brand'
import type { Prisma } from '@/generated/prisma/client'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// AI shopping concierge — the "AI mode" chat (a conversation in the messages tab). A
// buyer describes what they want in natural language (EN/VI); we return a grounded
// reply + matching listings as cards. Login-only + per-account rate limit via aiGuard;
// daily budget breakers below.
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
  subcategorySlug: string | null
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
    return { intent: 'chat', reply: null, query: '', brand: null, sort: null, minPriceVnd: null, maxPriceVnd: null, categorySlug: null, subcategorySlug: null }
  }
  const sort: Sort = PRICE_ASC.test(text) ? 'price_asc' : PRICE_DESC.test(text) ? 'price_desc' : null
  const { minPriceVnd, maxPriceVnd } = parsePrice(text)
  return { intent: 'search', reply: null, query: keywords(text).join(' ') || text.trim().slice(0, 160), brand: null, sort, minPriceVnd, maxPriceVnd, categorySlug: null, subcategorySlug: null }
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
  - subcategorySlug: the single best match from [${SUBCATS.join(', ')}], or null. THIS IS THE ONE THAT
    MATTERS FOR DEVICES. "cheap iphone" means the PHONE (phones-tablets), not the 1,239 iPhone cases
    that also mention iPhone; "case for iphone" means phone-cases. If they name a device, pick the
    device's subcategory; if they name an accessory, pick the accessory's. When unsure use null.

Return ONLY JSON: {"intent":"chat"|"search","reply":"...","query":"...","brand":"..."|null,"sort":"price_asc"|"price_desc"|null,"maxPriceVnd":number|null,"minPriceVnd":number|null,"categorySlug":"..."|null,"subcategorySlug":"..."|null}

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
      return { intent: 'chat', reply, query: '', brand: null, sort: null, minPriceVnd: null, maxPriceVnd: null, categorySlug: null, subcategorySlug: null }
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
      subcategorySlug: typeof j.subcategorySlug === 'string' && SUBCATS.includes(j.subcategorySlug) ? j.subcategorySlug : null,
    }
  } catch (e) {
    console.error('[ai/concierge] understand', e)
    return fallback
  }
}

// Trust-first live-DB retrieval with a RELAXATION LADDER. Brand (resolved slug) and
// budget are what the buyer SAID — they stay hard. The category is a model guess — it
// relaxes first; then the token set relaxes by DROPPING TRAILING WORDS ("iphone pro
// max" → "iphone pro" → "iphone"), because the head noun names the product and the
// tail refines it — a plain OR would let "pro" surface AirPods for an iPhone ask, and
// a brand-alone rung dumped every Apple device for "iphone 16 pro max". First
// non-empty rung wins; `relaxed` tells the caller the results are closest-matches,
// not exact, so the reply can say so honestly.
/**
 * Every subcategory slug the taxonomy defines, as the model's allow-list.
 *
 * ⛔ THIS EXISTS BECAUSE "cheap iphone" ANSWERED WITH CAMERA LENS PROTECTORS. The concierge only
 * ever extracted a TOP-LEVEL category, so an iPhone query became `electronics` — which holds the
 * phones AND the 1,239 iPhone cases, and sorting those by price puts a 240,000đ lens protector
 * above every actual phone. The subcategory is the field that separates a device from the things
 * that fit it, and it only became usable once the catalogue was classified properly.
 */
const SUBCATS: string[] = [...new Set(
  (TAXONOMY as { subcategories?: { slug: string }[] }[]).flatMap((c) => (c.subcategories ?? []).map((sc) => sc.slug)),
)]

async function fallbackSearch(
  query: string, take: number,
  f: { minPriceVnd: number | null; maxPriceVnd: number | null; categorySlug: string | null; subcategorySlug: string | null; brandSlug: string | null; sort?: Sort; specs?: Record<string, string> },
): Promise<{ rows: Awaited<ReturnType<typeof db.listing.findMany<{ include: typeof INCLUDE }>>>; relaxed: boolean }> {
  const price: Prisma.FloatFilter = {}
  if (f.minPriceVnd) price.gte = f.minPriceVnd
  if (f.maxPriceVnd) price.lte = f.maxPriceVnd
  /**
   * ⚠️ THE EXCLUSION GOES IN AS A PLAIN `sellerId` KEY, NOT VIA scopedListingWhere, AND THIS IS THE
   * ONE PLACE WHERE THAT MATTERS. Every rung below is built by SPREADING this object —
   * `{ ...base, ...cat, AND: and(n) }` — so an `{ AND: [...] }` wrapper would be silently
   * OVERWRITTEN by the rung's own `AND`, and the exclusion would vanish with no error and no test
   * failure. The sibling recommendations route composes its base as an AND operand and can be
   * scoped the normal way; do not copy that pattern here.
   *
   * `sellerId` is safe as a flat key because no rung sets one of its own.
   */
  const editionScope = await marketplaceListingScope()
  const base: Prisma.ListingWhereInput = {
    verified: true, status: 'active',
    ...(price.gte || price.lte ? { price } : {}),
    ...(f.brandSlug ? { brandSlug: f.brandSlug } : {}),
    ...editionScope,
  }
  /**
   * ⛔ AN EXPLICIT PRICE SORT MUST BE DONE BY THE DATABASE, ACROSS THE WHOLE MATCHING SET.
   * This ordered by rank and then re-sorted the fetched page in JS, which answers a different
   * question: "the priciest of the N most relevant" rather than "the priciest". Owner, 2026-08-25,
   * asked for the most expensive phones and got a 13,090,000đ handset while the catalogue holds
   * 40,000,000đ+ ones — the expensive phones were simply never in the page that got sorted.
   * `id` stays as the tiebreaker so paging is stable when prices tie.
   */
  const order: Prisma.ListingOrderByWithRelationInput[] =
    f.sort === 'price_desc' ? [{ price: 'desc' }, { id: 'desc' }]
    : f.sort === 'price_asc' ? [{ price: 'asc' }, { id: 'desc' }]
    : [RANK, { id: 'desc' }]
  /**
   * ⛔ SPECS ARE A FILTER, NOT KEYWORDS. "a laptop with 128gb ram" was tokenised into
   * "laptop"/"128gb"/"ram" and matched against `searchText`, which holds the product TITLE — and
   * CellphoneS titles carry a SKU, not a spec. So the query found nothing and the assistant said
   * "no exact match" while 128GB machines sat in the catalogue (owner, 2026-08-25: "also no ram
   * context if we sorted them properly it would find").
   * Reading the same closed-list extractor the catalogue was indexed with turns "128gb ram" into
   * `attributes contains '"ram":"128"'` — the exact byte sequence the enrichment pass wrote.
   * ⚠️ It is the TOP rung only. If nothing matches the spec, the ladder below relaxes to the plain
   * text rungs, so a spec nobody stocks degrades to "here is the closest" rather than to nothing.
   */
  // Extracted by the caller (so the Vertex bypass can see it); recomputed only if absent.
  // ⚠️ NUMERIC KEYS ONLY — see NUMERIC_SPEC_KEYS. A categorical key here would turn every
  // "microphone"/"webcam"/"router" query into a spec query.
  const specs = f.specs ?? (f.subcategorySlug
    ? Object.fromEntries(Object.entries(extractSpecs(f.subcategorySlug, query)).filter(([k]) => NUMERIC_SPEC_KEYS.has(k)))
    : {})
  /**
   * ⛔ ATTRIBUTE **OR** LITERAL TITLE — NOT ATTRIBUTES ALONE. Requiring the attribute made merchant
   * stock shadow the marketplace's own users: a person's "iPhone 15 Pro 256GB" carries the spec in
   * its TITLE and has no `attributes` (it never went through the import enrichment), so the
   * enriched CellphoneS rows satisfied the rung, the ladder stopped, and the neighbour's phone was
   * never queried. On a marketplace that is exactly backwards.
   * ⚠️ The text half is weaker evidence — "128gb" in a title could be the SSD rather than the RAM —
   * but it is the only evidence an unenriched listing can offer, and putting both in ONE rung means
   * the peer and the merchant surface together and are ranked normally, instead of one hiding the
   * other.
   */
  // The brand word is carried by the brandSlug filter — drop it from the text tokens
  // so "huawei watch" needs only "watch" in the searchText.
  /**
   * ⚠️ A SPEC WORD IS ALSO CARRIED BY ITS FILTER AND MUST LEAVE THE TEXT TOKENS. "a laptop with
   * 128gb ram" tokenises to laptop/128gb/ram, and these titles hold a SKU — so requiring "128gb"
   * in `searchText` guarantees zero rows even on the relaxed rungs, defeating the whole ladder.
   * With the spec words removed the text side asks only for "laptop", which is answerable.
   */
  /**
   * Drop the words the SPEC FILTER now carries, so the text side is not asked for them twice.
   *
   * ⛔ ONLY WHEN A SPEC WAS ACTUALLY EXTRACTED, and only by SHAPE — never by value. Three
   * regressions came out of trying to be cleverer than this, each found by reviewers:
   *   · stripping "ram" unconditionally gutted "RAM laptop" (someone shopping for memory sticks)
   *     while adding no filter to replace it;
   *   · stripping every bare number deleted the "15" from "iPhone 15 256GB", so an iPhone 11 came
   *     back as an EXACT match;
   *   · stripping by spec VALUE deleted the "16" from "MacBook Pro 16 16GB", which is the same bug
   *     wearing a different hat — a 14-inch MacBook returned as exactly what was asked for.
   * What is safe to remove is narrow: a unit word, a number fused to its unit ("256gb"), and a
   * bare number IMMEDIATELY followed by a unit word (the "1" of a spaced "1 TB"). A model
   * identifier is never any of those.
   */
  /**
   * ⚠️ ONLY THE UNITS WHOSE SPEC WAS ACTUALLY EXTRACTED. Stripping every unit word on sight
   * removed the still-meaningful "ssd" from "16GB RAM SSD laptop" — where only `ram` was
   * extracted — so the filter no longer asked for an SSD at all and an HDD machine could come
   * back as an exact match. A word is only redundant once a filter is genuinely carrying it.
   */
  const UNIT_FOR: Record<string, RegExp> = {
    ram: /^ram$/i,
    storage: /^(ssd|hdd|rom|storage|bo|bộ|nho|nhớ|trong|dung|luong|lượng)$/i,
    caseSize: /^mm$/i, screenSize: /^(inch|inches)$/i, laptopSize: /^(inch|inches)$/i,
    refreshRate: /^hz$/i, wattage: /^w$/i, capacity: /^mah$/i,
  }
  const SIZE_UNIT = /^(gb|tb|mm|hz|w|mah|inch|inches)$/i
  /**
   * ⚠️ A UNIT WORD IS ONLY REDUNDANT IF AN EXTRACTED SPEC USES THAT UNIT. "16GB RAM 7 TB laptop"
   * extracts ram=16 and REJECTS 7TB (not a legal storage size); stripping "tb" anyway left a bare
   * "7" in the tokens and dropped the 7TB requirement from the query altogether.
   */
  const UNIT_OF: Record<string, RegExp> = {
    ram: /^(gb|tb)$/i, storage: /^(gb|tb)$/i, caseSize: /^mm$/i,
    screenSize: /^(inch|inches)$/i, laptopSize: /^(inch|inches)$/i,
    refreshRate: /^hz$/i, wattage: /^w$/i, capacity: /^mah$/i,
  }
  const unitIsCarried = (t: string) => Object.keys(specs).some((k) => UNIT_OF[k]?.test(t))
  const FUSED = /^\d+(gb|tb|mm|hz|w|mah|inch)$/i
  const hasSpecs = Object.keys(specs).length > 0
  const isRedundantUnit = (t: string) =>
    (SIZE_UNIT.test(t) && unitIsCarried(t)) || Object.keys(specs).some((k) => UNIT_FOR[k]?.test(t))
  /**
   * ⚠️ A FUSED CAPACITY IS ONLY REDUNDANT IF ITS SPEC WAS ACTUALLY EXTRACTED. "16GB RAM 7TB laptop"
   * yields ram=16 and REJECTS 7TB (not a legal storage size), so stripping "7tb" as well would
   * drop the storage requirement from both the filter AND the text — and hand back any 16GB
   * laptop as an exact match to a query that asked for 7TB.
   */
  const extractedValues = new Set(Object.values(specs).map(String))
  const capacityIsCarried = (t: string) => {
    const m = t.match(/^(\d+)(gb|tb|mm|hz|w|mah|inch)$/i)
    if (!m) return false
    const n = m[2].toLowerCase() === 'tb' ? Number(m[1]) * 1024 : Number(m[1])
    return extractedValues.has(String(n))
  }
  const stripSpecWords = (list: string[]) => !hasSpecs ? list : list.filter((t, i) =>
    !isRedundantUnit(t) && !capacityIsCarried(t)
    && !(/^\d+$/.test(t) && SIZE_UNIT.test(list[i + 1] ?? '') && capacityIsCarried(t + list[i + 1])))
  const tokens = stripSpecWords(keywords(query))
    .filter((t) => !f.brandSlug || !f.brandSlug.includes(t))
  // Match a token at a WORD BOUNDARY, not as a raw substring. A plain `contains: 'pen'`
  // (LIKE '%pen%') matched "dependable", so "pen" surfaced a motorcycle; word-boundary
  // matching keeps the real hits ("pen" → "pencil", "pens") and drops the buried-
  // substring noise ("pen"→"dependable/open", "art"→"apartment"). A token is a word
  // start iff it begins the blob OR follows a boundary char. fold() KEEPS punctuation,
  // so the boundary isn't only a space — "scooter" lives in "e-scooter" and "(scooter)";
  // a space-only test silently halved scooter recall. This BOUNDARY set reproduces a
  // true `~ '(^|[^a-z0-9])tok'` regex exactly across the live table (verified per-token:
  // pen 2→1, scooter 50→100, art 144→28). Prisma has no regex filter, and widening the
  // shared fold() would ripple into phone/banned-word detection — so we enumerate here.
  // (Vertex semantic search is the primary path; this is the free Postgres fallback.)
  const BOUNDARY = [' ', '-', '/', '(', ',', '.', '&']
  const wordMatch = (t: string): Prisma.ListingWhereInput => ({
    OR: [
      { searchText: { startsWith: t } },
      ...BOUNDARY.map((b): Prisma.ListingWhereInput => ({ searchText: { contains: `${b}${t}` } })),
    ],
  })

  /**
   * ⚠️ MUST SIT BELOW `wordMatch`: these `.map`s run IMMEDIATELY, so referencing a `const` declared
   * further down is a temporal-dead-zone ReferenceError at request time. TypeScript does not flag
   * it, because the reference sits inside a callback.
   */
  const and = (n: number) => tokens.slice(0, n).map(wordMatch)
  const cat = f.categorySlug ? { category: { slug: f.categorySlug } } : null
  const sub = f.subcategorySlug ? { subcategorySlug: f.subcategorySlug } : null

  const FUSED_RE = /^(\d+)(gb|tb|mm|hz|w|mah|inch)$/i
  /**
   * The query token that produced a given spec value — "128" came from "128gb", "1024" from "1tb".
   * ⛔ PAIRED, NOT POOLED. An earlier version OR'd every spec key against EVERY fused token in the
   * query, so "16GB RAM 512GB SSD" let a listing containing only "512gb" satisfy the RAM clause
   * too. Three reviewers found it in the same round.
   */
  const tokenFor = (value: string) => keywords(query).filter((t) => {
    const m = t.match(FUSED_RE)
    if (!m) return false
    const n = m[2].toLowerCase() === 'tb' ? Number(m[1]) * 1024 : Number(m[1])
    return String(n) === value
  })
  /**
   * ⛔ THE EXACT RUNGS MATCH ATTRIBUTES ONLY, AND THIS WAS ARGUED BOTH WAYS BEFORE IT SETTLED.
   * An earlier version put attribute-OR-title in ONE rung so a peer's listing and a merchant's
   * surfaced together. Two reviewers rejected it and they were right: a capacity in a title says
   * nothing about WHICH component it belongs to. A capacity in a title is not evidence of WHICH
   * component it belongs to — "128gb ram" word-matches "Laptop HP 8GB RAM 128GB SSD", where the
   * 128 is the disk. Calling that an exact answer is a confident lie about a product someone may
   * buy, and it is the failure mode this whole spec pass exists to remove.
   * ⚠️ THE COST, STATED PLAINLY, BECAUSE A THIRD REVIEWER OBJECTED TO EXACTLY THIS: a person's own
   * unenriched "iPhone 15 Pro 256GB" carries its spec only in the title, so it cannot reach an
   * exact rung, and while the merchant has matching stock the ladder stops above the literal rung —
   * so the peer listing is not shown at all for that query. That is a real cost on a marketplace
   * and it is chosen deliberately: presenting an 8GB machine as an exact answer to "128GB RAM" is a
   * confident lie about something someone may buy, and a ranking miss is not.
   * ⛔ THE ACTUAL FIX IS TO ENRICH PEER LISTINGS, NOT TO LOWER THE BAR. `extractSpecs` needs only a
   * subcategory and a title — nothing about it is import-specific — so running the enrichment pass
   * across seller-posted listings puts them on the exact rung beside the merchant, where they
   * belong. scripts/enrich-electronics.ts is scoped to one seller today purely because that is the
   * catalogue it was written for.
   */
  const specWhere: Prisma.ListingWhereInput[] = Object.entries(specs)
    .map(([k, v]) => ({ attributes: { contains: `"${k}":"${v}"` } }))
  /** The same asks, as literal title text — weaker evidence, so it only ever feeds a relaxed rung. */
  const specTextWhere: Prisma.ListingWhereInput[] = Object.entries(specs)
    .map(([, v]) => ({ OR: tokenFor(v).map(wordMatch) }))
    .filter((w) => w.OR!.length > 0)

  // rungs[i].exact — only the full token set (with or without the guessed category)
  // counts as an exact answer; every relaxation is flagged.
  const rungs: { where: Prisma.ListingWhereInput; exact: boolean }[] = []
  /**
   * ⛔ THE SPEC RUNG ANDs WITH THE WORDS. Filtering on the spec ALONE and calling it exact meant
   * "Dell XPS 16GB RAM" could answer with any 16GB laptop and report it as an exact match — the
   * brand and model silently discarded. Two reviewers found this independently. Specs narrow the
   * text match; they never replace it.
   * ⚠️ The spec-only rung below is kept, but marked RELAXED, so an unstocked combination still
   * degrades to "here are the closest" rather than to nothing.
   */
  /**
   * ⛔ ONCE A SPEC HAS BEEN ASKED FOR, NO SPEC-LESS RUNG IS AN EXACT ANSWER. "Dell XPS 128GB RAM"
   * with no 128GB machine stocked falls past the spec rungs to plain "Dell XPS", and would
   * otherwise present a 16GB laptop as exactly what was asked for. `relaxed` is what makes the
   * assistant say "no exact match — here are the closest", which is the honest answer.
   * ⚠️ It also covers a subcategory whose rows are not enriched yet: with no attributes to match,
   * EVERY spec query would otherwise come back as a confident text-only hit.
   */
  const exactText = !specWhere.length
  if (specWhere.length && tokens.length && sub) rungs.push({ where: { ...base, ...sub, AND: [...and(tokens.length), ...specWhere] }, exact: true })
  if (specWhere.length && tokens.length) rungs.push({ where: { ...base, AND: [...and(tokens.length), ...specWhere] }, exact: true })
  /**
   * The literal-title path, for rows the enrichment never touched (see specTextWhere above).
   * ⛔ RELAXED, NEVER EXACT, AND IT SITS ABOVE THE SPEC-ONLY RUNG. Two things three reviewers
   * agreed on, both right:
   *   · It is a BAG OF WORDS. "128gb ram" word-matches "Laptop HP 8GB RAM 128GB SSD", whose 128GB
   *     is the disk — the exact adjacency the extractor exists to get right. A text hit on spec
   *     words is a plausible match, not a verified one, so it must not claim to be exact.
   *   · Placed BELOW the spec-only rung it was unreachable: an unstocked spec stopped the ladder
   *     at "any 16GB laptop" and the peer's correctly-titled listing never surfaced.
   * Above it and honest about itself, a person's own unenriched listing shows up among "the
   * closest ones" — which is where an unverifiable match belongs.
   */
  const specOnly = specWhere.length && sub
    ? [{ where: { ...base, ...sub, AND: specWhere }, exact: !tokens.length }] : []
  // Literal-title fallback for rows the enrichment never touched. Always relaxed — see above.
  const literal = specTextWhere.length ? [
    { where: { ...base, ...sub, AND: [...and(tokens.length), ...specTextWhere] }, exact: false },
    { where: { ...base, AND: [...and(tokens.length), ...specTextWhere] }, exact: false },
  ] : []
  /**
   * ⛔ THE ORDER DEPENDS ON WHETHER ANY WORDS SURVIVED THE STRIP.
   *   · A PURE spec query ("128GB RAM") leaves no tokens, so the attribute rung IS the exact
   *     answer and must come first — otherwise the bag-of-words rung matched a title mentioning
   *     both words on different components and reported "no exact match" while real inventory sat
   *     one rung below.
   *   · A query with words ("Dell XPS 16GB RAM") wants the literal title first, because that is
   *     the only rung that can find a PERSON's unenriched "Dell XPS 16GB RAM" listing; the
   *     spec-only rung would answer with an Asus and stop the ladder.
   */
  rungs.push(...(tokens.length ? [...literal, ...specOnly] : [...specOnly, ...literal]))
  if (tokens.length && sub) rungs.push({ where: { ...base, ...sub, AND: and(tokens.length) }, exact: exactText })
  /**
   * ⛔ NOT `exact` WHEN A SPEC WAS ASKED FOR AND NOT FOUND. "128GB RAM laptop" leaves no text
   * tokens once the spec words are stripped, so an unstocked spec fell through to this rung and
   * returned every laptop in the subcategory — labelled as an EXACT match. Saying "here are 8GB
   * machines, exactly what you asked for" is worse than saying nothing.
   */
  if (sub && !tokens.length) rungs.push({ where: { ...base, ...sub }, exact: exactText })
  if (tokens.length && cat) rungs.push({ where: { ...base, ...cat, AND: and(tokens.length) }, exact: exactText })
  if (tokens.length) rungs.push({ where: { ...base, AND: and(tokens.length) }, exact: exactText })
  for (let n = tokens.length - 1; n >= 1; n--) rungs.push({ where: { ...base, AND: and(n) }, exact: false })
  // ⚠️ `exactText` here too — a branded spec query whose spec is unstocked ("Dell 128GB RAM")
  // would otherwise fall to brand-alone and present any Dell as an exact match.
  if (f.brandSlug) rungs.push({ where: cat ? { ...base, ...cat } : base, exact: !tokens.length && exactText }) // brand alone still honors budget
  if (tokens.length > 1) rungs.push({ where: { ...base, OR: and(tokens.length) }, exact: false })
  if (!rungs.length) rungs.push({ where: cat ? { ...base, ...cat } : base, exact: exactText })

  for (const rung of rungs) {
    const rows = await db.listing.findMany({ where: rung.where, orderBy: order, take, include: INCLUDE })
    if (rows.length) return { rows, relaxed: !rung.exact }
  }
  return { rows: [], relaxed: false }
}

// ⚠️ WS6 — NOT MIGRATED, AND UNLIKE ITS THREE /api/ai SIBLINGS THE REASON IS NOT THE WIRE. Stated
// plainly because the next reader will re-derive it: `{ auth: 'userId', rateLimit: { bucket:
// 'ai-concierge', limit: 10, window: '1 h', strict: true } }` reproduces this gate byte-for-byte —
// aiGuard resolves the caller with the same `getCurrentProfileId()` and emits the same
// `{"error":"auth_required"}` 401 and `{"error":"rate_limited"}` 429, in the same order, keyed on
// the same profile id. The refusal is about what the migration would DELETE, not what it changes:
//   · aiGuard IS the paid-AI policy, in one file, for SEVEN routes (the four /api/ai handlers and
//     the three itinerary ones). Its subject is credit drain — `AI_HOURLY_LIMIT` and
//     `AI_GLOBAL_DAILY_LIMIT` are exported constants with the threat model written above them.
//     Expressing it as a config literal at one call site is exactly the drift that file exists to
//     prevent, and the drift would be permanent: the other three /api/ai routes CANNOT follow,
//     because `getGemini()` answers 503 ahead of their auth (see the note on each).
//   · `{ skipGlobal: true }` is the one recorded exception to the global daily ceiling in the
//     codebase — this route opts out because it degrades to heuristics instead of 429ing. As a
//     `rateLimit:` option that opt-out has nowhere to live; it becomes the absence of a second
//     bucket, which reads as an oversight rather than a decision.
//   · No `body:` schema either: `messages` is validated by FILTERING (unknown roles and non-string
//     contents are dropped, then the last 12 kept), so a schema strict enough to type it would
//     reject bodies that succeed today, and one loose enough to accept them would validate nothing.
export async function POST(req: NextRequest) {
  // Login required + strict 10/h per account (shared AI gate) so the concierge — which
  // draws the paid Vertex/Gemini credit — can't be drained by anonymous bots. The
  // global daily Vertex/Gemini budget breakers below are the second line of defence.
  const gate = await aiGuard('concierge', undefined, { skipGlobal: true }) // concierge has its own daily breakers with graceful heuristic degrade
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
  const { query, sort, minPriceVnd, maxPriceVnd, categorySlug, subcategorySlug } = u
  const take = sort || minPriceVnd || maxPriceVnd ? 24 : 8

  let reply = ''
  let source: 'vertex' | 'fallback' | 'chat' = 'fallback'
  let listingIds: string[] = []

  // Global daily Vertex AI Search budget breaker — Vertex draws the finite $1000 credit
  // (real money once exhausted), and 40/hr/IP x rotated IPs would otherwise be unbounded.
  // Over budget / Redis-down (strict) -> skip Vertex and use the free Postgres fallback.
  /**
   * ⛔ AN EXPLICIT PRICE SORT SKIPS VERTEX ENTIRELY. Vertex ranks by SEMANTIC relevance and cannot
   * be asked to order by price, so its rows are a subset — and sorting a subset answers "the
   * priciest of the most relevant", which is the exact wrong answer the owner reported (a
   * 13,090,000đ phone offered as the most expensive while the catalogue holds an 80,990,000đ one).
   * The Postgres path CAN order by price across the whole matching set, so for "cheapest" and
   * "most expensive" it is not the fallback — it is the only one that can be right.
   */
  /**
   * ⛔ A SPEC QUERY SKIPS VERTEX TOO, AND THIS IS THE CASE THAT ACTUALLY MATTERS IN PRODUCTION.
   * Vertex is semantic: it cannot filter on `attributes`, so when it answers at all the whole
   * spec ladder below is skipped and "a laptop with 128gb ram" is served exactly as it was before
   * any of this — a reviewer pointed out the fix was only observable with Vertex off or over
   * budget, which is the state it was tested in, not the state prod is in.
   * ⚠️ Extracted HERE rather than inside fallbackSearch so the decision can see it; the same
   * object is passed down, so there is one extraction and one source of truth.
   */
  const querySpecs = subcategorySlug ? extractSpecs(subcategorySlug, query) : {}
  /**
   * ⛔ ONLY A **NUMERIC** SPEC TAKES OVER THE SEARCH. `extractSpecs` also returns categorical keys
   * — audioType, cameraKind, printerKind, deviceKind — which it derives from the product NOUN.
   * Letting those drive this logic meant that typing "microphone rode" disabled semantic search
   * for the entire audio category and marked every result "no exact match", because the word
   * "microphone" looked like a spec. A capacity or a case size is a constraint somebody typed on
   * purpose; a product noun is just the thing they are shopping for, and Vertex is better at it.
   */
  const numericSpecs = Object.fromEntries(
    Object.entries(querySpecs).filter(([k]) => NUMERIC_SPEC_KEYS.has(k)))
  const vBudget = vertexConfigured() && !sort && !Object.keys(numericSpecs).length
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
    /**
     * ⚠️ THE ONLY PER-REQUEST ENFORCEMENT POINT FOR VERTEX RESULTS, AND IT IS NOT OPTIONAL. The
     * Vertex datastore is edition-BLIND: ListingDoc carries neither sellerId nor subcategorySlug, so
     * no Vertex-side filter can express this exclusion, and the desk's documents were written into
     * the index by the services build. A code fix alone leaves them there. This re-validation
     * against the live table is what stops them being returned on eno.vn — the backfill still has
     * to be re-run to clear the index itself.
     */
    const found = await db.listing.findMany({ where: await scopedListingWhere({ id: { in: listingIds }, verified: true, status: 'active' }), include: INCLUDE })
    rows = listingIds.map((id) => found.find((r) => r.id === id)).filter((r): r is NonNullable<typeof r> => !!r)
    // An index miss must not hide a live listing — if validation emptied the set,
    // fall through to the live-DB ladder instead of claiming "no match".
    if (!rows.length) { source = 'fallback'; reply = '' }
  }
  let relaxed = false
  if (source !== 'vertex' || !rows?.length) {
    const r = await fallbackSearch(query, take, { minPriceVnd, maxPriceVnd, categorySlug, subcategorySlug, brandSlug, sort, specs: numericSpecs })
    rows = r.rows
    relaxed = r.relaxed
  }

  /**
   * Re-sort in JS as well, and it is NOT redundant: the Vertex path returns semantic matches in
   * relevance order and cannot be told to order by price, so its rows still need this. The
   * fallback path is already ordered by the database, where sorting a page is a no-op.
   */
  if (sort) rows = [...rows].sort((a, b) => (sort === 'price_asc' ? a.price - b.price : b.price - a.price))
  rows = rows.slice(0, 8)

  const listings = rows.map(serializeListing)
  if (listings.length) {
    // Relaxed rung = we did NOT find the exact ask — say so instead of pretending
    // ("iphone 16 pro max" → closest iPhones, never a silent pile of iPads).
    if (relaxed) {
      reply = lang === 'vi'
        ? `Chưa có đúng "${query}" — đây là những món gần nhất đang bán:`
        : `No exact match for "${query}" right now — here are the closest ones live:`
    } else if (!reply) {
      reply = u.reply || (lang === 'vi' ? 'Đây là vài lựa chọn phù hợp:' : 'Here are some good matches:')
    }
  } else {
    // Honest empty: name what was searched so the buyer knows we understood them.
    const what = [brandSlug, ...keywords(query).filter((t) => !brandSlug || !brandSlug.includes(t))].filter(Boolean).join(' ') || query
    reply = lang === 'vi'
      ? `Hiện chưa có "${what}" nào đang bán — tin mới lên liên tục, bạn thử mô tả khác hoặc quay lại sau nhé.`
      : `Nothing matching "${what}" is live right now — new listings land all the time, so try different wording or check back soon.`
  }
  return NextResponse.json({ reply, listings, source })
}
