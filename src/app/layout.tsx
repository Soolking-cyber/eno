import type { Metadata, Viewport } from "next";
import { Be_Vietnam_Pro, Inter } from "next/font/google";
import "./globals.css";
import { AnalyticsTags } from "@/components/marketplace/analytics-tags";
import { AttributionCapture } from "@/components/marketplace/attribution-capture";
import { Providers } from "./providers";
import { IS_SERVICES, SITE_NAME } from "@/lib/edition";
/**
 * ⚠️ THE SERVICES-EDITION SENTENCES ARE IMPORTED, NOT WRITTEN HERE, AND THAT IS THE WHOLE POINT.
 * This file compiles on BOTH editions, so a services literal sitting in an `IS_SERVICES ? … : …`
 * ternary would stay in eno.vn's artifact even though it never renders — measured, and documented
 * at the head of src/lib/edition-services-copy.ts. next.config.ts aliases that module to a stub of
 * empty strings on a marketplace build, which is the only mechanism that removes the words.
 */
import {
  SERVICES_SITE_DESCRIPTION,
  SERVICES_SITE_KEYWORDS,
  SERVICES_SITE_TAGLINE,
} from "@/lib/edition-services-copy";

/**
 * This deployment's own identity, used by everything below that describes the site to a machine.
 *
 * ⚠️ THE FALLBACK IS A LAST RESORT, NOT A DEFAULT. next.config.ts refuses to build when
 * NEXT_PUBLIC_ENO_EDITION is set and NEXT_PUBLIC_APP_URL is absent or on the wrong host, so in any
 * real deployment this env var is present and correct. The literal survives only for the
 * transitional single-deployment build, where no edition is declared.
 */
const SITE_ORIGIN = process.env.NEXT_PUBLIC_APP_URL || "https://eno.vn";

/**
 * ⚠️ THE VARIABLE CLASS GOES ON <html>, NOT <body>. THIS IS THE WHOLE BUG THAT USED TO BE HERE.
 *
 * Tailwind v4's preflight styles `html,:host { font-family: var(--default-font-family, <system stack>) }`,
 * and our `@theme inline` compiles `--default-font-family` down to `var(--font-be-vietnam-pro), …`.
 * next/font defines that variable on the class it hands back — so if the class sits on <body>, the
 * variable does not exist on <html>, `var()` is undefined there, the whole declaration is invalid at
 * computed-value time, and font-family falls back to the SYSTEM STACK. <body> then inherits that
 * already-resolved stack, so defining the variable on <body> changes nothing.
 *
 * That is exactly what shipped until 2026-08-05: Inter was downloaded and preloaded on every page and
 * NEVER APPLIED. Measured in headless Chrome — every Inter face reported `unloaded`, and computed
 * font-family on html/body/h1 was `-apple-system, …, Roboto, …`. Mac users saw SF, Android Roboto,
 * Windows Segoe: the marketplace had no typographic identity at all, only a wasted preload.
 *
 * TWO FACES, SPLIT BY UI LANGUAGE (owner, 2026-08-05). Inter is the default; Be Vietnam Pro is used
 * only when the interface language is Vietnamese, via `html[lang="vi"]` in globals.css. The split is
 * driven by measurement, not taste — same string, same size, versus the system stack people were
 * actually seeing while the webfont was dead:
 *
 *                     Vietnamese title      English title
 *   Inter                    +0.2%              +0.9%
 *   Be Vietnam Pro           +1.5%              +4.9%
 *
 * So Be Vietnam Pro is nearly free on the copy it was designed for and expensive on English, where it
 * cost noticeably more truncation in the feed. Inter is indistinguishable in width from the fallback,
 * which is why English goes back to it.
 *
 * Inter is a VARIABLE font (opsz + wght), so it ships one file per subset and every weight is free.
 * Be Vietnam Pro is STATIC, so its weights are enumerated: 400/500/600/700 cover 98% of call sites and
 * 800 carries the real display moments (promo-banner headline, trust score). 900 is omitted — its 3
 * call sites match down to 800 indistinguishably.
 */
