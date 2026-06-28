import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { fold } from '@/lib/fold'
import { serializeListing } from '@/lib/serialize'
import { clientIp } from '@/lib/client-ip'
import { rateLimit } from '@/lib/ratelimit'
import { conciergeSearch, vertexConfigured } from '@/lib/vertex-search'
import { getGemini, GEMINI_MODEL } from '@/lib/gemini'
import type { Prisma } from '@/generated/prisma/client'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// AI shopping concierge — the "AI mode" chat (a conversation in the messages tab). A
// buyer describes what they want in natural language (EN/VI); we return a grounded
// reply + matching listings as cards. Public but IP-rate-limited.
//
// Multi-turn: a tiny Gemini call rewrites the latest message into a STANDALONE query
// using the conversation ("cheapest one" after "i need a computer" → "cheapest
// computer"; "what about a bmw" after "pen" → "bmw" — a new topic replaces the old).
// Retrieval + the reply summary run on VERTEX AI SEARCH so they DRAW THE CREDIT (the
// rewrite is fractions of a cent). Falls back to a trust-first Postgres keyword search
// (source:"fallback") when the data store isn't configured.

type Msg = { role: 'user' | 'assistant'; content: string }
type Sort = 'price_asc' | 'price_desc' | null

const TRUST: Prisma.ListingOrderByWithRelationInput = { seller: { trustScore: 'desc' } }
const INCLUDE = { category: true, seller: { include: { owner: { select: { accountType: true } } } } } as const

// Folded EN + VI fillers (VI limited to non-colliding words) for the keyword fallback.
const STOP = new Set([
  'under', 'over', 'near', 'around', 'below', 'above', 'about', 'less', 'than', 'cheap', 'good', 'best',
  'find', 'want', 'need', 'looking', 'please', 'the', 'for', 'with', 'and', 'any', 'some', 'that', 'this',
  'million', 'thousand', 'budget', 'price', 'show', 'something',
  'duoi', 'tren', 'quanh', 'khoang', 'trieu', 'nghin', 'ngan',
])
const keywords = (query: string) =>
  fold(query).split(/\s+/).filter((t) => t.length >= 3 && !/^\d+$/.test(t) && !STOP.has(t)).slice(0, 6)

// Context-aware query rewrite — the key to follow-ups. Turns the buyer's latest message
// into a standalone product query using the conversation, and detects price-sort intent.
async function rewriteQuery(messages: Msg[]): Promise<{ query: string; sort: Sort }> {
  const lastUser = [...messages].reverse().find((m) => m.role === 'user')!
  const fallback: { query: string; sort: Sort } = { query: lastUser.content.trim().slice(0, 160), sort: null }
  const ai = getGemini()
  if (!ai) return fallback
  const transcript = messages.slice(-8).map((m) => `${m.role === 'user' ? 'Buyer' : 'Assistant'}: ${m.content}`).join('\n')
  const prompt = `A buyer is chatting to find products on the eno.vn marketplace in Vietnam. Rewrite their LAST message into ONE concise standalone product-search query, RESOLVING references using the conversation:
- "cheapest one" / "cheaper" after talking about computers → "computer"
- "the red one" → keep the item + "red"
- "what about a bmw" → "bmw car" (a NEW topic REPLACES the previous item)
Detect price-sort intent: cheapest/lowest/budget → "price_asc"; most expensive/premium/highest → "price_desc"; otherwise null.
Return ONLY JSON: {"query":"<a few search keywords, no filler words>","sort":"price_asc"|"price_desc"|null}

Conversation:
${transcript}`
  try {
    const res = await ai.models.generateContent({
      model: GEMINI_MODEL,
      contents: prompt,
      config: { temperature: 0, maxOutputTokens: 120, thinkingConfig: { thinkingBudget: 0 }, responseMimeType: 'application/json' },
    })
    const j = JSON.parse((res.text || '').trim().replace(/^```json\s*/i, '').replace(/```$/, '')) as { query?: string; sort?: string }
    const query = String(j.query || '').trim().slice(0, 160) || fallback.query
    const sort: Sort = j.sort === 'price_asc' || j.sort === 'price_desc' ? j.sort : null
    return { query, sort }
  } catch (e) {
    console.error('[ai/concierge] rewrite', e)
    return fallback
  }
}

// Trust-first keyword fallback (no AI/credit): precise AND, then broaden to ANY token.
async function fallbackSearch(query: string, take: number) {
  const base: Prisma.ListingWhereInput = { verified: true, status: 'active' }
  const order: Prisma.ListingOrderByWithRelationInput[] = [TRUST, { featured: 'desc' }, { postedAt: 'desc' }, { id: 'desc' }]
  const tokens = keywords(query)
  if (!tokens.length) return db.listing.findMany({ where: base, orderBy: order, take, include: INCLUDE })
  const clauses = tokens.map((t) => ({ searchText: { contains: t } }))
  const and = await db.listing.findMany({ where: { ...base, AND: clauses }, orderBy: order, take, include: INCLUDE })
  if (and.length) return and
  return db.listing.findMany({ where: { ...base, OR: clauses }, orderBy: order, take, include: INCLUDE })
}

export async function POST(req: NextRequest) {
  const ip = clientIp(req)
  const rl = await rateLimit('ai-concierge', ip, 40, '1 h')
  if (!rl.success) return NextResponse.json({ error: 'rate_limited' }, { status: 429 })

  let body: { messages?: Msg[]; lang?: string }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'bad_request' }, { status: 400 }) }
  const lang = body.lang === 'vi' ? 'vi' : 'en'
  const messages = (body.messages || []).filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string').slice(-12)
  if (![...messages].some((m) => m.role === 'user')) return NextResponse.json({ error: 'bad_request' }, { status: 400 })

  // Resolve the follow-up into a standalone query (+ sort intent) from the conversation.
  const { query, sort } = await rewriteQuery(messages)
  // When sorting by price, pull a wider relevant set so "cheapest" is the cheapest of
  // many matches, not just of the top few; we slice back to 8 after sorting.
  const take = sort ? 24 : 8

  let reply = ''
  let source: 'vertex' | 'fallback' = 'fallback'
  let listingIds: string[] = []

  if (vertexConfigured()) {
    const r = await conciergeSearch(query, { take, lang }).catch((e) => { console.error('[ai/concierge] vertex', e); return null })
    if (r && r.listingIds.length) { listingIds = r.listingIds; reply = r.answer; source = 'vertex' }
  }

  let rows
  if (source === 'vertex' && listingIds.length) {
    const found = await db.listing.findMany({ where: { id: { in: listingIds }, verified: true, status: 'active' }, include: INCLUDE })
    rows = listingIds.map((id) => found.find((r) => r.id === id)).filter((r): r is NonNullable<typeof r> => !!r) // preserve relevance order
  } else {
    rows = await fallbackSearch(query, take)
  }

  // Apply explicit price-sort, then cap to 8 cards.
  if (sort) rows = [...rows].sort((a, b) => (sort === 'price_asc' ? a.price - b.price : b.price - a.price))
  rows = rows.slice(0, 8)

  const listings = rows.map(serializeListing)
  if (!reply) {
    reply = listings.length
      ? (lang === 'vi' ? 'Đây là vài lựa chọn phù hợp:' : 'Here are some good matches:')
      : (lang === 'vi' ? 'Mình chưa tìm thấy món phù hợp — thử mô tả khác hoặc nới ngân sách nhé?' : "I couldn't find a match — try describing it differently or widening the budget?")
  }
  return NextResponse.json({ reply, listings, source })
}
