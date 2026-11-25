import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { IS_SERVICES, SITE_NAME } from '@/lib/edition'
import { guideContent } from '@/lib/guides/content'
import { GUIDE_BASE, guideBlurb, guideDates, guideEntry, guideLabel, guidePath, isGuideLive, liveGuides } from '@/lib/guides/registry'
import { pageShare, withinResult } from '@/lib/site-identity'
import { guideEntry as teachEntry, isLive as teachLive, isLiveTeachHref, teachPath } from '@/lib/teach-guides/registry'
import { requestNow } from '@/lib/teach-guides/request-clock'
import { TEACH_ROBOTS } from '@/lib/teach-guides/robots'
import Link from 'next/link'
import { ChevronRight } from '@/components/ui/icons'
import { Rows, Row } from '@/components/ui/rows'
import { HereLink, P, SeoArticle, type ArticleContent, type ArticleSection } from './seo-article'
import { GuideFigure, TeachKeyPoints, teachGuideSections } from './teach-guide-body'
import { guideImageSrc, readingMinutes, storedSize } from '@/lib/guides/guide-images'
import { titleWithSite } from '@/lib/meta-description'
import { RENT_TOOLS, RENT_TOOL_SLUGS, rentToolPath } from '@/lib/rent-tools/registry'
import { localizedHref } from '@/lib/lang-pinned'

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
    path: GUIDE_BASE.en, crumb: 'Guides', listTitle: 'All guides', toolsTitle: 'Tools', allTools: 'All tools', howTitle: 'How these are made', other: 'Hướng dẫn bằng tiếng Việt',
    title: 'Guides to living and doing business in Vietnam',
    // The H1's "doing business" in the text (Seobility crawl 9); within 155 characters.
    description: 'Practical guides from eno.vn on renting, hiring, selling and doing business in Vietnam, checked against their sources and approved by the eno.vn team.',
    how: 'Each guide is drafted with AI from pages it cites, its key facts are checked against those pages, and a person on the eno.vn team reads and approves it before it goes live. Every guide lists its sources, the day they were last checked and the day it was approved; a guide changed after that is approved again.',
  },
  vi: {
    path: GUIDE_BASE.vi, crumb: 'Hướng dẫn', listTitle: 'Tất cả bài hướng dẫn', toolsTitle: 'Công cụ', allTools: 'Tất cả công cụ', howTitle: 'Cách các bài này được viết', other: 'Guides in English',
    title: 'Hướng dẫn về cuộc sống và kinh doanh ở Việt Nam',
    description: 'Hướng dẫn thực tế từ eno.vn về thuê nhà, đi lại, tuyển dụng và bán hàng ở Việt Nam, được kiểm tra với nguồn và do đội ngũ eno.vn duyệt trước khi đăng.',
    how: 'Mỗi bài được AI soạn từ các trang mà bài trích dẫn, các thông tin chính được đối chiếu với chính các trang đó, rồi một người trong đội ngũ eno.vn đọc và duyệt trước khi đăng. Mỗi bài đều ghi nguồn, ngày kiểm tra nguồn gần nhất và ngày được duyệt; bài sửa sau đó phải được duyệt lại.',
  },
} as const

const hubGuides = (lang: Lang, now: Date) => (IS_SERVICES ? [] : liveGuides(now).filter((e) => e.lang === lang))

export function libraryHubMetadata(lang: Lang): Metadata {
  if (!hubGuides(lang, requestNow()).length) return { title: `Not found | ${SITE_NAME}`, robots: { index: false } }
  const hub = HUB[lang]
  const title = titleWithSite(hub.title, SITE_NAME)
  return { title, description: hub.description, alternates: { canonical: hub.path }, robots: TEACH_ROBOTS, ...pageShare({ title, description: hub.description, url: hub.path, type: 'website' }) }
}

