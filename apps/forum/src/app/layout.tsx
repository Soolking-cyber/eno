import type { Metadata, Viewport } from 'next'
import { Inter } from 'next/font/google'
import { ForumProviders } from '@/components/forum/forum-providers'
import { AppForumNav } from '@/components/forum/mobile-forum-nav'
import './globals.css'

const inter = Inter({
  variable: '--font-inter',
  subsets: ['latin', 'vietnamese'],
  display: 'swap',
})

const forumUrl = process.env.NEXT_PUBLIC_FORUM_URL || 'https://eno.forum'

export const viewport: Viewport = {
  colorScheme: 'light',
  themeColor: '#fafafa',
  viewportFit: 'cover',
  interactiveWidget: 'resizes-content',
}

export const metadata: Metadata = {
  metadataBase: new URL(forumUrl),
  title: {
    default: 'eno.forum — Vietnam, figured out together',
    template: '%s | eno.forum',
  },
  description: 'A practical community forum for expats and locals in Vietnam to share firsthand help about visas, housing, work, daily life, and meetups.',
  applicationName: 'eno.forum',
  // NO layout-level canonical: `alternates.canonical: '/'` here marked every
  // nested route as a duplicate of the home page. The home canonical lives in
  // app/page.tsx; /post/[id] sets its own.
  manifest: '/manifest.webmanifest',
  icons: {
    icon: [
      { url: '/favicon.ico', sizes: '48x48', type: 'image/x-icon' },
      { url: '/icon-192.png', sizes: '192x192', type: 'image/png' },
      { url: '/logo-mark.svg', sizes: 'any', type: 'image/svg+xml' },
    ],
    shortcut: '/favicon.ico',
    apple: { url: '/apple-touch-icon.png', sizes: '180x180', type: 'image/png' },
  },
  openGraph: {
    title: 'eno.forum — Vietnam, figured out together',
    description: 'Current, firsthand help from people who live in Vietnam.',
    siteName: 'eno.forum',
    type: 'website',
    url: '/',
  },
  twitter: {
    card: 'summary',
    title: 'eno.forum — Vietnam, figured out together',
    description: 'Current, firsthand help from people who live in Vietnam.',
  },
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* Native stamp ONLY — web theming stays exactly as ThemeProvider always did it.
            (An OS-dark pre-paint script here changed WEB behavior; reverted per review.) */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var u=navigator.userAgent;var C=window.Capacitor;var cap=!!(C&&C.isNativePlatform&&C.isNativePlatform());if(cap||u.indexOf('EnoNativeApp')>-1||window.EnoNative){var dc=document.documentElement.classList;dc.add('native');dc.add('native-'+(cap?(C.getPlatform&&C.getPlatform()==='android'?'android':'ios'):(window.EnoNative||/android/i.test(u)?'android':'ios')));}}catch(e){}})();`,
          }}
        />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify({
              '@context': 'https://schema.org',
              '@type': 'WebSite',
              name: 'eno.forum',
              url: `${forumUrl}/`,
              description: 'A practical community forum for expats and locals in Vietnam to share firsthand help about visas, housing, work, daily life, and meetups.',
              inLanguage: ['en', 'vi'],
            }).replace(/</g, '\\u003c'),
          }}
        />
      </head>
      <body className={`${inter.variable} bg-background font-sans text-foreground antialiased`}>
        <ForumProviders>
          {children}
          {/* App-mode only (renders nothing on the web): the shared bottom nav on every
              main surface, so forum/itinerary/visa feel like one app inside the shell. */}
          <AppForumNav />
        </ForumProviders>
      </body>
    </html>
  )
}
