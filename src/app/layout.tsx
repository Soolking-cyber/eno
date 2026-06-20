import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { Toaster as SonnerToaster } from "@/components/ui/sonner";
import { LanguageProvider } from "@/context/language-context";
import { AuthProvider } from "@/context/auth-context";
import { ChatProvider } from "@/context/chat-context";
import { FavoritesProvider } from "@/context/favorites-context";
import { QueryProvider } from "@/components/marketplace/query-provider";
import { MobileNav } from "@/components/marketplace/mobile-nav";
import { ChatWidget } from "@/components/marketplace/chat-widget";
import { SpeedInsights } from "@vercel/speed-insights/next";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin", "vietnamese"],
  display: "swap",
});

const OG_IMAGE = { url: "/listings/hero-market.png", width: 1344, height: 768, alt: "ENO — verified marketplace" };

// Light-first design: tell browsers not to auto-dark the UI (avoids Chrome
// mobile "Auto Dark Theme" producing a low-contrast rendering).
export const viewport: Viewport = {
  colorScheme: "light",
  themeColor: "#fafafa",
};

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_APP_URL || "https://eno.vn"),
  title: "ENO — Your Trusted Vietnam Network.",
  description:
    "The verified classifieds marketplace for Vietnamese expats. Moving sales, motorbike & house rentals, jobs and more — every listing is checked before it goes live. No fakes, no bait prices, no wasted trips.",
  keywords: [
    "Vietnam expats",
    "Viet Kieu",
    "verified marketplace",
    "motorbike rental Saigon",
    "house rental Thao Dien",
    "moving sale Vietnam",
    "ENO",
    "classifieds Vietnam",
  ],
  authors: [{ name: "ENO" }],
  openGraph: {
    title: "ENO — Your Trusted Vietnam Network.",
    description:
      "Every listing verified before it goes live. No fakes, no bait prices, no wasted trips.",
    siteName: "ENO",
    type: "website",
    images: [OG_IMAGE],
  },
  twitter: {
    card: "summary_large_image",
    title: "ENO — Your Trusted Vietnam Network.",
    description: "Every listing verified. No fakes, no bait prices.",
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
        {/* Warm up TCP/TLS to the image + map origins so listing photos and map
            tiles start downloading sooner (hides latency for free). */}
        <link rel="preconnect" href="https://xihiryllwmjoouipkyhw.supabase.co" crossOrigin="" />
        <link rel="preconnect" href="https://unpkg.com" crossOrigin="" />
        <link rel="preconnect" href="https://basemaps.cartocdn.com" crossOrigin="" />
      </head>
      <body
        className={`${inter.variable} antialiased bg-background text-foreground pb-[calc(4rem+env(safe-area-inset-bottom))] lg:pb-0`}
      >
        <LanguageProvider>
          <AuthProvider>
            <ChatProvider>
              <FavoritesProvider>
                <QueryProvider>
                  {children}
                  <MobileNav />
                  <ChatWidget />
                </QueryProvider>
              </FavoritesProvider>
            </ChatProvider>
          </AuthProvider>
        </LanguageProvider>
        <SonnerToaster position="bottom-right" richColors closeButton />
        <SpeedInsights />
      </body>
    </html>
  );
}
