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
export function middleware(req: NextRequest) {
  const secret = process.env.EDGE_SECRET
  if (!secret) return NextResponse.next()
  // SERVER-TO-SERVER routes that legitimately hit the origin OFF Cloudflare and carry
  // their OWN auth — they must bypass the edge header or they break the moment EDGE_SECRET
  // is set: crons (CRON_SECRET, Vercel Cron/Cloud Scheduler), the Supabase Send-SMS auth
  // hook (Standard-Webhooks HMAC, called by Supabase Auth → killing it kills phone-OTP
  // signup/login), the product feeds (Basic-Auth, fetched by Google Merchant/Meta), and
  // the partner API `/api/v1/*` — reached server-to-server off Cloudflare by shops' own
  // backends/agents, so it carries its OWN per-key auth (NOT the IP-keyed rate limits the
  // edge pin protects). Every /api/v1 route MUST authenticate via API key (Phase 1) — the
  // edge pin is not its guard. No-op today (no /api/v1 routes exist yet).
  const { pathname } = req.nextUrl
  if (
    pathname.startsWith('/api/cron/') ||
    pathname === '/api/auth/send-sms' ||
    pathname.startsWith('/api/feeds/') ||
    pathname.startsWith('/api/v1/') ||
    pathname === '/api/mcp' // partner MCP server — key-authed like /api/v1, reached by AI clients off-Cloudflare
  ) {
    return NextResponse.next()
  }
  if (req.headers.get('x-eno-edge') !== secret) {
    return new NextResponse('Forbidden', { status: 403 })
  }
  return NextResponse.next()
}

export const config = { matcher: '/api/:path*' }
