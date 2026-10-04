import { SITE_NAME } from '@/lib/edition'
import type { Metadata } from 'next'
import { cookies, headers } from 'next/headers'
import { withShare } from '@/lib/site-identity'
import { Header } from '@/components/marketplace/header'
import { Footer } from '@/components/marketplace/footer'
import { HelpCenter, type HelpI18n } from '@/components/marketplace/help-center'
import { loadHelpCenter } from '@/lib/help-center-data'
import { cachedTranslations } from '@/lib/translate'
import { LANG_COOKIE } from '@/lib/lang-variant'
import { embedLanguages, pickEmbedded, readerLanguage } from './[id]/embed-languages'

// Both link-preview cards come from withShare() and stay ENGLISH on both variants: a share scraper
// sends no language, so the card must not depend on which variant it happened to hit.
const METADATA: Metadata = withShare({
  title: `Help center | ${SITE_NAME}`,
  description: 'Answers about buying, selling, trust, messaging, offers and safe trading on eno.vn — plus practical guides for travelling in Vietnam.',
  alternates: { canonical: '/help' },
})

// The <title> follows the `[lang]` variant the proxy served (B5-HELP-VI, as /safety and /help/[id] do).
export async function generateMetadata({ params }: { params: Promise<{ lang: string }> }): Promise<Metadata> {
  const { lang } = await params
  return lang === 'vi' ? { ...METADATA, title: `Trung tâm trợ giúp | ${SITE_NAME}` } : METADATA
}

// The payload carries the VIEWER's own votes and saved flags, read from the request
// cookie — so this page must never be served from a prerendered shell shared between
// accounts. (Same reason /dashboard/forum is force-dynamic.)
export const dynamic = 'force-dynamic'

export default async function HelpPage() {
  const [data, jar, head] = await Promise.all([loadHelpCenter(), cookies(), headers()])
  /**
   * EVERY QUESTION AND ANSWER IN THE READER'S LANGUAGE IN THE SERVER HTML (B5-HELP-VI, auth-02) — the
   * same embed /help/[id] makes for its h1 and body (L-CONTENT-VI). The curated Vietnamese of each
   * seeded answer lives in the Translation cache; without this the index's titles and its answer bodies
   * (in the HTML, `hidden="until-found"`, so find-in-page and crawlers read them) were English until
   * `useTr` swapped them after hydration. One indexed read (cachedTranslations swallows its own errors,
   * and an empty map is the client path this replaced).
   * ⚠️ ONLY THE READER'S LANGUAGES (embed-languages.ts): the cache holds every language anyone has read
   * a help post in, and the rows read at most en, vi and the reader's own.
   */
  const keep = embedLanguages(readerLanguage(jar.get(LANG_COOKIE)?.value, head.get('accept-language')))
  const raw = await cachedTranslations([
    ...data.answers.flatMap((p) => [p.title, p.body]),
    ...data.questions.map((p) => p.title),
  ])
  const i18n: HelpI18n = Object.fromEntries(Object.entries(raw).map(([text, map]) => [text, pickEmbedded(map, keep)]))
  return (
    <div className="flex min-h-page flex-col blob-bg">
      <Header />
      <main id="main" tabIndex={-1} className="mx-auto w-full max-w-7xl flex-1 px-3 sm:px-6 lg:px-8 pt-8 sm:pt-12 pb-16">
        <HelpCenter data={data} i18n={i18n} />
      </main>
      <Footer />
    </div>
  )
}