/**
 * The hub's Tools section: the rent tools (src/lib/rent-tools/registry.ts), in the hub's language and at its address, in
 * the same row shape as the guides. MARKETPLACE ONLY, like the tool pages themselves (they 404 on the services build), so
 * eno.forum gets no section and no link to a 404 — an empty list, spread into the sections.
 */
export function rentToolsHubSection(lang: Lang): ArticleSection[] {
  if (IS_SERVICES) return []
  return [
    {
      id: 'tools',
      title: HUB[lang].toolsTitle,
      body: (
        <Rows bordered className="max-w-[60ch]">
          {RENT_TOOL_SLUGS.map((s) => (
            <TitleRow key={s} href={rentToolPath(s, lang)} label={RENT_TOOLS[s].label[lang]} blurb={RENT_TOOLS[s].blurb[lang]} />
          ))}
          {/* Then the hub of every tool, the ones eno Reach writes included (/tools). */}
          <Row className="py-0">
            <Link href={localizedHref('/tools', lang)} className="group grid grid-cols-[minmax(0,1fr)_1rem] items-center gap-x-3 py-4">
              <span className="block min-w-0 text-lg font-bold leading-snug text-foreground group-hover:text-accent-foreground">{HUB[lang].allTools}</span>
              <ChevronRight className="size-4 text-ink-4 group-hover:text-accent-foreground" aria-hidden />
            </Link>
          </Row>
        </Rows>
      ),
    },
  ]
}

/**
 * A hub row: the title on a line, what it answers under it, a hairline between, the whole row the click.
 * ⛔ THE LINK IS THE TITLE, STRETCHED OVER THE ROW by its ::after (seo-article.tsx's "Keep reading", the same reason): the
 * whole row as one <a> made its anchor text the title AND the blurb, 200–240 characters (Seobility crawl 5, "anchor text
 * too long", every guide /guides and /huong-dan list). The row still takes the click, the hover and the focus ring.
 */
function TitleRow({ href, label, blurb }: { href: string; label: string; blurb: string }) {
  return (
    <Row className="py-0">
      <div className="group relative grid grid-cols-[minmax(0,1fr)_1rem] items-center gap-x-3 py-4">
        <span className="min-w-0">
          <span className="block text-lg font-bold leading-snug text-foreground group-hover:text-accent-foreground">
            <Link href={href} className="outline-none after:absolute after:inset-0 focus-visible:after:ring-2 focus-visible:after:ring-ring">{label}</Link>
          </span>
          <span className="mt-1 block text-base leading-relaxed text-body">{blurb}</span>
        </span>
        <ChevronRight className="size-4 text-ink-4 group-hover:text-accent-foreground" aria-hidden />
      </div>
    </Row>
  )
}

export function LibraryHub({ lang }: { lang: Lang }) {
  const now = requestNow()
  const guides = hubGuides(lang, now)
  if (!guides.length) notFound()
  const hub = HUB[lang]
  const otherLang: Lang = lang === 'en' ? 'vi' : 'en'
  // 2026-11-06 audit: each guide is a row of its own, the shape of SeoArticle's "Keep reading" rows: its title on a line,
  // what it answers under it, a hairline between, the whole row the link. It was a bullet that ran title and blurb into
  // one sentence. The other language's guides close the list they extend, so "How these are made" is only that.
  const sections: ArticleSection[] = [
    {
      id: 'all',
      title: hub.listTitle,
      body: (
        <>
          <Rows bordered className="max-w-[60ch]">
            {guides.map((e) => (
              <TitleRow key={e.slug} href={guidePath(e)} label={guideLabel(e)} blurb={guideBlurb(e)} />
            ))}
          </Rows>
          {hubGuides(otherLang, now).length > 0 && <P><HereLink href={HUB[otherLang].path}>{hub.other}</HereLink></P>}
        </>
      ),
    },
    ...rentToolsHubSection(lang),
    { id: 'how', title: hub.howTitle, body: <P>{hub.how}</P> },
  ]
  const dates = guides.map((e) => guideDates(e).published).sort()
  const content: ArticleContent = {
    eyebrow: hub.crumb, h1: hub.title, intro: hub.description, canonical: hub.path, lang, published: dates[0], updated: dates[dates.length - 1],
    // A list of guides, not a guide: no byline (each guide carries its own).
    byline: false,
    // The site's name, not "Home" (NAV-10; Seobility crawl 5: "Home" also names the furniture category's tile).
    breadcrumb: [{ label: SITE_NAME, href: '/' }, { label: hub.crumb, href: hub.path }],
    sections, faqs: [],
  }
  return <SeoArticle content={content} />
}

