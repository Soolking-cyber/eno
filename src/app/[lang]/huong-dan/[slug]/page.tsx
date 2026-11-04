import type { Metadata } from 'next'
import { LibraryGuide, libraryGuideMetadata } from '@/components/marketplace/library-guide'
import { liveGuides } from '@/lib/guides/registry'

/**
 * The general guide library's vi pages (src/lib/guides). Later guides render on demand on the first request after their date, then are cached like the rest.
 * ⚠️ No loading.tsx in this segment, so notFound() is a real 404.
 */
export const revalidate = 3600

export function generateStaticParams() {
  return liveGuides().filter((e) => e.lang === 'vi').map((e) => ({ slug: e.slug }))
}

type Props = { params: Promise<{ lang: string; slug: string }> }

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  return libraryGuideMetadata((await params).slug, 'vi')
}

export default async function Page({ params }: Props) {
  return <LibraryGuide slug={(await params).slug} lang="vi" />
}
