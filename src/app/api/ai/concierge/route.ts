import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { fold } from '@/lib/fold'
import { serializeListing } from '@/lib/serialize'
import { clientIp } from '@/lib/client-ip'
import { rateLimit } from '@/lib/ratelimit'
import { conciergeSearch, vertexConfigured } from '@/lib/vertex-search'
import type { Prisma } from '@/generated/prisma/client'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// AI shopping concierge — the "AI mode" toggle in the search bar. A buyer describes
// what they want in natural language (EN/VI); we return a grounded reply + matching
// listings rendered as cards. Public (browsing is public) but IP-rate-limited.
//
// The AI reasoning runs on VERTEX AI SEARCH (the catalog data store) so it DRAWS THE
// GenAI App Builder CREDIT — see src/lib/vertex-search.ts + docs/vertex-search-setup.md.
// Until the data store is configured it degrades to a plain trust-first Postgres search
// (source:"fallback") which does NOT draw the credit — so the UI works during setup.

type Msg = { role: 'user' | 'assistant'; content: string }

const TRUST: Prisma.ListingOrderByWithRelationInput = { seller: { trustScore: 'desc' } }
const INCLUDE = { category: true, seller: { include: { owner: { select: { accountType: true } } } } } as const

// Degraded fallback: trust-first keyword search (no AI, no credit) so the chat still
// returns products before the Vertex data store is live.
async function fallbackSearch(query: string, take: number) {
  const tokens = fold(query).split(/\s+/).filter((t) => t.length >= 2).slice(0, 6)
  const AND: Prisma.ListingWhereInput[] = tokens.map((t) => ({ searchText: { contains: t } }))
  return db.listing.findMany({
    where: { verified: true, status: 'active', ...(AND.length ? { AND } : {}) },
    orderBy: [TRUST, { featured: 'desc' }, { postedAt: 'desc' }, { id: 'desc' }],
    take,
    include: INCLUDE,
  })
}

export async function POST(req: NextRequest) {
  const ip = clientIp(req)
  const rl = await rateLimit('ai-concierge', ip, 40, '1 h')
  if (!rl.success) return NextResponse.json({ error: 'rate_limited' }, { status: 429 })

  let body: { messages?: Msg[]; lang?: string }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'bad_request' }, { status: 400 }) }
  const lang = body.lang === 'vi' ? 'vi' : 'en'
  const messages = (body.messages || []).filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string').slice(-12)
  const lastUser = [...messages].reverse().find((m) => m.role === 'user')
  if (!lastUser) return NextResponse.json({ error: 'bad_request' }, { status: 400 })

  // Light multi-turn context: prepend the previous user turn so "show me cheaper ones"
  // still carries the subject. Vertex handles the natural-language understanding.
  const prevUser = [...messages].reverse().filter((m) => m.role === 'user')[1]
  const query = `${prevUser ? prevUser.content + ' ' : ''}${lastUser.content}`.trim().slice(0, 240)

  let reply = ''
  let source: 'vertex' | 'fallback' = 'fallback'
  let listingIds: string[] = []

  // Primary: Vertex AI Search (draws the credit).
  if (vertexConfigured()) {
    const r = await conciergeSearch(query, { take: 8 }).catch((e) => { console.error('[ai/concierge] vertex', e); return null })
    if (r && r.listingIds.length) { listingIds = r.listingIds; reply = r.answer; source = 'vertex' }
  }

  let rows
  if (source === 'vertex' && listingIds.length) {
    const found = await db.listing.findMany({ where: { id: { in: listingIds }, verified: true, status: 'active' }, include: INCLUDE })
    rows = listingIds.map((id) => found.find((r) => r.id === id)).filter((r): r is NonNullable<typeof r> => !!r) // preserve relevance order
  } else {
    rows = await fallbackSearch(lastUser.content, 8)
  }

  const listings = rows.map(serializeListing)
  if (!reply) {
    reply = listings.length
      ? (lang === 'vi' ? 'Đây là vài lựa chọn phù hợp:' : 'Here are some good matches:')
      : (lang === 'vi' ? 'Mình chưa tìm thấy món phù hợp — thử mô tả khác hoặc nới ngân sách nhé?' : "I couldn't find a match — try describing it differently or widening the budget?")
  }
  return NextResponse.json({ reply, listings, source })
}
