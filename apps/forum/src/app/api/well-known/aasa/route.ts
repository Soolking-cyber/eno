import { NextResponse } from 'next/server'

// The App Router does not serve dot-prefixed route segments, so next.config rewrites the public
// Apple association URL here. Auth routes stay excluded: OAuth must finish in its original browser.
export async function GET() {
  const teamId = process.env.APPLE_TEAM_ID
  if (!teamId) return new NextResponse(null, { status: 404 })

  // This default mirrors the current eno.vn Xcode target. Keep the Vercel variable explicit so a
  // future bundle rename can roll out without changing either web application.
  const bundleId = process.env.APPLE_BUNDLE_ID || 'com.mk1e3.enovn'

  return NextResponse.json(
    {
      applinks: {
        details: [
          {
            appIDs: [`${teamId}.${bundleId}`],
            components: [
              { '/': '/', comment: 'Forum home' },
              // /itinerary* deliberately absent: the trip service moved to eno.vn, whose own
              // AASA claims it via the catch-all `{"/": "/*"}`. Claiming it here too would
              // deep-link the app to a host that only 308s away.
              { '/': '/visa*', comment: 'Vietnam e-Visa assistance' },
              { '/': '/dashboard*', comment: 'Unified eno dashboard' },
            ],
          },
        ],
      },
    },
    { headers: { 'Cache-Control': 'public, max-age=3600' } },
  )
}
