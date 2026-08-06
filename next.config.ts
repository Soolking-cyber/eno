import { join } from "node:path";
import type { NextConfig } from "next";

/**
 * ⚠️ EDITION GUARD — fails the build rather than shipping the wrong app.
 *
 * eno.vn (the licensed sàn TMĐT) and eno.forum are built from this one codebase, and
 * NEXT_PUBLIC_ENO_EDITION decides which. src/lib/edition.ts folds that variable down to a boolean
 * with a plain ternary, because the ternary is what lets the minifier delete the dead branches — and
 * a ternary cannot tell a typo from a deliberate value: anything unrecognised falls through to
 * 'services', which is the DANGEROUS direction once two services exist. A misspelled value on the
 * eno.vn deployment would make the licensed domain serve visa, itinerary and PayPal.
 *
 * So the validation lives here, where it costs nothing at runtime and fails loudly: a value that is
 * neither literal stops the build. Absent is still allowed and still means 'services' — that is the
 * transitional default while only one deployment exists, and Phase 1 removes it by setting the
 * variable explicitly on BOTH services. (Found by an adversarial review of the phase-0 diff, which
 * pointed out the flag was fail-safe only during the transition.)
 */
const EDITION_ENV = process.env.NEXT_PUBLIC_ENO_EDITION;
if (EDITION_ENV !== undefined && EDITION_ENV !== "marketplace" && EDITION_ENV !== "services") {
  throw new Error(
    `NEXT_PUBLIC_ENO_EDITION must be exactly "marketplace" or "services" (got ${JSON.stringify(EDITION_ENV)}). ` +
      "An unrecognised value silently builds the SERVICES edition, which on eno.vn means the licensed " +
      "company serves visa, itinerary and PayPal. Refusing to build.",
  );
}

/**
 * ⚠️ THE HOST MUST MATCH THE EDITION, AND A MISSING VALUE IS THE DANGEROUS CASE.
 *
 * Every consumer of NEXT_PUBLIC_APP_URL falls back to the literal "https://eno.vn" —
 * src/app/layout.tsx (metadataBase), src/app/sitemap.xml/route.ts, src/lib/visa/payments.ts (the
 * PayPal return origin). So forgetting the variable on the eno.forum deployment does NOT error. It
 * silently brands eno.forum as eno.vn: the e-visa pages canonicalise to the licensed company,
 * eno.vn's name goes on the sitemap that submits them to Google, and eno.vn appears on the PayPal
 * transaction. An empty env var is a silent success today, and this converts it into a red build.
 *
 * Only enforced once the edition is declared, so the transitional single deployment (no edition set,
 * no APP_URL set) still builds exactly as it does now.
 */
if (EDITION_ENV !== undefined) {
  const expectedHost = EDITION_ENV === "marketplace" ? "eno.vn" : "www.eno.forum";
  const appUrl = process.env.NEXT_PUBLIC_APP_URL;
  if (!appUrl) {
    throw new Error(
      `NEXT_PUBLIC_APP_URL is required when NEXT_PUBLIC_ENO_EDITION is set (edition "${EDITION_ENV}" expects host ${expectedHost}). ` +
        'Every consumer silently falls back to "https://eno.vn", which would brand this build as the ' +
        "licensed marketplace regardless of which domain serves it. Refusing to build.",
    );
  }
  let host: string;
  try {
    host = new URL(appUrl).host;
  } catch {
    throw new Error(`NEXT_PUBLIC_APP_URL is not a valid absolute URL: ${JSON.stringify(appUrl)}. Refusing to build.`);
  }
  // www-insensitive: the LB serves both apex and www for each domain, and failing a build over a
  // prefix would be a false alarm rather than a caught leak.
  const norm = (h: string) => h.replace(/^www\./, "");
  if (norm(host) !== norm(expectedHost)) {
    throw new Error(
      `NEXT_PUBLIC_ENO_EDITION="${EDITION_ENV}" expects NEXT_PUBLIC_APP_URL on ${expectedHost}, got ${host}. ` +
        "A mismatch puts one domain's identity on the other's pages — canonicals, OG urls, sitemap " +
        "entries and the PayPal return origin all derive from this. Refusing to build.",
    );
  }
}

