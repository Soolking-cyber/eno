import { SITE_NAME } from '@/lib/edition'
import type { Metadata } from 'next'
import type { ReactNode } from 'react'

// The page itself is a client component and can't export metadata. robots.txt only
// blocks CRAWLING — without an explicit noindex Google can still list /signin as a
// URL-only result once the sitewide prelaunch noindex header is gone.
// The <title> follows the `[lang]` variant the proxy served (B5-HELP-VI, as /safety does); the noindex
// is the same on both.
export async function generateMetadata({ params }: { params: Promise<{ lang: string }> }): Promise<Metadata> {
  const { lang } = await params
  return {
    title: lang === 'vi' ? `Đăng nhập | ${SITE_NAME}` : `Sign in | ${SITE_NAME}`,
    robots: { index: false, follow: false },
  }
}

export default function SignInLayout({ children }: { children: ReactNode }) {
  return children
}
