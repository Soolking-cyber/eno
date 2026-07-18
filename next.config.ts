import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Standalone server output for local `npm start` / self-hosting. NOT on Vercel:
  // standalone targets a Node server and makes Vercel bundle Edge middleware with
  // Node globals (`__dirname`), crashing it (MIDDLEWARE_INVOCATION_FAILED). Vercel
  // handles output natively, so disable standalone there.
  output: process.env.VERCEL ? undefined : "standalone",
  // Don't advertise the framework (`x-powered-by: Next.js`) on every response.
  poweredByHeader: false,
  // Inline CSS into the HTML <head> instead of a render-blocking <link>. On
  // Slow-4G mobile the stylesheet round-trip was the #1 render blocker (~570ms
  // in PSI); inlining removes that request so first paint isn't gated on it.
  experimental: {
    inlineCss: true,
    // Tree-shake barrel-export packages so only the icons/primitives actually used
    // are bundled (lucide-react is imported across ~68 files) — trims first-party JS.
    optimizePackageImports: ["lucide-react"],
  },
  // ffmpeg-static must NOT be bundled: its exported binary path is `path.join(__dirname,
  // 'ffmpeg')`, so if Next bundles it into the route chunk, __dirname resolves to the compiled
  // chunk dir (wrong) and spawn ENOENTs → every transcode fails on Vercel (works in `next dev`
  // where __dirname is the real node_modules — so it can ship green and be broken in prod).
  // Externalizing keeps __dirname = node_modules/ffmpeg-static; outputFileTracingIncludes then
  // guarantees the ~80MB binary is actually placed in that one route's Lambda.
  serverExternalPackages: ["ffmpeg-static"],
  outputFileTracingIncludes: {
    "/api/upload/video/transcode": ["./node_modules/ffmpeg-static/ffmpeg"],
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
    // Widths tuned to the ACTUAL render sizes, not generic breakpoints (each width×quality
    // is a billed transformation, so every rung must earn its place). 420 is the key one:
    // the 2-col mobile card renders 181px CSS → a DPR2 phone needs 362px, but with only
    // [360,640] the srcset skipped straight to 640 (360 is a hair too small) — a measured
    // ~18KB/card over-serve (PSI "Improve image delivery"). 420 covers cards up to ~210px
    // CSS at DPR2 with no visible quality loss; DPR3 flagships still correctly get 640
    // (they need 543). 1080 stays for the PDP hero. 750/1920 remain dropped.
    deviceSizes: [360, 420, 640, 1080],
    imageSizes: [64, 128, 256],
    remotePatterns: [
      {
        protocol: "https",
        hostname: "xihiryllwmjoouipkyhw.supabase.co",
        pathname: "/storage/v1/object/public/listings/**",
      },
    ],
  },
  typescript: {
    // Enforce types at BUILD time (Vercel + CI). The build now fails on any type
    // error instead of silently shipping it; `tsc --noEmit` is kept green so this
    // gate never blocks a legit deploy.
    ignoreBuildErrors: false,
  },
  reactStrictMode: false,
  // iOS Universal Links: the app router ignores dot-folders, so
  // /.well-known/apple-app-site-association is served by a route handler (which
  // env-gates on APPLE_TEAM_ID — 404 until the paid Apple team exists). Android's
  // assetlinks.json needs no rewrite: it's a static file under public/.well-known.
  async rewrites() {
    return [
      {
        source: "/.well-known/apple-app-site-association",
        destination: "/api/well-known/aasa",
      },
    ];
  },
  // Baseline security headers on every response. CSP is ENFORCING and was TIGHTENED
  // 2026-07-10: Supabase pinned to the exact project host (not *.supabase.co — connect-src
  // is the post-XSS exfiltration brake), Leaflet self-hosted (unpkg dropped), browser Meta
  // Pixel removed (facebook.net/stape/run.app dropped). Remaining external origins: pinned
  // Supabase REST+realtime wss, CARTO tiles, GA/GTM, Cloudflare Insights+Turnstile, Vercel
  // Insights. 'unsafe-inline'/'unsafe-eval' keep Next's inline scripts/styles and the GA
  // bootstrap working. report-to + report-uri stay wired to the /api/csp-report collector
  // so any future violation is still logged, not just blocked.
  async headers() {
    const csp = [
      "default-src 'self'",
      "base-uri 'self'",
      "object-src 'none'",
      "frame-ancestors 'self'",
      "form-action 'self'",
      // Next.js needs inline + eval without a nonce setup; GTM/Turnstile scripts. Leaflet is
      // SELF-HOSTED (public/vendor/leaflet) and the browser Meta Pixel is REMOVED (server-side
      // CAPI only) — so unpkg.com and the facebook.net/stape/run.app hosts are gone from every
      // directive. va.vercel-scripts.com: @vercel/analytics + speed-insights SDK (proxied same-
      // origin in prod, but the external host loads on preview/debug deployments).
      "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://www.googletagmanager.com https://static.cloudflareinsights.com https://va.vercel-scripts.com https://challenges.cloudflare.com",
      "style-src 'self' 'unsafe-inline'",
      // Supabase is PINNED to our exact project host (not *.supabase.co): connect-src is the
      // main post-XSS exfiltration brake, and a wildcard would let stolen data POST to any
      // attacker-owned Supabase project. *.googleusercontent.com = Google account avatars
      // (OAuth sign-in) — without it they render as a broken-image icon.
      "img-src 'self' data: blob: https://xihiryllwmjoouipkyhw.supabase.co https://*.googleusercontent.com https://*.basemaps.cartocdn.com https://www.google-analytics.com https://www.googletagmanager.com",
      // <video> sources for listing videos: our public bucket + blob: (the wizard's
      // client-side preview object URL). Without this, default-src 'self' blocks playback.
      "media-src 'self' blob: https://xihiryllwmjoouipkyhw.supabase.co",
      "font-src 'self' data:",
      "connect-src 'self' https://xihiryllwmjoouipkyhw.supabase.co wss://xihiryllwmjoouipkyhw.supabase.co https://www.google-analytics.com https://region1.google-analytics.com https://www.googletagmanager.com https://cloudflareinsights.com https://static.cloudflareinsights.com",
      "frame-src 'self' https://td.doubleclick.net https://challenges.cloudflare.com",
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
          // Indexing was decoupled from PRELAUNCH (owner, 2026-07-18): the site is
          // indexable while the MoIT test-operation notice still shows. The old
          // sitewide `X-Robots-Tag: noindex, nofollow` prelaunch header is gone;
          // per-page robots metadata (auth/dashboard/admin noindex) is the only
          // robots control now. See src/app/sitemap.xml/route.ts (un-gated the
          // same day).
        ],
      },
    ];
  },
};

export default nextConfig;