/**
 * ⚠️ THIS IS THE DEFAULT-DENY, AND IT IS THE WHOLE REASON THE SPLIT CAN BE TRUSTED OVER TIME.
 *
 * Services-only routes live under src/app/(services)/ and every Next special file in there is named
 * with a `.svc.` infix — page.svc.tsx, route.svc.ts, layout.svc.tsx. Next resolves special files as
 * `${name}.${ext}`, so on a MARKETPLACE build, where "svc.tsx" is not an extension, those files match
 * nothing: never compiled, never prerendered into the image, absent from the route manifest, and
 * given no client chunk. The route does not exist rather than being blocked.
 *
 * Why it is worth the odd filenames: the alternative is a hand-maintained list of blocked paths, and
 * that list WILL rot. Someone adds a visa route next month, puts it beside its siblings because that
 * is where visa routes live, names it like its neighbours because that is what every file in the
 * directory looks like — and it is absent from the licensed image without anyone remembering a rule.
 * The convention enforces itself, and scripts/edition-lint.mjs Rule B enforces the convention.
 *
 * ⚠️ ORDER MATTERS: the plain extensions come FIRST. Next matches in array order, so a directory
 * holding both page.tsx and page.svc.tsx resolves to the plain one on a services build too — which
 * is what you want if a route is ever deliberately shared.
 */
const PAGE_EXTENSIONS =
  EDITION_ENV === "marketplace"
    ? ["ts", "tsx", "js", "jsx"]
    : ["ts", "tsx", "js", "jsx", "svc.ts", "svc.tsx", "svc.js", "svc.jsx"];

