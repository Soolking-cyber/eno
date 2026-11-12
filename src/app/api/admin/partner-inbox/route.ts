import { NextResponse } from 'next/server'
import { getAdmin } from '@/lib/admin'
import { partnerInboxCounts } from '@/lib/partner-inbox'

export const dynamic = 'force-dynamic'

const NO_STORE = { 'Cache-Control': 'private, no-store' }

/**
 * The Admin › Partner inbox badge's count (src/hooks/use-partner-unread.ts): the partner shops' unread chats, a number and
 * nothing else (owner, 2026-11-12: "Counter only, no reading" — src/lib/partner-inbox.ts). Admins only; never cached.
 */
export async function GET() {
  if (!(await getAdmin())) return NextResponse.json({ error: 'Forbidden' }, { status: 403, headers: NO_STORE })
  const { unreadChats } = await partnerInboxCounts()
  return NextResponse.json({ unreadChats }, { headers: NO_STORE })
}
