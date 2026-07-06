import type { NextConfig } from "next";
import { PRELAUNCH } from "./src/lib/site-legal";

const nextConfig: NextConfig = {
  // Standalone server output for local `npm start` / self-hosting. NOT on Vercel:
  // standalone targets a Node server and makes Vercel bundle Edge middleware with
  // Node globals (`__dirname`), crashing it (MIDDLEWARE_INVOCATION_FAILED). Vercel
  // handles output natively, so disable standalone there.
  output: process.env.VERCEL ? undefined : "standalone",
  // Inline CSS into the HTML <head> instead of a render-blocking <link>. On
  // Slow-4G mobile the stylesheet round-trip was the #1 render blocker (~570ms
  // in PSI); inlining removes that request so first paint isn't gated on it.
  experimental: {
    inlineCss: true,
    // Tree-shake barrel-export packages so only the icons/primitives actually used
    // are bundled (lucide-react is imported across ~68 files) — trims first-party JS.
    optimizePackageImports: ["lucide-react"],
  },
  // Pin the workspace root so Turbopack doesn't pick up a stray lockfile higher
  // up the tree (e.g. ~/package-lock.json) as the project root.
  turbopack: {
    root: __dirname,
  },
  images: {
    formats: ["image/avif", "image/webp"],
    // Listing photos rarely change → cache optimized variants 30 days; one quality
    // tier + trimmed widths = fewer optimizer variants and smaller payloads.
    minimumCacheTTL: 2592000,
    qualities: [60, 70],
    // Trimmed widths → fewer optimizer variants per image (each width×quality is a
    // billed transformation). Keeps mobile-first sizes for VN; drops 750/1920.
    deviceSizes: [360, 640, 1080],
    imageSizes: [64, 128, 256],
    remotePatterns: [
      {
        protocol: "https",
        hostname: "xihiryllwmjoouipkyhw.supabase.co",
        pathname: "/storage/v1/object/public/listings/**",
      },
      // MOCK DATA ONLY — stock photos for the seed catalog used in testing.
      // picsum is the current source (reliable); loremflickr is kept allow-listed
      // only so older mock rows don't break the build before a reseed. Remove BOTH
      // (and reseed without mock listings) before launch.
      { protocol: "https", hostname: "picsum.photos" },
      { protocol: "https", hostname: "loremflickr.com" },
    ],
  },
  typescript: {
    // Enforce types at BUILD time (Vercel + CI). The build now fails on any type
    // error instead of silently shipping it; `tsc --noEmit` is kept green so this
    // gate never blocks a legit deploy.
    ignoreBuildErrors: false,
  },
  reactStrictMode: false,
  // Baseline security headers on every response. CSP is now ENFORCING — promoted from
  // Report-Only after a 6-dimension audit confirmed every browser-loaded external
  // origin is in the allowlist (Supabase REST+realtime wss, CARTO tiles, unpkg/Leaflet,
  // GA/GTM, Meta Pixel, Cloudflare Insights, Vercel Insights, mock image hosts) with
  // ZERO breaking gaps; 'unsafe-inline'/'unsafe-eval' keep Next's inline scripts/styles
  // and the GA/Pixel bootstrap working. report-to + report-uri stay wired to the
  // /api/csp-report collector so any future violation is still logged, not just blocked.
  async headers() {
    const csp = [
      "default-src 'self'",
      "base-uri 'self'",
      "object-src 'none'",
      "frame-ancestors 'self'",
      "form-action 'self'",
      // Next.js needs inline + eval without a nonce setup; GTM/Meta/Leaflet scripts.
      // va.vercel-scripts.com: @vercel/analytics + speed-insights SDK (proxied same-
      // origin in prod, but the external host loads on preview/debug deployments).
      "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://www.googletagmanager.com https://connect.facebook.net https://unpkg.com https://static.cloudflareinsights.com https://va.vercel-scripts.com https://challenges.cloudflare.com",
      "style-src 'self' 'unsafe-inline' https://unpkg.com",
      // *.googleusercontent.com = Google account avatars (OAuth sign-in) — without it the
      // CSP blocks them and they render as a broken-image icon in the navbar/profile.
      "img-src 'self' data: blob: https://*.supabase.co https://*.googleusercontent.com https://*.basemaps.cartocdn.com https://picsum.photos https://*.picsum.photos https://loremflickr.com https://www.facebook.com https://www.google-analytics.com https://www.googletagmanager.com",
      "font-src 'self' data:",
      "connect-src 'self' https://unpkg.com https://*.supabase.co wss://*.supabase.co https://www.google-analytics.com https://region1.google-analytics.com https://www.googletagmanager.com https://connect.facebook.net https://www.facebook.com https://cloudflareinsights.com https://static.cloudflareinsights.com",
      "frame-src 'self' https://www.facebook.com https://td.doubleclick.net https://challenges.cloudflare.com",
      "worker-src 'self' blob:",
      "manifest-src 'self'",
      // Where violations are sent: report-to (modern, paired with the Reporting-Endpoints
      // header below) + report-uri (older browsers). Same-origin path → through Cloudflare.
      "report-to csp-endpoint",
      "report-uri /api/csp-report",
    ].join("; ");
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), payment=()" },
          { key: "X-DNS-Prefetch-Control", value: "on" },
          // Named endpoint group for the CSP `report-to` directive (Reporting API).
          { key: "Reporting-Endpoints", value: 'csp-endpoint="/api/csp-report"' },
          { key: "Content-Security-Policy", value: csp },
          // PRE-LAUNCH: keep the whole site OUT of search indexes while it is in test
          // operation with seed/mock inventory. This is set sitewide as a header (not
          // per-page metadata) so it ALSO covers the mock listing pages that set
          // `robots: undefined` (indexable) — nothing leaks into Google until we flip
          // PRELAUNCH=false with real inventory. robots.txt stays crawlable ON PURPOSE
          // so Googlebot can fetch each page, SEE this noindex, and drop already-indexed
          // seed URLs. Flipping PRELAUNCH is a rebuild+redeploy (i.e. the launch itself),
          // at which point this header disappears. `nofollow` too so seed link-graph
          // isn't followed. See src/lib/site-legal.ts and src/app/sitemap.xml/route.ts.
          ...(PRELAUNCH ? [{ key: "X-Robots-Tag", value: "noindex, nofollow" }] : []),
        ],
      },
    ];
  },
};

export default nextConfig;
