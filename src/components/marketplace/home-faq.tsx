import { Bilingual } from '@/components/marketplace/bilingual'
import { FaqItem } from '@/components/marketplace/home-faq-item'
import { FOUNDER_QUOTE, HOME_ABOUT, type AboutText } from '@/lib/home-about'
import { HOME_FAQ_HEADING, homeFaqJsonLd, homeQuestionsArticleJsonLd } from '@/lib/home-faq'
import { jsonLdText } from '@/lib/home-item-lists'

/**
 * The home page's questions, at the end of the page (owner 2026-11-19, "show less without losing scores"; src/lib/home-faq.ts
 * and home-about.ts have the rules), with the FAQPage JSON-LD built from the same answers. Closed, the block is one row per
 * question. Each question is an H2 and opens on its direct answer. Every closed answer stays in the SSR HTML: crawlers, answer
 * engines and find-in-page read all of it, and the browser opens the one that holds a match.
 * ⛔ EACH ROW IS home-faq-item.tsx, NOT ui/accordion, SINCE 2026-11-25 (measured: Base UI's accordion was the largest part of
 * the phone home's worst long task). Why each alternative was ruled out is written there.
 */
const Para = ({ parts, className }: { parts: readonly AboutText[]; className: string }) => (
  <p className={className}>
    {parts.map((t, i) => (
      <span key={t.en}>
        {i > 0 ? ' ' : null}
        <Bilingual en={t.en} vi={t.vi} />
      </span>
    ))}
  </p>
)

/**
 * The questions' JSON-LD: the FAQPage, and the block as an Article (author eno.vn, dated) that is part of the home WebPage, not
 * its main entity (home-faq.ts). ⚠️ RENDERED AT THE TOP OF THE PAGE, NOT IN THE SECTION (websiteaeogeochecker, 2026-11-24): the
 * home HTML runs ~777 KB, and checkers that read only its first ~200 KB found "No FAQPage schema" in the section at ~384 KB.
 * JSON-LD is data, so where it sits changes nothing on screen; the answers are the section's own, from one source.
 */
export function HomeFaqJsonLd({ lang, webPageId }: { lang: string; webPageId: string | null }) {
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdText(homeFaqJsonLd(lang)) }} />
      {webPageId ? <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdText(homeQuestionsArticleJsonLd(lang, webPageId)) }} /> : null}
    </>
  )
}

/** One question row: the H2 and its answer (the first carries the founder's quote). The answer wrapper is the accordion panel's. */
function Question({ s, first }: { s: (typeof HOME_ABOUT)[number]; first: boolean }) {
  return (
    <FaqItem id={s.id} question={<Bilingual en={s.q.en} vi={s.q.vi} />}>
      <div className="pb-4 text-sm leading-relaxed text-body">
        <div className="pb-3">
          <Para parts={s.open} className="text-sm leading-relaxed text-foreground" />
          {s.more.map((p) => (
            <Para key={p[0].en} parts={p} className="mt-2 text-sm leading-relaxed text-body" />
          ))}
          {first ? (
            <blockquote className="mt-3">
              <p className="text-sm italic leading-relaxed text-body">
                “<Bilingual en={FOUNDER_QUOTE.text.en} vi={FOUNDER_QUOTE.text.vi} />”
              </p>
              <footer className="mt-1 text-t-meta text-muted-foreground">
                <Bilingual en={FOUNDER_QUOTE.by.en} vi={FOUNDER_QUOTE.by.vi} />
              </footer>
            </blockquote>
          ) : null}
        </div>
      </div>
    </FaqItem>
  )
}

/**
 * ⛔ TWO COLUMNS, COMPACT (owner, 2026-11-24: "make it 2 rows faq more compact"): from `sm` the questions run in two columns,
 * each its OWN list — one grid of items would leave a hole beside an opened answer, and CSS columns would move questions
 * between columns as one opens. The first half (rounded up) on the left, in order; on a phone the halves stack into the same
 * single list (the left half's last row keeps its rule, so the seam reads as any other). Rows 40px (py-2.5), not 44.
 */
export function HomeFaq() {
  const half = Math.ceil(HOME_ABOUT.length / 2)
  return (
    <section aria-labelledby="home-faq" className="mt-8 border-t border-border pb-6 pt-5">
      <p id="home-faq" className="text-base font-bold text-foreground">
        <Bilingual en={HOME_FAQ_HEADING.en} vi={HOME_FAQ_HEADING.vi} />
      </p>
      <div className="mt-1 sm:grid sm:grid-cols-2 sm:items-start sm:gap-x-8">
        <div className="w-full max-sm:[&>*:last-child]:border-b">
          {HOME_ABOUT.slice(0, half).map((s, i) => <Question key={s.id} s={s} first={i === 0} />)}
        </div>
        <div className="w-full">
          {HOME_ABOUT.slice(half).map((s) => <Question key={s.id} s={s} first={false} />)}
        </div>
      </div>
    </section>
  )
}
