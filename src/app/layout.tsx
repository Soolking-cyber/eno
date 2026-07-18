import type { Metadata, Viewport } from 'next'
import { Inter } from 'next/font/google'
import { ForumProviders } from '@/components/forum/forum-providers'
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
  alternates: { canonical: '/' },
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
    <html lang="en">
      <body className={`${inter.variable} bg-background font-sans text-foreground antialiased`}>
        <ForumProviders>{children}</ForumProviders>
      </body>
    </html>
  )
}