export function libraryGuideMetadata(slug: string, lang: Lang): Metadata {
  const hit = load(slug, lang, requestNow())
  if (!hit) return { title: `Not found | ${SITE_NAME}`, robots: { index: false } }
  // Within a result, the site named once (site-identity.ts withinResult; Seobility crawl 3: 24 guide titles over 580 px,
  // 12 descriptions over 1,000 px).
  const { title, description } = withinResult(`${hit.guide.title} | ${SITE_NAME}`, hit.guide.description)
  const path = guidePath(hit.entry)
  const pair = hit.entry.pair ? guideEntry(hit.entry.pair) : null
  return {
    title,
    description,
    alternates: { canonical: path, ...(pair && isGuideLive(pair, requestNow()) ? { languages: { [pair.lang]: guidePath(pair), [lang]: path } } : {}) },
    robots: TEACH_ROBOTS,
    ...pageShare({ title, description, url: path, type: 'article', ...heroShare(hit.guide) }),
    // Which approved text this page is showing: eno Reach reads it to say "On eno.vn", because a rewritten guide's address answers with the old words until the deploy.
    ...(hit.entry.reviewedDigest ? { other: { 'eno-guide-digest': hit.entry.reviewedDigest } } : {}),
  }
}

/** The hero's public address — the share card and the Article JSON-LD image when a guide has one. */
function heroSrc(g: { images?: { hero?: { id: string } } }): string | null {
  return g.images?.hero ? guideImageSrc(g.images.hero.id) : null
}
function heroShare(g: { images?: { hero?: { id: string; w: number; h: number; alt: string } } }) {
  const src = heroSrc(g)
  const hero = g.images?.hero
  // The size of the file at that address (the carry stores at most 1600 px wide), not the size Codex drew.
  return src && hero ? { images: [{ url: src, width: storedSize(hero).w, height: storedSize(hero).h, alt: hero.alt }] } : {}
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
      { label: SITE_NAME, href: '/' },
      { label: HUB[lang].crumb, href: HUB[lang].path },
      { label: guide.h1, href: guidePath(entry) },
    ],
    ledeRow: (
      <>
        <TeachKeyPoints g={guide} isLiveHref={liveHref} lang={lang} />
        {guide.images?.hero ? <GuideFigure pic={guide.images.hero} lang={lang} priority /> : null}
      </>
    ),
    sections: teachGuideSections(guide, liveHref, lang, { outline: true, figures: true }),
    readingMinutes: readingMinutes(guide, lang),
    // The approval on record (registry `reviewed`, digest-checked in src/lib/guides/content.ts), linked to the hub's "How these are made".
    // Never older than the page's own "Updated" date: an approval from before the last change would not be an approval of this text.
    ...(entry.reviewed && entry.reviewed >= (guideDates(entry).updated ?? '') ? { approved: { on: entry.reviewed, how: `${HUB[lang].path}#how` } } : {}),
    citations: guide.sources.map((src) => ({ name: src.title, url: src.url })),
    ...(heroSrc(guide) ? { image: [heroSrc(guide)!] } : {}),
    faqs: guide.faqs,
    related: guide.related.flatMap((s) => relatedLink(s, now)),
  }
  return <SeoArticle content={content} />
}
