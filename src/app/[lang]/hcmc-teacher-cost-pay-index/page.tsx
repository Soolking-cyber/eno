import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { IS_SERVICES, SITE_NAME } from '@/lib/edition'
import { pageShare } from '@/lib/site-identity'
import { Header } from '@/components/marketplace/header'
import { Footer } from '@/components/marketplace/footer'
import { TEACHER_COST_INDEX_NAME, TEACHER_COST_INDEX_PATH, teacherCostIndexBreadcrumb, teacherCostIndexDataset } from '@/lib/teacher-cost-index'
import { EDITIONS, ERRATA } from '@/lib/teacher-cost-index-editions'
import { TeacherCostIndexMain } from './sections'

/**
 * /hcmc-teacher-cost-pay-index — the HCMC Teacher Cost & Pay Index, its newest edition (src/lib/teacher-cost-index.ts).
 * Every edition also has its own page (./[edition]); this one is the series: self-canonical, in the sitemap, and the only
 * page carrying the Dataset JSON-LD — one dataset for the series, never one per edition.
 *
 * ⛔ STATIC, FROM THE FROZEN FILES — NO DATABASE: the figures change only when a new edition is committed and deployed
 * (scripts/teacher-cost-index-freeze.ts, monthly), so the page renders at build and needs nothing at request time.
 * ⚠️ MARKETPLACE ONLY, LIKE THE RENT INDEX IT IS BUILT ON: the services build answers 404 here, for every edition and
 * for the CSV, and the sitemap submits none of it from eno.forum.
 * ⚠️ AN ENGLISH TITLE AND DESCRIPTION, UNLIKE THE RENT INDEX'S BILINGUAL ONES: no Vietnamese teacher-pay wording before
 * counsel (d1-spec §11). ≤ 60 / 160.
 */
const ORIGIN = process.env.NEXT_PUBLIC_APP_URL || 'https://eno.vn'
const TITLE = `${TEACHER_COST_INDEX_NAME}: rent vs take-home | ${SITE_NAME}`
const DESCRIPTION =
  "Monthly: what Ho Chi Minh City apartment rents take from a full-time English teacher's modelled take-home pay, by district. Free to cite."

// The services build answers 404 here, and says so in its metadata too, as the edition pages do (opus, gate review).
export function generateMetadata(): Metadata {
  if (IS_SERVICES) return { title: `Not found | ${SITE_NAME}`, robots: { index: false } }
  return {
    title: TITLE,
    description: DESCRIPTION,
    alternates: { canonical: TEACHER_COST_INDEX_PATH },
    ...pageShare({ title: TITLE, description: DESCRIPTION, url: TEACHER_COST_INDEX_PATH }),
  }
}

// The same English on both language variants (sections.tsx), so the page does not read the `[lang]` it is rendered under.
export default function TeacherCostIndexPage() {
  if (IS_SERVICES) notFound()
  const latest = EDITIONS[0]
  if (!latest) notFound()
  const jsonLd = [teacherCostIndexBreadcrumb(ORIGIN), teacherCostIndexDataset(EDITIONS, { origin: ORIGIN, name: SITE_NAME }, ERRATA)]
  return (
    <div className="flex min-h-page flex-col blob-bg">
      {jsonLd.map((node, i) => (
        <script key={i} type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(node).replace(/</g, '\\u003c') }} />
      ))}
      <Header />
      <TeacherCostIndexMain e={latest} editions={EDITIONS} errata={ERRATA} origin={ORIGIN} siteName={SITE_NAME} series />
      <Footer />
    </div>
  )
}
