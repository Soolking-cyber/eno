import { NextResponse } from 'next/server'
import { route } from '@/lib/api/handler'
import { fbImportOn } from '@/lib/fb-import/available'

export const dynamic = 'force-dynamic'

/**
 * Is Import from Facebook on — for a visitor who is not signed in (owner, 2026-11-13: "make it visible without signing … we run ads
 * on fb … link directly the facebook connect page"): My listings › Import from Facebook shows them the import's intro and sends them
 * to sign in. `{ on }` only: nothing about anyone. Never cached, so switching the import off is seen at once.
 */
export const GET = route({ auth: 'public' }, async () =>
  NextResponse.json({ on: await fbImportOn() }, { headers: { 'Cache-Control': 'no-store' } }))