/**
 * ⚠️ `axes: ["opsz"]` IS REQUIRED FOR THE OPTICAL-SIZE AXIS TO EXIST AT ALL, and its absence
 * made a typographic claim in globals.css a no-op for as long as it has been written.
 * next/font/google serves the WGHT-ONLY cut of a variable font unless the extra axes are named,
 * so `font-variation-settings: "opsz" …` had nothing to vary. Measured before this change by
 * rendering one 100px string at both extremes: `opsz 14` and `opsz 32` came back byte-identical
 * at 1179.297px, while `wght 400` → `800` moved 1179.297 → 1243.539 — so the technique was
 * sound and the axis was simply absent. `document.fonts` confirmed it: the loaded face reported
 * "Inter 100 900", a weight range and no optical range.
 *
 * What it buys: a 40px hero heading and a 10px nav label stop being drawn from the SAME cut.
 * Optical sizing is the thing SF Text vs SF Display exists to do — tighter spacing and thinner
 * strokes as type grows, looser and sturdier as it shrinks. Verified working after the change:
 * one string at opsz 14 / 20 / 32 measures 1209.7 / 1186.0 / 1138.5 — monotonic, 5.9% end to
 * end, where all three were byte-identical before.
 *
 * ⚠️ IT COSTS +28.9 KB ON THE PRELOADED CRITICAL PATH (57.3 → 86.2 KB, measured in the built
 * artifact), because a second axis has to ship in the same woff2. The number belongs here
 * rather than in a commit message nobody re-reads.
 *
 * ⚠️ AND THE OBVIOUS DEFENCE OF THAT COST IS WRONG, so it is written down before someone
 * reaches for it again. "The home page's LCP element is a card photo, not text, so fonts do
 * not gate LCP" is inverted: next/font emits `<link rel="preload" as="font">`, which the
 * browser fetches at HIGHEST priority — ahead of images. So the extra font bytes compete with
 * the LCP photo for the same early bandwidth; being an image is precisely what makes it
 * vulnerable, not what makes it safe. A reviewer caught this and was right.
 * The honest position: this is a real cost in the primary market's network conditions, it is
 * NOT measurable on a dev machine, and it has not been measured on a throttled 3G profile.
 * If a perf pass wants it back, deleting this one `axes` line reverts the entire feature —
 * nothing else depends on it, because the optical ladder is the browser's job (see the note
 * in globals.css), not a set of hardcoded values that would have to be unwound too.
 */
const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin", "vietnamese"],
  display: "swap",
  axes: ["opsz"],
});

/**
 * ⚠️ `preload: false` IS DELIBERATE AND LOAD-BEARING. This face is used only under `html[lang="vi"]`,
 * which is a client-set attribute, so preloading it would push ~87KB of woff2 onto the critical path
 * of every English visitor to fetch a font their page never references. Without preload the browser
 * fetches it lazily, when a rule actually matches. Do not "fix" this by turning preload on.
 */
const beVietnamPro = Be_Vietnam_Pro({
  variable: "--font-be-vietnam-pro",
  subsets: ["latin", "vietnamese"],
  weight: ["400", "500", "600", "700", "800"],
  display: "swap",
  preload: false,
});

const OG_IMAGE = { url: "/listings/hero-market.png", width: 1344, height: 768, alt: `${SITE_NAME} — trusted marketplace` };

/**
 * THE SITEWIDE DESCRIPTION, PER EDITION.
 *
 * ⚠️ IT USED TO BE ONE HARDCODED SENTENCE STARTING "eno.vn is …", ON BOTH DEPLOYMENTS. That is the
 * same class of defect as the Organization JSON-LD below, and it reached further: `description`
 * feeds the <meta name="description"> on EVERY eno.forum page, so the licensed marketplace's name
 * and self-description were the snippet Google had for every services URL — including the e-visa
 * ones. Title, applicationName and appleWebApp were already edition-aware; this was not.
 */
const SITE_DESCRIPTION = IS_SERVICES
  ? SERVICES_SITE_DESCRIPTION
  : "eno.vn is a trusted marketplace for expats and internationals in Vietnam. Find housing, jobs, motorbikes, services, moving sales, and more — sellers build public trust scores and the community keeps listings honest.";

/** The short form, for the OG and Twitter cards. */
const SITE_TAGLINE = IS_SERVICES
  ? SERVICES_SITE_TAGLINE
  : "A trusted marketplace for expats and internationals in Vietnam. Housing, jobs, motorbikes, services and moving sales — sellers build trust scores and the community keeps listings honest.";

