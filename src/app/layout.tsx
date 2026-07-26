import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { AnalyticsTags } from "@/components/marketplace/analytics-tags";
import { AttributionCapture } from "@/components/marketplace/attribution-capture";
import { Providers } from "./providers";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin", "vietnamese"],
  display: "swap",
});

const OG_IMAGE = { url: "/listings/hero-market.png", width: 1344, height: 768, alt: "eno.vn — trusted marketplace" };

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
  title: "eno.vn - Trusted Expat Marketplace in Vietnam",
  description:
    "eno.vn is a trusted marketplace for expats and internationals in Vietnam. Find housing, jobs, motorbikes, services, moving sales, and more — sellers build public trust scores and the community keeps listings honest.",
  applicationName: "eno.vn",
  appleWebApp: { capable: true, title: "eno.vn", statusBarStyle: "default" },
  keywords: [
    "eno.vn",
    "eno.vn",
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
  authors: [{ name: "eno.vn" }],
  openGraph: {
    title: "eno.vn - Trusted Expat Marketplace in Vietnam",
    description:
      "A trusted marketplace for expats and internationals in Vietnam. Housing, jobs, motorbikes, services and moving sales — sellers build trust scores and the community keeps listings honest.",
    siteName: "eno.vn",
    type: "website",
    images: [OG_IMAGE],
  },
  twitter: {
    card: "summary_large_image",
    title: "eno.vn - Trusted Expat Marketplace in Vietnam",
    description: "Trusted marketplace for expats in Vietnam — housing, jobs, motorbikes, services, moving sales.",
    images: [OG_IMAGE.url],
  },
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // ⚠️ THE SERVER RENDERED lang="en" FOR EVERY VISITOR, INCLUDING VIETNAMESE ONES.
  //
  // The language context already mirrors the active language into a `lang` cookie precisely so the
  // server can read it, and the pre-paint script below already corrects `document.documentElement
  // .lang` from localStorage — so the value was right for anyone running JS and wrong for everyone
  // and everything else. That is an ACCESSIBILITY defect first: a screen reader picks its voice and
  // pronunciation rules from this attribute at parse time, so Vietnamese copy was being read aloud
  // with English phonetics.
  //
  // ⚠️ IT IS NOT AN SEO FIX, and should not be sold as one — Google determines page language from
  // the visible text and ignores this attribute. The SEO answer to serving two languages is
  // separate URLs per language with hreflang, which is deliberately NOT being done here: with 31
  // of 32 listing titles written in English, a Vietnamese URL tree today would be Vietnamese
  // chrome wrapped around English bodies, i.e. near-duplicate thin pages.
  //
  // Safe against hydration because <html> already carries suppressHydrationWarning (the theme
  // script mutates this element pre-paint for the same reason).
  const { cookies } = await import('next/headers')
  const lang = (await cookies()).get('lang')?.value === 'vi' ? 'vi' : 'en'
  return (
    <html lang={lang} suppressHydrationWarning>
      <head>
        {/* Set the theme class BEFORE paint to avoid a flash of the wrong scheme —
            reads the persisted System/Light/Dark choice + the OS preference. Kept
            in sync with ThemeProvider. Also sets the native + native-<platform>
            classes pre-paint (Capacitor injects window.Capacitor at documentStart
            in remote-server mode): the html.native-ios overscroll rule (iOS
            pull-to-refresh reachability) must hold from first paint, not from
            hydration. native-bootstrap re-adds the same classes later —
            idempotent, kept as the fallback. */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem('eno-theme');if(t==='dark'||((!t||t==='system')&&matchMedia('(prefers-color-scheme: dark)').matches))document.documentElement.classList.add('dark');var l=localStorage.getItem('lang');if(l)document.documentElement.lang=l;}catch(e){}try{var dc=document.documentElement.classList;var C=window.Capacitor;if(C&&C.isNativePlatform&&C.isNativePlatform()){dc.add('native');dc.add('native-'+(C.getPlatform?C.getPlatform():'ios'));}else if(navigator.userAgent.indexOf('EnoNativeTabs')>-1){dc.add('native');dc.add('native-ios');dc.add('native-tabs');}else if(!window.scrollY){dc.add('page-at-top');}}catch(e){}})();`,
          }}
        />
        {/* Supabase preconnect REMOVED (perf Phase 1, measured): every above-the-fold
            image is served through same-origin /_next/image (the optimizer fetches
            Supabase server-side), auth is lazy and realtime is authed-only — nothing
            hits the origin directly before LCP. Listing VIDEOS do connect directly,
            but only well after LCP when a card's clip mounts. */}
        {/* NB: the hero-wordmark preload (/logo.svg) lives on the HOME page only —
            it's the landing LCP element there and unused elsewhere (preloading it
            globally warned "preloaded but not used" on every non-home route). */}
        {/* Organization entity — ties the brand "eno.vn" to its official social
            profiles (sameAs) so Google can recognise it as a distinct brand and
            attribute the eno.vn query to this site. */}
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify({
              "@context": "https://schema.org",
              "@type": "Organization",
              name: "eno.vn",
              alternateName: ["ENO"],
              url: "https://eno.vn",
              logo: "https://eno.vn/logo.svg",
              description:
                "eno.vn is a trusted marketplace for expats and internationals in Vietnam — housing, jobs, motorbikes, services and moving sales.",
              sameAs: [
                "https://www.facebook.com/profile.php?id=61591370031264",
                "https://www.instagram.com/eno.vn/",
                "https://www.youtube.com/@enovietnam",
              ],
            }).replace(/</g, "\\u003c"),
          }}
        />
        {/* WebSite entity + SearchAction → eligible for Google's sitelinks search box
            (search eno.vn directly from the results). Target is the real ?q= search. */}
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify({
              "@context": "https://schema.org",
              "@type": "WebSite",
              name: "eno.vn",
              url: "https://eno.vn",
              potentialAction: {
                "@type": "SearchAction",
                target: {
                  "@type": "EntryPoint",
                  urlTemplate: "https://eno.vn/?q={search_term_string}",
                },
                "query-input": "required name=search_term_string",
              },
            }).replace(/</g, "\\u003c"),
          }}
        />
      </head>
      <body
        className={`${inter.variable} antialiased bg-background text-foreground`}
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
