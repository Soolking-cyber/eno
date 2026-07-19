import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { Toaster as SonnerToaster } from "@/components/ui/sonner";
import { ThemeProvider } from "@/context/theme-context";
import { LanguageProvider } from "@/context/language-context";
import { CurrencyProvider } from "@/context/currency-context";
import { AuthProvider } from "@/context/auth-context";
import { ChatProvider } from "@/context/chat-context";
import { NotificationsProvider } from "@/context/notifications-context";
import { FavoritesProvider } from "@/context/favorites-context";
import { QueryProvider } from "@/components/marketplace/query-provider";
import { MobileNav } from "@/components/marketplace/mobile-nav";
import { BottomNavSpacer } from "@/components/marketplace/bottom-nav-spacer";
import { KeyboardViewportSync } from "@/components/marketplace/keyboard-viewport-sync";
import { BackToTop } from "@/components/marketplace/back-to-top";
import { SkipLink } from "@/components/marketplace/skip-link";
import { CookieConsent } from "@/components/marketplace/cookie-consent";
import { InstallHint } from "@/components/marketplace/install-hint";
import { SaveSignupSheet } from "@/components/marketplace/save-signup-sheet";
import { ImageShield } from "@/components/marketplace/image-shield";
import { AnalyticsTags } from "@/components/marketplace/analytics-tags";
import { PrelaunchNotice } from "@/components/marketplace/prelaunch-notice";
import { AttributionCapture } from "@/components/marketplace/attribution-capture";
import { AccountPanelShell } from "@/components/marketplace/account-panel";
import { TooltipProvider } from "@/components/ui/tooltip";
import { NativeBootstrap } from "@/components/native/native-bootstrap";
import { NativePush } from "@/components/native/native-push";

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

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
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
            __html: `(function(){try{var t=localStorage.getItem('eno-theme');if(t==='dark'||((!t||t==='system')&&matchMedia('(prefers-color-scheme: dark)').matches))document.documentElement.classList.add('dark');var l=localStorage.getItem('lang');if(l)document.documentElement.lang=l;}catch(e){}try{var C=window.Capacitor;if(C&&C.isNativePlatform&&C.isNativePlatform()){var dc=document.documentElement.classList;dc.add('native');dc.add('native-'+(C.getPlatform?C.getPlatform():'ios'));}else if(!window.scrollY){document.documentElement.classList.add('page-at-top');}}catch(e){}})();`,
          }}
        />
        {/* Warm up TCP/TLS to the image origin so above-the-fold listing photos
            start downloading sooner. (The map tile origin — cartocdn — is
            preconnected lazily by the map itself, which only mounts on demand;
            Leaflet is self-hosted first-party.) */}
        <link rel="preconnect" href="https://xihiryllwmjoouipkyhw.supabase.co" crossOrigin="" />
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
        <PrelaunchNotice />
        <ThemeProvider>
          <LanguageProvider>
            {/* Native-shell (Capacitor) bootstrap — a no-op on web; on iOS/Android it hides the
                splash, theme-matches the status bar, bridges the native keyboard, handles back,
                and (needs LanguageProvider) localizes the long-press action sheet. Still inside
                ThemeProvider, so status-bar theming is unchanged. */}
            <NativeBootstrap />
            <SkipLink />
            <CurrencyProvider>
            <AuthProvider>
              {/* Native push registration — no-op on web + until the plugin is wired (dormant). */}
              <NativePush />
              <NotificationsProvider>
                <ChatProvider>
                  <FavoritesProvider>
                    <QueryProvider>
                      {/* One delay group for every ui/tooltip in the app: moving between adjacent
                          icon tooltips feels instant once the first opens. Context only, no DOM. */}
                      <TooltipProvider>
                      <AccountPanelShell>
                      {children}
                      {/* Inside the shell so it can READ the panel state (it portals to
                          <body>, so nesting costs it no positioning): the floating
                          controls are fixed, which means the shell's lg:mr-[440px] can't
                          move them — they'd sit on top of the open dashboard rail. They
                          shift themselves instead. */}
                      <BackToTop />
                      </AccountPanelShell>
                      {/* Reserve room for the fixed mobile bottom-nav. A WHITE
                          spacer (not body padding) so when the nav auto-hides at
                          the page bottom it blends with the footer instead of
                          exposing a grey band. Collapses when the keyboard is up
                          (the nav hides then) so it doesn't leave a gap under the
                          chat composer. */}
                      <BottomNavSpacer />
                      <KeyboardViewportSync />
                      <MobileNav />
                      <CookieConsent />
                      <InstallHint />
                      <SaveSignupSheet />
                      <ImageShield />
                      </TooltipProvider>
                    </QueryProvider>
                  </FavoritesProvider>
                </ChatProvider>
              </NotificationsProvider>
            </AuthProvider>
            </CurrencyProvider>
          </LanguageProvider>
          {/* Inside ThemeProvider so toasts follow the in-app theme toggle. */}
          <SonnerToaster position="top-center" closeButton />
        </ThemeProvider>
        <AnalyticsTags />
        <AttributionCapture />
      </body>
    </html>
  );
}
