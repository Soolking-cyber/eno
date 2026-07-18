import 'server-only'
import { NextResponse } from 'next/server'

const productionForumOrigin = process.env.NEXT_PUBLIC_FORUM_URL || 'https://eno.forum'

function allowedOrigins(): Set<string> {
  const origins = new Set([productionForumOrigin])
  // Browsers send the CANONICAL origin (www.eno.forum — the apex 308s there), so both
  // host variants of the configured production origin are allowed (audit P2: with
  // NEXT_PUBLIC_FORUM_URL unset/apex, every real forum fetch was CORS-rejected).
  try {
    const u = new URL(productionForumOrigin)
    const bare = u.hostname.replace(/^www\./, '')
    origins.add(`${u.protocol}//${bare}`)
    origins.add(`${u.protocol}//www.${bare}`)
  } catch { /* malformed env — keep the literal */ }
  for (const origin of (process.env.FORUM_DEV_ORIGINS || '').split(',')) {
    if (origin.trim()) origins.add(origin.trim())
  }
  // Loopback origins are always allowed: a prod attacker can never make a victim's
  // browser send Origin: http://localhost (and SameSite=Lax already blocks cross-site
  // POST), while dev/standalone-start (NODE_ENV=production) still needs them.
  for (const port of ['3100', '3101']) {
    origins.add(`http://localhost:${port}`)
    origins.add(`http://127.0.0.1:${port}`)
  }
  return origins
}

export function isAllowedForumOrigin(request: Request): boolean {
  const origin = request.headers.get('origin')
  // Server-to-server requests omit Origin; browsers omit it on same-origin GETs.
  // Authentication and authorization still apply; CORS only gates browser
  // cross-origin access.
  if (!origin) return true
  // ⚠️ Browsers send Origin on every non-GET fetch — including SAME-ORIGIN ones —
  // so the app's own pages must be recognised here too (the /dashboard/trips/plan
  // planner POSTs /api/itineraries from eno.vn itself; 2026-07-18). Same-origin is
  // decided against NEXT_PUBLIC_APP_URL — a TRUSTED, env-fixed value — NOT against a
  // request host header: x-forwarded-host/host are attacker-settable behind a
  // mis-set proxy or a direct-to-node hit, and matching Origin to a spoofed host
  // would wave through any cross-site origin. (Local dev covered by the :3100/:3101
  // allowlist entries below.)
  const appUrl = process.env.NEXT_PUBLIC_APP_URL
  if (appUrl) {
    try {
      if (origin === new URL(appUrl).origin) return true
    } catch { /* malformed env — fall through to the allowlist */ }
  }
  return allowedOrigins().has(origin)
}

export function withForumCors(request: Request, response: NextResponse, methods = 'GET, POST, PATCH, DELETE, OPTIONS') {
  const origin = request.headers.get('origin')
  if (origin && allowedOrigins().has(origin)) {
    response.headers.set('Access-Control-Allow-Origin', origin)
    response.headers.append('Vary', 'Origin')
  }
  response.headers.set('Access-Control-Allow-Methods', methods)
  response.headers.set('Access-Control-Allow-Headers', 'Authorization, Content-Type')
  response.headers.set('Access-Control-Max-Age', '86400')
  return response
}

export function forumJson(
  request: Request,
  body: unknown,
  init?: ResponseInit,
  methods?: string,
) {
  return withForumCors(request, NextResponse.json(body, init), methods)
}

export function forumPreflight(request: Request, methods?: string) {
  if (!isAllowedForumOrigin(request)) return NextResponse.json({ error: 'origin_not_allowed' }, { status: 403 })
  return withForumCors(request, new NextResponse(null, { status: 204 }), methods)
}
