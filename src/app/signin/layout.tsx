import { SITE_NAME } from '@/lib/edition'
import type { Metadata } from 'next'
import type { ReactNode } from 'react'

// The page itself is a client component and can't export metadata. robots.txt only
// blocks CRAWLING — without an explicit noindex Google can still list /signin as a
// URL-only result once the sitewide prelaunch noindex header is gone.
export const metadata: Metadata = {
  title: `Sign in | ${SITE_NAME}`,
  robots: { index: false, follow: false },
}

export default function SignInLayout({ children }: { children: ReactNode }) {
  return children
}
