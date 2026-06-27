import type { NextConfig } from "next";

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
    ignoreBuildErrors: true,
  },
  reactStrictMode: false,
  // Baseline security headers on every response. CSP is shipped REPORT-ONLY first
  // (logs violations, blocks nothing) so we can confirm every origin — Supabase
  // (+ realtime wss), CARTO map tiles, unpkg/Leaflet, GA/GTM, Meta pixel, mock
  // image hosts — before promoting it to an enforcing `Content-Security-Policy`.
  async headers() {
    const csp = [
      "default-src 'self'",
      "base-uri 'self'",
      "object-src 'none'",
      "frame-ancestors 'self'",
      "form-action 'self'",
      // Next.js needs inline + eval without a nonce setup; GTM/Meta/Leaflet scripts.
      "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://www.googletagmanager.com https://connect.facebook.net https://unpkg.com https://static.cloudflareinsights.com",
      "style-src 'self' 'unsafe-inline' https://unpkg.com",
      "img-src 'self' data: blob: https://*.supabase.co https://*.basemaps.cartocdn.com https://picsum.photos https://loremflickr.com https://www.facebook.com https://www.google-analytics.com https://www.googletagmanager.com",
      "font-src 'self' data:",
      "connect-src 'self' https://*.supabase.co wss://*.supabase.co https://www.google-analytics.com https://region1.google-analytics.com https://www.googletagmanager.com https://connect.facebook.net https://www.facebook.com https://cloudflareinsights.com https://static.cloudflareinsights.com",
      "frame-src 'self' https://www.facebook.com https://td.doubleclick.net",
      "worker-src 'self' blob:",
      "manifest-src 'self'",
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
          { key: "Content-Security-Policy-Report-Only", value: csp },
        ],
      },
    ];
  },
};

export default nextConfig;