const nextConfig: NextConfig = {
  pageExtensions: PAGE_EXTENSIONS,
  // Dev-only: hide the floating Next.js devtools badge. It renders bottom-left —
  // exactly over the bottom nav's first tab on mobile — and pollutes every design
  // screenshot taken against `next dev`. No effect on production builds.
  devIndicators: false,
  // Standalone server output for local `npm start` / self-hosting. NOT on Vercel:
  // standalone targets a Node server and makes Vercel bundle Edge middleware with
  // Node globals (`__dirname`), crashing it (MIDDLEWARE_INVOCATION_FAILED). Vercel
  // handles output natively, so disable standalone there.
  output: process.env.VERCEL ? undefined : "standalone",
  // Cross-instance ISR: cache-handler.cjs replaces the per-instance filesystem
  // cache so revalidatePath purges EVERY Cloud Run instance — the correctness
  // gate for max-instances > 1 (a sold/moderated listing must vanish everywhere).
  // The handler is DUAL-MODE internally (Postgres on Cloud Run, in-process only
  // elsewhere) because the standalone server embeds this config at build time.
  // cacheMaxMemorySize 0 kills Next's own L1, which would otherwise serve stale
  // entries without consulting the shared tombstones. ⚠️ This is NOT "no memory
  // cache": the handler runs its own tombstone-aware L1, which is the thing Next's
  // cannot be. Raising this value would re-introduce an unchecked layer ABOVE ours
  // and resurrect purged pages — leave it at 0.
  ...(process.env.VERCEL ? {} : { cacheHandler: join(__dirname, "cache-handler.cjs"), cacheMaxMemorySize: 0 }),
  // Don't advertise the framework (`x-powered-by: Next.js`) on every response.
  poweredByHeader: false,
  // inlineCss DISABLED (perf Phase 1 A/B, 2026-07-19): with RSC payloads the
  // inlined stylesheet was embedded ~3x — homepage HTML measured 876KB decoded /
  // 126KB gzip WITH inlining vs 314KB / 35KB with a normal cacheable <link>.
  // Cost: +~0.3s FCP on cold Slow-4G (the link round-trip); LCP unchanged and
  // every SUBSEQUENT navigation stops re-downloading the whole stylesheet.
  experimental: {
    inlineCss: false,
    // Tree-shake barrel-export packages so only the icons/primitives actually used
    // are bundled (lucide-react is imported across ~68 files) — trims first-party JS.
    optimizePackageImports: ["lucide-react"],
    // ⚠️ NO `staleTimes` here, and that is a DECISION, not an omission (2026-07-21) — the
    // obvious "make navigation instant" lever is the wrong one for this app:
    //   · It does NOT affect back/forward. Browser back/forward always replays the client
    //     Router Cache; that path is already instant and staleTimes cannot make it faster.
    //     (What actually broke back-nav here was React state, fixed in listings-explorer's
    //     sessionStorage feed snapshot — not the router cache.)
    //   · `dynamic` (default 0) only widens FORWARD navigations. Raising it means a tab tap
    //     can re-serve a cached page: a sold listing still showing as available, or a stale
    //     price, on a marketplace. That is a correctness bug traded for a few hundred ms.
    //   · `static` already defaults to 300s and covers our prefetched/prerendered routes, so
    //     there is nothing to gain by restating it (and lowering it only costs refetches).
    // The latency win we DO take is prefetch: the bottom-nav tabs dropped `prefetch={false}`
    // (see mobile-nav.tsx), which warms the shell without ever serving stale data.
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
    /**
     * ⚠️ THE VISA AND TRIP CARD MODULES ARE ALIASED AWAY ON A MARKETPLACE BUILD, so their vocabulary
     * — "Pay with PayPal", "hộ chiếu", the passport wizard — is never emitted into a client chunk
     * that eno.vn serves. Before this, a marketplace build still shipped e-Visa strings in 21 chunks
     * and PayPal in 2; nothing rendered them (thread kinds are disarmed and the routes do not
     * exist), but "the string is not in the artifact" is a statement you can verify with grep, and
     * "the code declines to run" is a promise about control flow.
     *
     * Aliasing the MODULES rather than refactoring src/app/messages/[id]/page.tsx is deliberate:
     * that file is 1,857 lines, is the most-used surface in the app, and carries the
     * ChatSendButton onMouseDown+preventDefault invariant. This touches none of it.
     *
     * ⚠️ TYPESCRIPT NEVER SEES THE STUBS. An alias is a bundler resolution, so `tsc` checks the chat
     * page against the REAL modules — a stub whose shape drifts is a runtime crash that no typecheck
     * catches. src/components/marketplace/edition-stubs.test.ts is what makes that safe: it fails
     * the build when the chat page imports a symbol the stub does not export.
     */
    ...(EDITION_ENV === "marketplace"
      ? {
          resolveAlias: {
            "@/components/marketplace/visa-cards": "./src/components/marketplace/visa-cards.stub.tsx",
            "@/components/marketplace/trip-cards": "./src/components/marketplace/trip-cards.stub.tsx",
            // ⚠️ THE ONE THAT WAS MISSING, AND IT SAT ON THE BUSIEST PAGE ON THE SITE.
            // src/app/listings/[id]/page.tsx — the product detail page — imports VisaStart at module
            // top level, and both editions compile that page. A clean marketplace build was
            // measured shipping EIGHT distinct e-Visa sentences in a 61KB chunk that every eno.vn
            // listing page downloads. The call site's `isVisaProduct` gate was correct and useless:
            // a gate decides what renders, an alias decides what ships.
            // It escaped every guard because it is neither a route (so pageExtensions and the
            // `.svc.` convention miss it) nor inside a services TREE (so edition-lint Rule C, which
            // matches directories, misses it too). scripts/gen-ui-strings.mjs had ALREADY classified
            // it as a services source — the rule that follows: anything listed there needs a line
            // here.
            "@/components/marketplace/visa-start": "./src/components/marketplace/visa-start.stub.tsx",
            // The services translation catalogue — ~337 strings, including the e-Visa and passport
            // vocabulary, lazily loaded for third-language visitors. Aliased to an empty array so
            // eno.vn never ships the words at all.
            "@/generated/ui-strings.services": "./src/generated/ui-strings.services.stub.ts",
            // Footer links and home tiles. Already gated at their call sites — this removes the
            // LABELS from the artifact, which the gate cannot do.
            "@/lib/edition-services-copy": "./src/lib/edition-services-copy.stub.ts",
            // The third-party provider of record for the e-visa service: partner name, licence and
            // tax placeholders, and the provider-of-record disclosure in vi + en. The LEGAL PAGES
            // are shared by both editions — one /terms, one /privacy, one disclosure page, each
            // rendering the partner block only when IS_SERVICES — so this module is imported by
            // files that a marketplace build DOES compile. The gate stops it rendering; only the
            // alias stops eno.vn shipping the partner's name in its chunks.
            "@/lib/visa-provider": "./src/lib/visa-provider.stub.ts",
            // The visa/itinerary half of the API error vocabulary. `src/lib/api/errors.ts` holds a
            // RUNTIME array of code strings and is imported by `src/lib/api/client.ts`, which exists
            // precisely so the 176 hand-rolled `fetch('/api/…')` call sites can eventually branch on
            // typed codes — so this is a shared module on a path INTO client chunks. Eight of its
            // entries name a surface eno.vn may not mention (`visa_database_unavailable`,
            // `itinerary_limit_reached`, `not_a_visa_product`, …), and every one is emitted only by
            // a `route.svc.ts` handler that a marketplace build never compiles. Nothing renders them
            // today, which is exactly the state the sitemap leak was in before it shipped: a gate
            // decides what renders, an alias decides what ships.
            // ⚠️ THE TYPE UNION IS NOT SPLIT, ON PURPOSE — types are erased, so a whole
            // `ApiErrorCode` costs the marketplace nothing and keeps one vocabulary for the
            // compile-time subset assertions. Only the runtime array is edition-scoped.
            "@/lib/api/errors-services": "./src/lib/api/errors-services.stub.ts",
            // The cross-site backlink surface: the canonical eno.vn destinations eno.forum links
            // to, and the promo section that introduces them. Aliased for a reason that reads
            // backwards until you say it out loud — the copy is about eno.vn, and eno.vn is
            // precisely where it must not appear. "Already in Vietnam? Find housing, jobs and
            // motorbikes on eno.vn" is a useful sentence on eno.forum and a nonsense one served to
            // a reader who is already on eno.vn, where every href would also be a self-link.
            // ⚠️ BOTH ARE LISTED, AND NEITHER IS REDUNDANT. The lib has two importers — the promo
            // component and edition-services-copy.ts (which turns it into the footer's eno.vn
            // group) — and both of THOSE are themselves aliased, so in today's graph the lib is
            // already unreachable from a marketplace build. Relying on that is relying on a chain:
            // one future shared module importing @/lib/cross-site-links directly, and the labels
            // are in eno.vn's chunks with every existing alias still correct and every test still
            // green. Aliasing each module on its own makes the guarantee local to the module.
            "@/lib/cross-site-links": "./src/lib/cross-site-links.stub.ts",
            "@/components/marketplace/cross-site-promo": "./src/components/marketplace/cross-site-promo.stub.tsx",
            // The services-only paragraphs of /privacy — applicant identity documents, the
            // sensitive-data consent, the handover to the provider. Same shared-page problem as
            // visa-provider above: a privacy policy cannot 404 on the licensed marketplace, so a
            // marketplace build compiles that page and every literal in it.
            // ⚠️ AND THERE IS A SECOND PATH OUT, which is why the copy lives in a module rather
            // than in an `IS_SERVICES ?` branch: scripts/gen-ui-strings.mjs harvests
            // `<Tr text="…">` JSX literals into src/generated/ui-strings.ts, which is SHIPPED TO
            // THE BROWSER to pre-warm translations. /privacy renders its paragraphs from an array
            // (`<Tr text={p} />`), which the harvester does NOT see — measured 2026-08-01, none of
            // that page's paragraphs are in the catalogue — so today only the artifact path is
            // live. But the next person to add a sentence will write it the obvious way, as a
            // `<Tr text="…">` literal, and that one lands in the file every eno.vn visitor
            // downloads on every page. Behind a module boundary neither path exists.
            "@/lib/privacy-services-copy": "./src/lib/privacy-services-copy.stub.ts",
            // The services-only sections of /terms — who sells the e-visa service and answers for
            // it, where the money goes, whose complaint process applies. Identical reasoning to
            // privacy-services-copy directly above: /terms cannot 404 on the licensed marketplace,
            // so a marketplace build compiles the page, and a sentence written inline as
            // `<Tr text="…">` there would be harvested into the browser-shipped core translation
            // catalogue. Two modules rather than one shared "legal copy" module on purpose — each
            // page's copy is aliasable, testable and editable without touching the other's.
            "@/lib/terms-services-copy": "./src/lib/terms-services-copy.stub.ts",
            // The services-only addendum to /prohibited — the visa & immigration listing rules
            // (only a licensed business may list them, no guaranteed-approval claims, the
            // government fee shown separately from the service fee) plus the related-site note.
            // Same shared-page problem as the two directly above, with one addition worth stating
            // because it is the reason this page needed a module at all rather than an inline
            // `IS_SERVICES &&` block: the four prohibited-goods groups are rendered from ARRAY
            // DATA via `<Tr text={variable}>`, which gen-ui-strings.mjs does not harvest — so an
            // author adding visa rules to that page naturally reaches for the same array, and the
            // strings land in eno.vn's SERVER chunks instead of its client ones. Less visible,
            // same standard: not in the artifact.
            "@/lib/prohibited-services-copy": "./src/lib/prohibited-services-copy.stub.ts",
          },
        }
      : {}),
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
  // Canonical-host redirect: Vercel's domain config used to 308 www→apex; on
  // Cloud Run behind the LB both hosts reach the app, so the app owns it.
  async redirects() {
    return [
      {
        source: '/:path*',
        has: [{ type: 'host', value: 'www.eno.vn' }],
        destination: 'https://eno.vn/:path*',
        permanent: true,
      },
      // /dashboard/forum was the "Forum activity" section (posts/comments/saved), removed
      // 2026-07-21 in favour of the Help Center — which reads the SAME Forum* tables, so
      // nothing a member did there became unreachable. 308 so bookmarks and any indexed
      // URL move instead of 404ing.
      { source: '/dashboard/forum', destination: '/dashboard/help', permanent: true },
      // `/eno_vietnam` never existed as a storefront handle — the visa desk is `/eno_visa` — but
      // the footer linked to it on every page and Bing indexed it under the title "Eno Visa". A
      // 301 rather than nothing, so that indexed URL and any bookmark land on the real storefront
      // instead of a 404. Keep it: removing it later re-breaks an external link we know exists.
      { source: '/eno_vietnam', destination: '/eno_visa', permanent: true },
    ];
  },
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
    // Branded Google sign-in (src/lib/google-identity.ts) loads Google Identity Services from
    // accounts.google.com. WIDENED ONLY WHEN THE FEATURE IS CONFIGURED: with
    // NEXT_PUBLIC_GOOGLE_CLIENT_ID unset the strings below are empty and this header is
    // byte-identical to what it was before the feature existed — the CSP is the app's main
    // post-XSS exfiltration brake, so it must not grow for a feature that is switched off.
    // ⚠️ Same build-time read as the client bundle: NEXT_PUBLIC_* is inlined by `next build`, so
    // the var has to be in the Secret Manager build env, not only in the Cloud Run runtime env.
    // The four path-scoped sources are Google's documented requirements for GIS — script for the
    // library itself, frame for the One Tap iframe on non-FedCM browsers, connect for its XHRs,
    // style for the stylesheet it injects (our 'unsafe-inline' does NOT cover an external URL).
    // FedCM's own dialog is browser UI and is not subject to CSP.
    const gis = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID?.trim()
    const gsiScript = gis ? " https://accounts.google.com/gsi/client" : "";
    const gsiFrame = gis ? " https://accounts.google.com/gsi/" : "";
    const gsiConnect = gis ? " https://accounts.google.com/gsi/" : "";
    const gsiStyle = gis ? " https://accounts.google.com/gsi/style" : "";
    const csp = [
      "default-src 'self'",
      "base-uri 'self'",
      "object-src 'none'",
      "frame-ancestors 'self'",
      "form-action 'self'",
      // Next.js needs inline + eval without a nonce setup; GTM/Turnstile scripts. Leaflet is
      // SELF-HOSTED (public/vendor/leaflet) and the browser Meta Pixel is REMOVED (server-side
      // CAPI only) — so unpkg.com and the facebook.net/stape/run.app hosts are gone from every
      // directive. (va.vercel-scripts.com dropped with the Vercel→Cloud Run migration.)
      "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://www.googletagmanager.com https://static.cloudflareinsights.com https://challenges.cloudflare.com" + gsiScript,
      "style-src 'self' 'unsafe-inline'" + gsiStyle,
      // Supabase is PINNED to our exact project host (not *.supabase.co): connect-src is the
      // main post-XSS exfiltration brake, and a wildcard would let stolen data POST to any
      // attacker-owned Supabase project. *.googleusercontent.com = Google account avatars
      // (OAuth sign-in) — without it they render as a broken-image icon.
      "img-src 'self' capacitor: data: blob: https://xihiryllwmjoouipkyhw.supabase.co https://*.googleusercontent.com https://*.basemaps.cartocdn.com https://www.google-analytics.com https://www.googletagmanager.com",
      // <video> sources for listing videos: our public bucket + blob: (the wizard's
      // client-side preview object URL). Without this, default-src 'self' blocks playback.
      "media-src 'self' blob: https://xihiryllwmjoouipkyhw.supabase.co",
      "font-src 'self' data:",
      // `capacitor:` (img+connect): the iOS shell's Camera picker returns capacitor://
      // webPaths that the post wizard fetch()es into Files — without the scheme the CSP
      // silently killed every picked photo IN-APP on iOS (Android rides the same-origin
      // /_capacitor_file_/ path, hence 'self' sufficed there). Browsers can't reach the
      // scheme, so the web surface is unchanged.
      "connect-src 'self' capacitor: https://xihiryllwmjoouipkyhw.supabase.co wss://xihiryllwmjoouipkyhw.supabase.co https://www.google-analytics.com https://region1.google-analytics.com https://www.googletagmanager.com https://cloudflareinsights.com https://static.cloudflareinsights.com" + gsiConnect,
      "frame-src 'self' https://td.doubleclick.net https://challenges.cloudflare.com" + gsiFrame,
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
      // ⚠️ THESE FOUR ROUTES WERE INDEXABLE, AND robots.txt SAYS THEY ARE NOT.
      //
      // robots.txt deliberately does NOT Disallow /messages or /saved, and states the reason in
      // its own comment: they "carry meta noindex", and a Disallow would stop crawlers from ever
      // SEEING that noindex. Measured on production 2026-07-27, that premise was false —
      // /messages, /messages/ai, /messages/pending and /saved each returned 200 with ZERO
      // `name="robots"` meta, wearing the homepage's title and description and no canonical.
      // They are CLIENT components, so they cannot export Next `metadata` at all; the intended
      // noindex had nowhere to come from.
      //
      // A header rather than page metadata for two reasons: it works regardless of whether the
      // route can export metadata, and it does not require editing messages/layout.tsx, which
      // carries load-bearing virtual-keyboard invariants that are not worth disturbing for an
      // SEO fix. `follow` is deliberately NOT granted — there is nothing on a private inbox
      // worth crawling onward to.
      {
        source: "/messages/:path*",
        headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow" }],
      },
      { source: "/messages", headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow" }] },
      { source: "/saved", headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow" }] },
    ];
  },
};

export default nextConfig;
