import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

// Edge-ingress guard. When EDGE_SECRET is set, every /api/* request (except crons,
// which are invoked off-Cloudflare with their own CRON_SECRET bearer) must carry the
// secret header that a Cloudflare Transform Rule injects on the way in. This blocks
// attackers hitting the Vercel origin (*.vercel.app) DIRECTLY — which would otherwise
// let them spoof `cf-connecting-ip` and bypass every IP-keyed rate limit (and drain the
// paid AI/translate/geocode routes).
//
// No-op until EDGE_SECRET is configured, so it's safe to ship before the Cloudflare
// rule + Vercel Deployment Protection are set up. To enable: (1) add a Cloudflare
// Transform Rule that sets request header `x-eno-edge: <secret>` for eno.vn, (2) set
// EDGE_SECRET=<same secret> on Vercel, (3) turn on Vercel Deployment Protection so the
// *.vercel.app origin isn't publicly reachable at all.
// Native-shell Phase 2 · M3: the LOCAL shell (capacitor://localhost on iOS,
// https://localhost on Android) calls /api/* cross-origin with Bearer auth (M2) —
// no cookies, so allow-credentials stays OFF. Only these exact app origins are
// reflected; browsers keep plain same-origin behavior.
const APP_ORIGINS = new Set(['capacitor://localhost', 'https://localhost'])

function withCors(res: NextResponse, origin: string | null): NextResponse {
  if (origin && APP_ORIGINS.has(origin)) {
    res.headers.set('Access-Control-Allow-Origin', origin)
    res.headers.set('Vary', 'Origin')
    res.headers.set('Access-Control-Allow-Headers', 'authorization, content-type')
    res.headers.set('Access-Control-Allow-Methods', 'GET,POST,PATCH,PUT,DELETE,OPTIONS')
    res.headers.set('Access-Control-Max-Age', '86400')
  }
  return res
}

export function proxy(req: NextRequest) {
  const origin = req.headers.get('origin')
  // Preflights carry no app auth by design — answer them before the edge pin.
  if (req.method === 'OPTIONS' && origin && APP_ORIGINS.has(origin)) {
    return withCors(new NextResponse(null, { status: 204 }), origin)
  }
  const secret = process.env.EDGE_SECRET
  if (!secret) return withCors(NextResponse.next(), origin)
  // SERVER-TO-SERVER routes that legitimately hit the origin OFF Cloudflare and carry
  // their OWN auth — they must bypass the edge header or they break the moment EDGE_SECRET
  // is set: crons (CRON_SECRET, Vercel Cron/Cloud Scheduler), the Supabase Send-SMS auth
  // hook (Standard-Webhooks HMAC, called by Supabase Auth → killing it kills phone-OTP
  // signup/login), the product feeds (Basic-Auth, fetched by Google Merchant/Meta), and
  // the partner API `/api/v1/*` — reached server-to-server off Cloudflare by shops' own
  // backends/agents, so it carries its OWN per-key auth (NOT the IP-keyed rate limits the
  // edge pin protects). /api/v1 is LIVE (analytics/listings/media/oauth/shop/webhooks) and
  // every route authenticates via per-key API auth — the edge pin is not its guard.
  const { pathname } = req.nextUrl
  if (
    pathname.startsWith('/api/cron/') ||
    pathname === '/api/auth/send-sms' ||
    pathname.startsWith('/api/feeds/') ||
    pathname.startsWith('/api/v1/') ||
    pathname === '/api/mcp' // partner MCP server — key-authed like /api/v1, reached by AI clients off-Cloudflare
  ) {
    return withCors(NextResponse.next(), origin)
  }
  if (req.headers.get('x-eno-edge') !== secret) {
    return withCors(new NextResponse('Forbidden', { status: 403 }), origin)
  }
  return withCors(NextResponse.next(), origin)
}

export const config = { matcher: '/api/:path*' }
