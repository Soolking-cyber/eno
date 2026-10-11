import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { SITE_NAME } from '@/lib/edition'
import { pageShare } from '@/lib/site-identity'
import { SeoArticle, type ArticleContent } from '@/components/marketplace/seo-article'
import { TeachKeyPoints, TeachNextStep, teachGuideSections } from '@/components/marketplace/teach-guide-body'
import { guideEntry, isLive, isLiveTeachHref, releasedGuides, TEACH_BASE, teachGuideDates, teachPath } from '@/lib/teach-guides/registry'
import { teachGuideContent } from '@/lib/teach-guides/content'
import { requestNow } from '@/lib/teach-guides/request-clock'
import { HOME_RENTAL_SUBCATS } from '@/lib/rental-homes'

/**
 * ONE ROUTE FOR THE WHOLE TEACH-IN-VIETNAM LIBRARY — the guides are data (src/content/teach-in-vietnam,
 * schema.ts), rendered through the house article (SeoArticle) so they share its date line, contents
 * list, Keep reading, FAQ block and Article/FAQPage JSON-LD with every other guide on the site.
 *
 * ⚠️ RELEASED IN WAVES (registry.ts `published`): a guide before its date is a 404, exactly like a slug
 * that does not exist — no "coming soon" page, which would be a thin URL. `generateStaticParams`
 * prerenders the guides live at build time; later waves render on demand the first time they are asked
 * for after their date and are then cached like the rest (dynamicParams stays true for that).
 * ⚠️ No loading.tsx in this segment, so notFound() is a real 404 (see c/[category]/(index)/page.tsx).
 */
export const revalidate = 3600

export function generateStaticParams() {
  return releasedGuides().map((e) => ({ slug: e.slug }))
}

type Props = { params: Promise<{ lang: string; slug: string }> }

function load(slug: string, now: Date) {
  const entry = guideEntry(slug)
  const guide = teachGuideContent(slug)
  return entry && guide && isLive(entry, now) ? { entry, guide } : null
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params
  const hit = load(slug, requestNow())
  if (!hit) return { title: `Not found | ${SITE_NAME}`, robots: { index: false } }
  const title = `${hit.guide.title} | ${SITE_NAME}`
  const path = teachPath(slug)
  return {
    title,
    description: hit.guide.description,
    alternates: { canonical: path },
    ...pageShare({ title, description: hit.guide.description, url: path, type: 'article' }),
  }
}

export default async function TeachGuidePage({ params }: Props) {
  const { slug } = await params
  // ONE clock for the whole render: release gate, in-text links and Keep reading agree on what is live.
  const now = requestNow()
  const hit = load(slug, now)
  if (!hit) notFound()
  const { entry, guide } = hit
  const isLiveHref = (href: string) => isLiveTeachHref(href, now)

  const related = guide.related
    .map((s) => guideEntry(s))
    .filter((e): e is NonNullable<typeof e> => !!e && isLive(e, now))
    .map((e) => ({ href: teachPath(e.slug), label: e.label, blurb: e.blurb }))

  const content: ArticleContent = {
    eyebrow: guide.eyebrow,
    h1: guide.h1,
    intro: guide.intro,
    canonical: teachPath(slug),
    lang: 'en',
    ...teachGuideDates(slug),
    breadcrumb: [
      { label: 'Home', href: '/' },
      { label: 'Teach in Vietnam', href: TEACH_BASE },
      { label: entry.label, href: teachPath(slug) },
    ],
    ledeRow: <TeachKeyPoints g={guide} isLiveHref={isLiveHref} />,
    sections: teachGuideSections(guide, isLiveHref),
    afterSections: <TeachNextStep />,
    // The inventory the guide has just explained how to use (SeoArticle `rail`): it renders only with at
    // least four live listings, so a thin shelf leaves the guide ending as it would anyway.
    ...(entry.rail === 'jobs'
      ? { rail: { target: { categorySlug: 'jobs', subcategoryIn: ['teaching'], order: 'recent' as const }, title: 'Teaching jobs now', cta: 'Browse jobs' } }
      : entry.rail === 'homes'
        ? { rail: { target: { categorySlug: 'rentals', subcategoryIn: HOME_RENTAL_SUBCATS }, title: 'Homes for rent now', cta: 'Browse rentals' } }
        : {}),
    related,
    faqs: guide.faqs,
  }
  return <SeoArticle content={content} />
}
