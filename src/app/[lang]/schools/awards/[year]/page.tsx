import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { cache } from 'react'
import { pageShare } from '@/lib/site-identity'
import { SITE_NAME } from '@/lib/edition'
import { Bilingual } from '@/components/marketplace/bilingual'
import { Header } from '@/components/marketplace/header'
import { Footer } from '@/components/marketplace/footer'
import { AwardsResults } from '@/components/schools/awards-results'
import { awardsPage } from '@/lib/schools/awards'
import { AWARD_FIRST_YEAR, AWARDS_PATH } from '@/lib/schools/constants'
import { currentAwardYear } from '@/lib/schools/award-rank'

/**
 * /schools/awards/[year] — Teachers' Choice (owner, 2026-10-05). The frozen results once a year is closed; while it
 * is open, who qualifies so far — by name, alphabetically, never a running score (src/lib/schools/awards.ts).
 * ⚠️ ISR, hourly: the open page's qualifier list moves slowly, and closing a year purges this path.
 * ⚠️ No loading.tsx in this segment, so notFound() is a real 404.
 */
export const revalidate = 3600
export async function generateStaticParams() {
  return []
}

type Props = { params: Promise<{ lang: string; year: string }> }

const load = cache(async (raw: string) => (/^\d{4}$/.test(raw) ? awardsPage(Number(raw)) : null))

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { year } = await params
  const page = await load(year)
  if (!page) return { title: `Not found | ${SITE_NAME}`, robots: { index: false } }
  const title = `Teachers' Choice ${page.year}: where teachers recommend working in Saigon | ${SITE_NAME}`
  const description = page.state === 'final'
    ? `The schools, English centres and recruiters in Ho Chi Minh City that identity-verified teachers recommended in ${page.year}, with the votes and reviews behind each.`
    : page.state === 'open'
      ? `Teachers' Choice ${page.year}: vote for the schools and centres in Ho Chi Minh City you worked at. Results in early January ${page.year + 1}.`
      : `Teachers' Choice ${page.year}: voting has closed and the results are being counted.`
  const path = `${AWARDS_PATH}/${page.year}`
  // Indexed once the year is closed (diff review: the open page is a thin list of names); followed either way.
  return { title, description, alternates: { canonical: path }, ...(page.state === 'final' ? {} : { robots: { index: false, follow: true } }), ...pageShare({ title, description, url: path }) }
}

export default async function SchoolAwardsYear({ params }: Props) {
  const { lang, year } = await params
  const page = await load(year)
  if (!page) notFound()
  // Every OTHER year, newer ones included (diff review: a past year's page must not dead-end).
  const years = Array.from({ length: currentAwardYear() - AWARD_FIRST_YEAR + 1 }, (_, i) => AWARD_FIRST_YEAR + i).filter((y) => y !== page.year)
  return (
    <div className="flex min-h-screen flex-col">
      <Header />
      <main id="main" tabIndex={-1} className="mx-auto w-full max-w-7xl flex-1 px-3 pb-16 pt-8 sm:px-6 lg:px-8">
        <Link href="/schools" className="text-sm font-semibold text-accent-foreground hover:underline">
          <Bilingual en="← All schools" vi="← Tất cả trường" />
        </Link>
        <AwardsResults page={page} lang={lang} />
        {years.length > 0 && (
          <p className="mt-10 flex flex-wrap gap-x-4 gap-y-1 text-sm">
            <span className="text-muted-foreground"><Bilingual en="Other years:" vi="Các năm khác:" /></span>
            {years.map((y) => <Link key={y} href={`${AWARDS_PATH}/${y}`} className="font-semibold text-accent-foreground hover:underline">{y}</Link>)}
          </p>
        )}
      </main>
      <Footer />
    </div>
  )
}
