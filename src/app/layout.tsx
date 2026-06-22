import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { Toaster as SonnerToaster } from "@/components/ui/sonner";
import { ThemeProvider } from "@/context/theme-context";
import { LanguageProvider } from "@/context/language-context";
import { AuthProvider } from "@/context/auth-context";
import { ChatProvider } from "@/context/chat-context";
import { NotificationsProvider } from "@/context/notifications-context";
import { FavoritesProvider } from "@/context/favorites-context";
import { QueryProvider } from "@/components/marketplace/query-provider";
import { MobileNav } from "@/components/marketplace/mobile-nav";
import { CookieConsent } from "@/components/marketplace/cookie-consent";
import { AnalyticsTags } from "@/components/marketplace/analytics-tags";
import { SpeedInsights } from "@vercel/speed-insights/next";
import { Analytics } from "@vercel/analytics/next";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin", "vietnamese"],
  display: "swap",
});

const OG_IMAGE = { url: "/listings/hero-market.png", width: 1344, height: 768, alt: "eno.vn — verified marketplace" };

// Both schemes are supported now (real dark theme in globals.css `.dark`,
// toggled System/Light/Dark). theme-color is media-matched so the iOS status-bar
// / toolbar stays seamless with the chrome in each scheme (white header in light,
// dark canvas in dark). viewportFit:"cover" activates env(safe-area-inset-*) so
// the safe-area padding the header/nav/body declare is honored (notch + home bar).
export const viewport: Viewport = {
  colorScheme: "light dark",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#0e1116" },
  ],
  viewportFit: "cover",
};

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_APP_URL || "https://eno.vn"),
  title: "eno.vn - Verified Expat Marketplace in Vietnam",
  description:
    "eno.vn is a verified marketplace for expats and internationals in Vietnam. Find housing, jobs, motorbikes, services, moving sales, and more — every listing is checked before it goes live.",
  applicationName: "eno.vn",
  keywords: [
    "eno.vn",
    "eno.vn",
    "expat marketplace Vietnam",
    "Vietnam expats",
    "Viet Kieu",
    "verified marketplace",
    "housing Vietnam expats",
    "motorbike rental Saigon",
    "house rental Thao Dien",
    "moving sale Vietnam",
    "jobs Vietnam expats",
    "classifieds Vietnam",
  ],
  authors: [{ name: "eno.vn" }],
  openGraph: {
    title: "eno.vn - Verified Expat Marketplace in Vietnam",
    description:
      "A verified marketplace for expats and internationals in Vietnam. Housing, jobs, motorbikes, services and moving sales — every listing checked before it goes live.",
    siteName: "eno.vn",
    type: "website",
    images: [OG_IMAGE],
  },
  twitter: {
    card: "summary_large_image",
    title: "eno.vn - Verified Expat Marketplace in Vietnam",
    description: "Verified marketplace for expats in Vietnam — housing, jobs, motorbikes, services, moving sales.",
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
            in sync with ThemeProvider. */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem('eno-theme');if(t==='dark'||((!t||t==='system')&&matchMedia('(prefers-color-scheme: dark)').matches))document.documentElement.classList.add('dark');}catch(e){}})();`,
          }}
        />
        {/* Warm up TCP/TLS to the image origin so above-the-fold listing photos
            start downloading sooner. (Map origins — unpkg/cartocdn — are
            preconnected lazily by the map itself, which only mounts on demand.) */}
        <link rel="preconnect" href="https://xihiryllwmjoouipkyhw.supabase.co" crossOrigin="" />
        {/* Landing LCP element (hero wordmark) — preload at high priority so the
            preload scanner starts it before render, and keep it out of the HTML. */}
        <link rel="preload" as="image" href="/logo.svg" fetchPriority="high" />
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
                "eno.vn is a verified marketplace for expats and internationals in Vietnam — housing, jobs, motorbikes, services and moving sales.",
              sameAs: [
                "https://www.facebook.com/profile.php?id=61591370031264",
                "https://www.instagram.com/eno.vn/",
                "https://www.youtube.com/@enovietnam",
              ],
            }).replace(/</g, "\\u003c"),
          }}
        />
      </head>
      <body
        className={`${inter.variable} antialiased bg-background text-foreground pb-[calc(4rem+env(safe-area-inset-bottom))] lg:pb-0`}
      >
        <ThemeProvider>
          <LanguageProvider>
            <AuthProvider>
              <NotificationsProvider>
                <ChatProvider>
                  <FavoritesProvider>
                    <QueryProvider>
                      {children}
                      <MobileNav />
                      <CookieConsent />
                    </QueryProvider>
                  </FavoritesProvider>
                </ChatProvider>
              </NotificationsProvider>
            </AuthProvider>
          </LanguageProvider>
        </ThemeProvider>
        <SonnerToaster position="bottom-right" richColors closeButton />
        <AnalyticsTags />
        <SpeedInsights />
        <Analytics />
      </body>
    </html>
  );
}
