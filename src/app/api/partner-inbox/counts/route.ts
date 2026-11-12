import { createHash, timingSafeEqual } from 'node:crypto'
import { NextResponse } from 'next/server'
import { partnerInboxCounts } from '@/lib/partner-inbox'

export const dynamic = 'force-dynamic'

const NO_STORE = { 'Cache-Control': 'private, no-store' }

/**
 * THE PARTNER INBOX TOTAL FOR REACH (owner, 2026-11-12: "in eno.forum reach app add an inbox counter …"; the inbox itself is
 * eno.vn's Admin › Partner inbox). Reach's server asks with `Authorization: Bearer <PARTNER_INBOX_TOKEN>` (the same value in
 * both apps' env, set by the owner on the box) and gets the total of the partner shops' unread chats and where to open them —
 * a number, no shop's chats, no customer (src/lib/partner-inbox.ts). ⛔ OFF (404) until the token is set; never cached.
 */
const digest = (s: string) => createHash('sha256').update(s).digest()

export async function GET(request: Request) {
  const token = process.env.PARTNER_INBOX_TOKEN
  if (!token || token.length < 32) return NextResponse.json({ error: 'not_found' }, { status: 404, headers: NO_STORE })
  const got = (request.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '')
  // Fixed-size digests, so the comparison takes the same time whatever was sent.
  if (!got || !timingSafeEqual(digest(got), digest(token))) return NextResponse.json({ error: 'unauthorized' }, { status: 401, headers: NO_STORE })
  const { unreadChats } = await partnerInboxCounts()
  const origin = process.env.NEXT_PUBLIC_APP_URL || 'https://eno.vn'
  return NextResponse.json({ unreadChats, adminUrl: `${origin.replace(/\/$/, '')}/admin/partner-inbox` }, { headers: NO_STORE })
}