// Both schemes are supported now (real dark theme in globals.css `.dark`,
// toggled System/Light/Dark). theme-color is media-matched so the iOS status-bar
// / toolbar stays seamless with the chrome in each scheme (white header in light,
// dark canvas in dark). viewportFit:"cover" activates env(safe-area-inset-*) so
// the safe-area padding the header/nav/body declare is honored (notch + home bar).
export const viewport: Viewport = {
  colorScheme: "light dark",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#1b1b1b" },
  ],
  viewportFit: "cover",
  // Android/Chromium: shrink the LAYOUT viewport when the keyboard opens so 100dvh +
  // fixed bottom bars fit above it with zero JS. iOS Safari ignores this (it overlays
  // the keyboard — handled via VisualViewport in use-virtual-keyboard.ts), so it's a
  // free correctness win on Android and a harmless no-op on iOS.
  interactiveWidget: "resizes-content",
};

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_APP_URL || "https://eno.vn"),
  // Google Search Console / Merchant Center domain verification.
  verification: { google: "alQ9GmeeCLxBtPVZM8CEvEDmieP7JuS4wGTrYHW5hCY" },
  title: `${SITE_NAME} - Trusted Expat Marketplace in Vietnam`,
  description: SITE_DESCRIPTION,
  applicationName: SITE_NAME,
  appleWebApp: { capable: true, title: SITE_NAME, statusBarStyle: "default" },
  // ⚠️ THE BRAND KEYWORD IS SITE_NAME, AND IT USED TO BE "eno.vn" TWICE — a duplicate that was
  // also the licensed company's name on the services build. Keywords are near-worthless as a
  // signal; being wrong about who the site IS is not.
  keywords: [
    SITE_NAME,
    ...SERVICES_SITE_KEYWORDS,
    "expat marketplace Vietnam",
    "Vietnam expats",
    "Viet Kieu",
    "trusted marketplace",
    "housing Vietnam expats",
    "motorbike rental Saigon",
    "house rental Thao Dien",
    "moving sale Vietnam",
    "jobs Vietnam expats",
    "classifieds Vietnam",
  ],
  authors: [{ name: SITE_NAME }],
  openGraph: {
    title: `${SITE_NAME} - Trusted Expat Marketplace in Vietnam`,
    description: SITE_TAGLINE,
    siteName: SITE_NAME,
    type: "website",
    images: [OG_IMAGE],
  },
  twitter: {
    card: "summary_large_image",
    title: `${SITE_NAME} - Trusted Expat Marketplace in Vietnam`,
    description: SITE_TAGLINE,
    images: [OG_IMAGE.url],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${inter.variable} ${beVietnamPro.variable}`} suppressHydrationWarning>
      <head>
        {/* Set the theme class BEFORE paint to avoid a flash of the wrong scheme —
            reads the persisted System/Light/Dark choice + the OS preference. Kept
            in sync with ThemeProvider. Also sets the native + native-<platform>
            classes pre-paint (Capacitor injects window.Capacitor at documentStart
            in remote-server mode): the html.native-ios overscroll rule (iOS
            pull-to-refresh reachability) must hold from first paint, not from
            hydration. native-bootstrap re-adds the same classes later —
            idempotent, kept as the fallback.

            ⚠️ THE SPLASH HIDE LIVES HERE NOW, AND THAT IS WHY THE APP FELT SLOW.
            The only other `SplashScreen.hide()` is in native-bootstrap.tsx, inside a useEffect —
            so it cannot run until React hydrates, and on a phone it never won the race against
            the 3s `launchAutoHide` floor. Measured on a real bridge shim (iPhone 13, 4x CPU,
            slow-4G): warm launch painted at 856ms and the cover did not lift until 5541ms; cold
            painted at 2652ms and lifted at 8128ms. Every reveal was therefore a flat 3.0s, with a
            fully painted page sitting behind a static image. Android was worse than a wasted wait:
            its OnPreDrawListener returns false for the whole duration, so it draws no frame at all.

            Three details that make this safe rather than just early:
            · It fires ON FIRST CONTENTFUL PAINT, not at document start. Render-blocking CSS has
              landed by then, so the SSR page is styled and laid out; CLS is 0, so nothing shifts
              as images stream in. Revealing at document start would show an empty WebView, which
              is the one failure mode worth fearing here.
              ⚠️ A PerformanceObserver on `paint`, NOT DOMContentLoaded — and the difference is
              1.5 seconds. DOMContentLoaded waits for the whole 349 KB document to finish parsing:
              measured on the real artifact under 4x CPU, paint at 688 ms but DCL-driven hide at
              2259 ms. FCP is the moment there is something worth revealing, so that is the
              moment to reveal it. `buffered: true` covers an FCP that already happened before the
              observer was installed.
              ⚠️ DOMContentLoaded is registered ONLY when PerformanceObserver is unavailable, and
              that exclusivity is the point. Registering both looks like belt-and-braces but is a
              race: DCL does NOT wait for stylesheets while FCP does, so on a slow-CSS load the
              DCL path could fire FIRST and reveal an unpainted WebView — the exact failure this
              whole approach exists to avoid. codex caught it.
            · `done` is set only AFTER the bridge call is actually issued, and is released again if
              the returned promise rejects, so a failed hide leaves the 4s backstop and the
              native-bootstrap fallback able to retry. Latching it up front would have turned one
              failed call into a permanently stuck splash.
            · It calls `C.nativePromise(...)` — the RAW bridge — not `Capacitor.Plugins`, which is
              only populated when a bundle imports @capacitor/core's registerPlugin. Same trap
              already documented in capacitor/www/index.html. This also drops the dynamic
              `import('@capacitor/splash-screen')` chunk fetch the old path waited on (273ms of it).
            · The 4s belt-and-braces timeout covers a document that paints but never fires
              DOMContentLoaded. It is longer than the native 3s floor on purpose: it must never be
              the thing that reveals a blank WebView, only a last resort if the floor is raised.
            native-bootstrap's hide stays as an idempotent fallback — both platforms no-op when the
            splash is already hidden. */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem('eno-theme');if(t==='dark'||((!t||t==='system')&&matchMedia('(prefers-color-scheme: dark)').matches))document.documentElement.classList.add('dark');var l=localStorage.getItem('lang');if(l)document.documentElement.lang=l;}catch(e){}try{var dc=document.documentElement.classList;var C=window.Capacitor;if(C&&C.isNativePlatform&&C.isNativePlatform()){dc.add('native');dc.add('native-'+(C.getPlatform?C.getPlatform():'ios'));(function(){var done=false;var lift=function(){if(done)return;try{var r=C.nativePromise('SplashScreen','hide',{fadeOutDuration:200});done=true;if(r&&typeof r.catch==='function')r.catch(function(){done=false;});}catch(e){}};var po=null;try{po=new PerformanceObserver(function(list){for(var i=0,e=list.getEntries();i<e.length;i++){if(e[i].name==='first-contentful-paint'){po.disconnect();requestAnimationFrame(lift);return;}}});po.observe({type:'paint',buffered:true});}catch(e){po=null;}if(!po){var dcl=function(){requestAnimationFrame(function(){requestAnimationFrame(lift);});};if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',dcl,{once:true});else dcl();}setTimeout(lift,4000);})();}else if(navigator.userAgent.indexOf('EnoNativeTabs')>-1){dc.add('native');dc.add('native-ios');dc.add('native-tabs');}else if(!window.scrollY){dc.add('page-at-top');}}catch(e){}})();`,
          }}
        />
        {/* Supabase preconnect REMOVED (perf Phase 1, measured): every above-the-fold
            image is served through same-origin /_next/image (the optimizer fetches
            Supabase server-side), auth is lazy and realtime is authed-only — nothing
            hits the origin directly before LCP. Listing VIDEOS do connect directly,
            but only well after LCP when a card's clip mounts. */}
        {/* NB: the hero-wordmark preload (/logo-dotvn.svg) lives on the HOME page only.
            ⚠️ THE ORIGINAL REASON EXPIRED ON 2026-08-02 and the conclusion survives on a new one.
            It used to be "unused elsewhere", which earned a "preloaded but not used" warning on
            every non-home route; since the header adopted the same lockup, the file is now used on
            EVERY page and that warning can no longer fire. It still belongs on home alone because
            elsewhere it is pointless, not harmful: the header <img> sits at the very top of the
            initial markup, so the preload scanner finds it immediately and a <link> would only
            duplicate a request the parser is already about to make. Home is different — there the
            LCP element is the larger hero lockup further down the document, which is worth
            announcing early. */}
        {/* Organization entity — ties the brand to its official social profiles (sameAs) so Google
            can recognise it as a distinct brand and attribute the brand query to this site.

            ⚠️ EVERY FIELD HERE WAS HARDCODED TO eno.vn, AND ON eno.forum THAT IS A LEGAL LEAK, NOT A
            COSMETIC ONE. Caught by curling the first real services-edition build: its
            /vietnam-evisa page told Google `"@type":"Organization","name":"eno.vn",
            "url":"https://eno.vn"` — the LICENSED company declaring itself the publisher of the
            e-visa service it is not licensed to sell, in machine-readable structured data, on the
            one page where that claim is most damaging. The canonical was already correct; this was
            not, because it never read the environment at all.

            Everything now derives from SITE_ORIGIN (NEXT_PUBLIC_APP_URL, which next.config.ts
            asserts matches the edition), so each deployment describes itself and only itself. */}
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify({
              "@context": "https://schema.org",
              "@type": "Organization",
              name: SITE_NAME,
              alternateName: ["ENO"],
              url: SITE_ORIGIN,
              logo: `${SITE_ORIGIN}/logo.svg`,
              /* ⚠️ THE SERVICES BRANCH IS THE ALIASED CONSTANT, NEVER A LITERAL. It used to be an
                 inline string here, and it was wrong twice over. (1) LEAK: this file is shared, so
                 the literal compiled into the marketplace build and "Vietnam e-visa assistance"
                 was measurably present in eno.vn's own artifact — a runtime `IS_SERVICES ?` picks
                 which branch RENDERS, it does not remove the other one from the bundle. The same
                 file already imports SERVICES_SITE_DESCRIPTION from the module next.config.ts
                 aliases to a stub, and the <meta name="description"> above already used it; only
                 this JSON-LD copy was left behind. (2) STALE: it advertised trip planning, which
                 the owner dropped on 2026-08-01 — the constant's own header records that. One
                 source for the sitewide self-description means the next such change lands once. */
              description: IS_SERVICES
                ? SERVICES_SITE_DESCRIPTION
                : "eno.vn is a trusted marketplace for expats and internationals in Vietnam — housing, jobs, motorbikes, services and moving sales.",
              /* ⚠️ MARKETPLACE ONLY, and deliberately so pending a decision that is not an
                 engineer's to make. These accounts are the eno.vn brand's; asserting `sameAs` from
                 eno.forum would tell Google the two sites are one entity, which is the opposite of
                 the separation this split exists to create. If eno.forum is a distinct registered
                 business it needs its own profiles here; if it is the same business trading under
                 two domains, counsel should say so before we re-link them. Omitting is the
                 reversible choice. */
              ...(IS_SERVICES ? {} : {
                sameAs: [
                  "https://www.facebook.com/profile.php?id=61591370031264",
                  "https://www.instagram.com/eno.vn/",
                  "https://www.youtube.com/@enovietnam",
                ],
              }),
            }).replace(/</g, "\\u003c"),
          }}
        />
        {/* WebSite entity + SearchAction → eligible for Google's sitelinks search box. Target is the
            real ?q= search on THIS origin — pointing it at the other domain would hand the sitelinks
            box, and the query, to the wrong site. */}
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify({
              "@context": "https://schema.org",
              "@type": "WebSite",
              name: SITE_NAME,
              url: SITE_ORIGIN,
              potentialAction: {
                "@type": "SearchAction",
                target: {
                  "@type": "EntryPoint",
                  urlTemplate: `${SITE_ORIGIN}/?q={search_term_string}`,
                },
                "query-input": "required name=search_term_string",
              },
            }).replace(/</g, "\\u003c"),
          }}
        />
      </head>
      <body
        className="antialiased bg-background text-foreground"
      >
        {/* The provider pyramid + persistent chrome live in ./providers.tsx (audit §E) —
            this file keeps only document concerns (fonts, metadata, viewport, head). */}
        <Providers>{children}</Providers>
        <AnalyticsTags />
        <AttributionCapture />
      </body>
    </html>
  );
}
