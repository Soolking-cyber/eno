import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { IS_SERVICES, SITE_NAME } from '@/lib/edition'
import { pageShare } from '@/lib/site-identity'
import { Header } from '@/components/marketplace/header'
import { Footer } from '@/components/marketplace/footer'
import { TEACHER_COST_INDEX_NAME, TEACHER_COST_INDEX_PATH, editionMonth, editionPath, teacherCostIndexBreadcrumb } from '@/lib/teacher-cost-index'
import { EDITIONS, ERRATA, editionById } from '@/lib/teacher-cost-index-editions'
import { TeacherCostIndexMain } from '../sections'

/**
 * /hcmc-teacher-cost-pay-index/YYYY-MM — one frozen edition, at an address that never changes, so a citation of it works
 * from the day it is published (d1-spec §6).
 *
 * ⛔ THE CANONICAL FOLLOWS WHETHER THE EDITION IS CURRENT (owner decision 4, 2026-10-21): the newest edition IS the
 * series page while it is newest, so its canonical is the series URL and only the series is in the sitemap; once a newer
 * edition is frozen it is superseded — self-canonical, indexable, in the sitemap (pages.xml/build.ts), with a line
 * pointing at the newest. ⚠️ The fallback if Google is slow to index superseded editions under this scheme is in
 * d1-spec §6: measure two editions after launch before changing it.
 * ⛔ NEVER `dynamicParams = false` HERE (measured 2026-10-21 on the production preview): behind proxy.ts's rewrite into
 * `[lang]`, the standalone server answered even the PRERENDERED /hcmc-teacher-cost-pay-index/2026-10 with a 404
 * ("NoFallbackError"), while the same flag works on /og/… which no rewrite reaches. So, as teach-in-vietnam/[slug]
 * does, the params are prerendered and dynamicParams stays true: an id that is not a frozen edition renders
 * notFound(), a real 404 BY STATUS — never a 200 shell (see [handle]/not-found-contract.test.ts on why that matters).
 * ⚠️ No loading.tsx in this segment, so notFound() is a real 404 (crawler-visible-html-contract.test.ts).
 */
export function generateStaticParams() {
  return EDITIONS.map((e) => ({ edition: e.edition }))
}

const ORIGIN = process.env.NEXT_PUBLIC_APP_URL || 'https://eno.vn'

type Props = { params: Promise<{ lang: string; edition: string }> }

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { edition } = await params
  const e = IS_SERVICES ? undefined : editionById(edition)
  if (!e) return { title: `Not found | ${SITE_NAME}`, robots: { index: false } }
  const month = editionMonth(e.edition)
  const title = `${TEACHER_COST_INDEX_NAME}, ${month} | ${SITE_NAME}`
  const description = `The ${month} edition: what Ho Chi Minh City apartment rents take from a full-time English teacher's modelled take-home pay, by district. Free to cite.`
  const canonical = e.edition === EDITIONS[0].edition ? TEACHER_COST_INDEX_PATH : editionPath(e.edition)
  return { title, description, alternates: { canonical }, ...pageShare({ title, description, url: canonical }) }
}

export default async function TeacherCostIndexEditionPage({ params }: Props) {
  if (IS_SERVICES) notFound()
  const { edition } = await params
  const e = editionById(edition)
  if (!e) notFound()
  const breadcrumb = teacherCostIndexBreadcrumb(ORIGIN, e.edition)
  return (
    <div className="flex min-h-page flex-col blob-bg">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumb).replace(/</g, '\\u003c') }} />
      <Header />
      <TeacherCostIndexMain e={e} editions={EDITIONS} errata={ERRATA} origin={ORIGIN} siteName={SITE_NAME} series={false} />
      <Footer />
    </div>
  )
}
