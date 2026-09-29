import type { Metadata } from 'next'
import { SITE_NAME } from '@/lib/edition'

/**
 * /saved had no title of its own (E-TITLE, 2026-09-29): its page is a client component, so it cannot
 * export metadata, and the tab read the site-wide "eno.vn - Trusted Expat Marketplace in Vietnam" —
 * indistinguishable from the home page in a tab strip or the history list. This server layout exists
 * only to name it, in the language the HTML is rendered in (the `[lang]` segment, see src/proxy.ts).
 * Indexing is not decided here: /saved is noindex via X-Robots-Tag (next.config.ts headers()).
 */
export async function generateMetadata({ params }: { params: Promise<{ lang: string }> }): Promise<Metadata> {
  const { lang } = await params
  return { title: lang === 'vi' ? `Tin đã lưu | ${SITE_NAME}` : `Saved listings | ${SITE_NAME}` }
}

export default function SavedLayout({ children }: { children: React.ReactNode }) {
  return children
}
