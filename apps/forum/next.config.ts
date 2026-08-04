import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  // Standalone server output for Cloud Run / self-hosting (same guard as the
  // marketplace app: Vercel handles output natively and standalone breaks its
  // Edge middleware bundling, so it stays off there).
  output: process.env.VERCEL ? undefined : 'standalone',
  poweredByHeader: false,
  reactStrictMode: true,
  // Playwright's canonical local base URL uses 127.0.0.1 while Next binds the
  // dev server as localhost. Allow that loopback host so the development HMR
  // request cannot block client hydration during the browser suite.
  allowedDevOrigins: ['127.0.0.1'],
  experimental: {
    inlineCss: true,
    optimizePackageImports: ['lucide-react'],
  },
  turbopack: { root: __dirname },
  async redirects() {
    return [
      // ⛔ THE TWO `/itinerary` → `https://eno.vn/itinerary` REDIRECTS THAT SAT HERE ARE DELETED.
      //
      // They were written 2026-07-25, when the trip service had moved to eno.vn and this tree's
      // copy of the builder was deleted with it — correct then, and the note said they "must
      // OUTLIVE the deletion, so do not tidy it away". The owner REVERSED that on 2026-07-31:
      // itinerary, visa and PayPal belong to eno.forum, and eno.vn — the licensed sàn TMĐT — may
      // not offer or even mention them. The rules therefore pointed forum traffic at a page the
      // marketplace deliberately does not have (measured 2026-08-04: eno.vn/itinerary → 404).
      //
      // ⚠️ DELETED RATHER THAN ANNOTATED, because `permanent: true` is a 308 and browsers and CDNs
      // cache it indefinitely — a comment saying "this is wrong" does not un-cache anything, and a
      // revived or accidentally-built tree would start handing it out again. This tree is retired
      // (eno.forum is served from the REPO ROOT via cloudbuild.services.yaml), so nothing is lost:
      // the root's src/app/itinerary/page.svc.tsx serves /itinerary on eno.forum and returns 200.
      //
      // ⚠️ ONE THING THIS CANNOT FIX: any browser that hit eno.forum/itinerary while this tree WAS
      // live holds a cached 308 to a now-404 URL, and will not re-ask. If trip-planner traffic
      // looks anomalously low, that is a candidate cause.
      { source: '/forum', destination: '/', permanent: true },
      // Canonical-host redirect: Vercel's domain config used to 308 apex→www;
      // on Cloud Run behind the LB both hosts reach the app, so the app owns it.
      {
        source: '/:path*',
        has: [{ type: 'host', value: 'eno.forum' }],
        destination: 'https://www.eno.forum/:path*',
        permanent: true,
      },
    ]
  },
  async rewrites() {
    return [{ source: '/.well-known/apple-app-site-association', destination: '/api/well-known/aasa' }]
  },
  async headers() {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://*.supabase.co'
    const csp = [
      "default-src 'self'",
      "base-uri 'self'",
      "object-src 'none'",
      "frame-ancestors 'none'",
      "form-action 'self'",
      "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://challenges.cloudflare.com",
      "style-src 'self' 'unsafe-inline'",
      // Supabase serves forum media; Google serves profile photos copied into the
      // shared user's OAuth metadata. Keep this host aligned with the marketplace
      // CSP or signed-in Google accounts render a blocked/broken avatar.
      `img-src 'self' data: blob: ${supabaseUrl} https://*.googleusercontent.com`,
      "font-src 'self' data:",
      `connect-src 'self' ${supabaseUrl} https://challenges.cloudflare.com`,
      "frame-src 'self' https://challenges.cloudflare.com",
      "worker-src 'self' blob:",
      "manifest-src 'self'",
    ].join('; ')

    return [{
      source: '/:path*',
      headers: [
        { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
        { key: 'X-Content-Type-Options', value: 'nosniff' },
        { key: 'X-Frame-Options', value: 'DENY' },
        { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
        { key: 'Permissions-Policy', value: 'camera=(), microphone=(), payment=()' },
        { key: 'Content-Security-Policy', value: csp },
      ],
    }]
  },
}

export default nextConfig
