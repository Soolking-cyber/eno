import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
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
    qualities: [50, 70],
    deviceSizes: [360, 640, 750, 1080, 1920],
    imageSizes: [48, 80, 112, 180, 256],
    remotePatterns: [
      {
        protocol: "https",
        hostname: "xihiryllwmjoouipkyhw.supabase.co",
        pathname: "/storage/v1/object/public/listings/**",
      },
    ],
  },
  typescript: {
    ignoreBuildErrors: true,
  },
  reactStrictMode: false,
  // Baseline security headers on every response. (No strict CSP yet — it would
  // need to allow Supabase, CARTO map tiles, and unpkg/Leaflet; add once those
  // origins are enumerated and tested.)
  async headers() {
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
        ],
      },
    ];
  },
};

export default nextConfig;
