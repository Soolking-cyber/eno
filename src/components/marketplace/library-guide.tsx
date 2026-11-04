import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { IS_SERVICES, SITE_NAME } from '@/lib/edition'
import { guideContent } from '@/lib/guides/content'
import { GUIDE_BASE, guideBlurb, guideDates, guideEntry, guideLabel, guidePath, isGuideLive, liveGuides } from '@/lib/guides/registry'
import { pageShare } from '@/lib/site-identity'
import { guideEntry as teachEntry, isLive as teachLive, isLiveTeachHref, teachPath } from '@/lib/teach-guides/registry'
import { requestNow } from '@/lib/teach-guides/request-clock'
import { TEACH_ROBOTS } from '@/lib/teach-guides/robots'
import { HereLink, P, SeoArticle, Ul, type ArticleContent, type ArticleSection } from './seo-article'
import { TeachKeyPoints, teachGuideSections } from './teach-guide-body'

/**
 * One page for a guide in the general library (src/lib/guides), at /guides/<slug> in English and /huong-dan/<slug> in Vietnamese. A slug asked for at the other language's address is a 404, so
 * each article has one URL. An unreleased guide is a 404 too, exactly like a slug that does not exist.
 */
type Lang = 'en' | 'vi'

/** A link to a library guide is live when that guide is, at its own language's address. Anything else is the Teach in Vietnam library's call. */
function isLiveHref(href: string, now: Date): boolean {
  const path = href.split(/[?#]/)[0]
  for (const lang of ['en', 'vi'] as const) {
    if (path === GUIDE_BASE[lang]) return liveGuides(now).some((e) => e.lang === lang)
    if (!path.startsWith(`${GUIDE_BASE[lang]}/`)) continue
    const e = guideEntry(path.slice(GUIDE_BASE[lang].length + 1))
    return !!e && e.lang === lang && isGuideLive(e, now)
  }
  return isLiveTeachHref(href, now)
}

/** A related slug is this library's first, then the teach library's. One that is not live is left out. */
function relatedLink(slug: string, now: Date) {
  const own = guideEntry(slug)
  if (own) return isGuideLive(own, now) ? [{ href: guidePath(own), label: guideLabel(own), blurb: guideBlurb(own) }] : []
  const teach = teachEntry(slug)
  return teach && teachLive(teach, now) ? [{ href: teachPath(teach.slug), label: teach.label, blurb: teach.blurb }] : []
}

function load(slug: string, lang: Lang, now: Date) {
  if (IS_SERVICES) return null
  const entry = guideEntry(slug)
  if (!entry || entry.lang !== lang || !isGuideLive(entry, now)) return null
  const guide = guideContent(slug)
  return guide ? { entry, guide } : null
}

/** Each language's list of its guides, in its own words, so no guide is reachable from the sitemap alone. A 404 until that language has one: an empty hub is a thin URL. */
const HUB = {
  en: {
    path: GUIDE_BASE.en, crumb: 'Guides', home: 'Home', listTitle: 'All guides', howTitle: 'How these are made', other: 'Hướng dẫn bằng tiếng Việt',
    title: 'Guides to living and doing business in Vietnam',
    description: 'Practical guides from eno.vn on renting, getting around, hiring and selling in Vietnam, checked against their sources and approved by the eno.vn team.',
    how: 'Each guide is drafted with AI from pages it cites, then read and approved by a person on the eno.vn team before it goes live. Every guide lists its sources and the day they were last checked.',
  },
  vi: {
    path: GUIDE_BASE.vi, crumb: 'Hướng dẫn', home: 'Trang chủ', listTitle: 'Tất cả bài hướng dẫn', howTitle: 'Cách các bài này được viết', other: 'Guides in English',
    title: 'Hướng dẫn về cuộc sống và kinh doanh ở Việt Nam',
    description: 'Hướng dẫn thực tế từ eno.vn về thuê nhà, đi lại, tuyển dụng và bán hàng ở Việt Nam, được kiểm tra với nguồn và do đội ngũ eno.vn duyệt trước khi đăng.',
    how: 'Mỗi bài được AI soạn từ các trang mà bài trích dẫn, sau đó một người trong đội ngũ eno.vn đọc và duyệt trước khi đăng. Mỗi bài đều ghi nguồn và ngày kiểm tra gần nhất.',
  },
} as const

const hubGuides = (lang: Lang, now: Date) => (IS_SERVICES ? [] : liveGuides(now).filter((e) => e.lang === lang))

export function libraryHubMetadata(lang: Lang): Metadata {
  if (!hubGuides(lang, requestNow()).length) return { title: `Not found | ${SITE_NAME}`, robots: { index: false } }
  const hub = HUB[lang]
  const title = `${hub.title} | ${SITE_NAME}`
  return { title, description: hub.description, alternates: { canonical: hub.path }, robots: TEACH_ROBOTS, ...pageShare({ title, description: hub.description, url: hub.path, type: 'website' }) }
}

export function LibraryHub({ lang }: { lang: Lang }) {
  const now = requestNow()
  const guides = hubGuides(lang, now)
  if (!guides.length) notFound()
  const hub = HUB[lang]
  const otherLang: Lang = lang === 'en' ? 'vi' : 'en'
  const sections: ArticleSection[] = [
    { id: 'all', title: hub.listTitle, body: <Ul>{guides.map((e) => <li key={e.slug}><HereLink href={guidePath(e)}>{guideLabel(e)}</HereLink>: {guideBlurb(e)}</li>)}</Ul> },
    { id: 'how', title: hub.howTitle, body: <><P>{hub.how}</P>{hubGuides(otherLang, now).length > 0 && <P><HereLink href={HUB[otherLang].path}>{hub.other}</HereLink></P>}</> },
  ]
  const dates = guides.map((e) => guideDates(e).published).sort()
  const content: ArticleContent = {
    eyebrow: hub.crumb, h1: hub.title, intro: hub.description, canonical: hub.path, lang, published: dates[0], updated: dates[dates.length - 1],
    breadcrumb: [{ label: hub.home, href: '/' }, { label: hub.crumb, href: hub.path }],
    sections, faqs: [],
  }
  return <SeoArticle content={content} />
}

export function libraryGuideMetadata(slug: string, lang: Lang): Metadata {
  const hit = load(slug, lang, requestNow())
  if (!hit) return { title: `Not found | ${SITE_NAME}`, robots: { index: false } }
  const title = `${hit.guide.title} | ${SITE_NAME}`
  const path = guidePath(hit.entry)
  const pair = hit.entry.pair ? guideEntry(hit.entry.pair) : null
  return {
    title,
    description: hit.guide.description,
    alternates: { canonical: path, ...(pair && isGuideLive(pair, requestNow()) ? { languages: { [pair.lang]: guidePath(pair), [lang]: path } } : {}) },
    robots: TEACH_ROBOTS,
    ...pageShare({ title, description: hit.guide.description, url: path, type: 'article' }),
  }
}

export function LibraryGuide({ slug, lang }: { slug: string; lang: Lang }) {
  const now = requestNow()
  const hit = load(slug, lang, now)
  if (!hit) notFound()
  const { entry, guide } = hit
  const liveHref = (href: string) => isLiveHref(href, now)
  const pair = entry.pair ? guideEntry(entry.pair) : null
  const content: ArticleContent = {
    eyebrow: guide.eyebrow,
    h1: guide.h1,
    intro: guide.intro,
    canonical: guidePath(entry),
    lang,
    ...guideDates(entry),
    ...(pair && isGuideLive(pair, now) ? { alternate: { lang: pair.lang, href: guidePath(pair) } } : {}),
    breadcrumb: [
      { label: lang === 'vi' ? 'Trang chủ' : 'Home', href: '/' },
      { label: HUB[lang].crumb, href: HUB[lang].path },
      { label: guide.h1, href: guidePath(entry) },
    ],
    ledeRow: <TeachKeyPoints g={guide} isLiveHref={liveHref} lang={lang} />,
    sections: teachGuideSections(guide, liveHref, lang),
    faqs: guide.faqs,
    related: guide.related.flatMap((s) => relatedLink(s, now)),
  }
  return <SeoArticle content={content} />
}
