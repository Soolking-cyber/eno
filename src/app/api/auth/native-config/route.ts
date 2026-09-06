import { NextResponse } from 'next/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * THE AUTH SERVER THIS DEPLOYMENT ACTUALLY USES, told to the native apps at runtime.
 *
 * ⛔ IT EXISTS BECAUSE THE APPS HAD IT HARDCODED, AND THE HARDCODED VALUE WENT STALE.
 * `apps/ios` shipped `https://xihiryllwmjoouipkyhw.supabase.co` in two files — the OLD hosted
 * Supabase project — while production has served auth from the self-hosted stack on the box
 * (`https://sb.eno.vn`) since the migration. Google is enabled on the box and disabled on the old
 * project, so native Google sign-in failed with "provider is not enabled" against a server nobody
 * else talks to. The owner put it exactly right: *"google login is not from new box vps we serve
 * from"*. A build-time constant cannot notice an infrastructure move; this endpoint can.
 *
 * ⚠️ NOTHING SECRET IS PUBLISHED HERE, and that is worth stating because it looks like it. Both
 * values are `NEXT_PUBLIC_*`: every browser that loads any page of this site already receives
 * them inlined in the HTML. What this endpoint avoids is the opposite problem — committing them
 * to a PUBLIC repository, which is what putting them in Swift source would do. The service-role
 * key is never here and must never be.
 *
 * ⚠️ SHORT CACHE, DELIBERATELY. Five minutes is long enough that sign-in does not pay for a
 * round trip on every attempt, and short enough that rotating the anon key or moving the auth
 * host reaches installed apps within minutes instead of at the next App Store release.
 */
export async function GET() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY

  // Fail loudly rather than answering with `undefined`: an app that received a malformed config
  // would report "sign-in failed" with no way for anyone to tell which side was wrong.
  if (!url || !anonKey) {
    return NextResponse.json({ error: 'auth_not_configured' }, { status: 503, headers: { 'Cache-Control': 'no-store' } })
  }

  return NextResponse.json(
    { url, anonKey },
    { headers: { 'Cache-Control': 'public, max-age=300, s-maxage=300' } },
  )
}
