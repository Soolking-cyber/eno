import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { Toaster as SonnerToaster } from "@/components/ui/sonner";
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

const OG_IMAGE = { url: "/listings/hero-market.png", width: 1344, height: 768, alt: "ENO — verified marketplace" };

// Light-first design: tell browsers not to auto-dark the UI (avoids Chrome
// mobile "Auto Dark Theme" producing a low-contrast rendering).
// theme-color matches the white header/nav (not the #fafafa canvas) so the iOS
// status-bar / toolbar area is seamless with the chrome, no two-tone seam.
// viewportFit:"cover" is the keystone for iOS: without it env(safe-area-inset-*)
// resolves to 0, so the safe-area padding the header/nav/body already declare is
// dead. With it, those insets activate (notch + home-indicator handled cleanly).
export const viewport: Viewport = {
  colorScheme: "light",
  themeColor: "#ffffff",
  viewportFit: "cover",
};

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_APP_URL || "https://www.eno.forum"),
  title: "ENO Forum - Verified Expat Marketplace in Vietnam",
  description:
    "ENO Forum is a verified marketplace for expats and internationals in Vietnam. Find housing, jobs, motorbikes, services, moving sales, and more — every listing is checked before it goes live.",
  applicationName: "ENO Forum",
  keywords: [
    "ENO Forum",
    "eno.forum",
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
  authors: [{ name: "ENO Forum" }],
  openGraph: {
    title: "ENO Forum - Verified Expat Marketplace in Vietnam",
    description:
      "A verified marketplace for expats and internationals in Vietnam. Housing, jobs, motorbikes, services and moving sales — every listing checked before it goes live.",
    siteName: "ENO Forum",
    type: "website",
    images: [OG_IMAGE],
  },
  twitter: {
    card: "summary_large_image",
    title: "ENO Forum - Verified Expat Marketplace in Vietnam",
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
        {/* Warm up TCP/TLS to the image origin so above-the-fold listing photos
            start downloading sooner. (Map origins — unpkg/cartocdn — are
            preconnected lazily by the map itself, which only mounts on demand.) */}
        <link rel="preconnect" href="https://xihiryllwmjoouipkyhw.supabase.co" crossOrigin="" />
        {/* Landing LCP element (hero wordmark) — preload at high priority so the
            preload scanner starts it before render, and keep it out of the HTML. */}
        <link rel="preload" as="image" href="/logo.svg" fetchPriority="high" />
        {/* Organization entity — ties the brand "ENO Forum" to its official social
            profiles (sameAs) so Google can recognise it as a distinct brand and
            attribute the eno.forum query to this site. */}
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify({
              "@context": "https://schema.org",
              "@type": "Organization",
              name: "ENO Forum",
              alternateName: ["ENO", "ENO.vn", "eno.forum"],
              url: "https://www.eno.forum",
              logo: "https://www.eno.forum/logo.svg",
              description:
                "ENO Forum is a verified marketplace for expats and internationals in Vietnam — housing, jobs, motorbikes, services and moving sales.",
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
        <SonnerToaster position="bottom-right" richColors closeButton />
        <AnalyticsTags />
        <SpeedInsights />
        <Analytics />
      </body>
    </html>
  );
}
