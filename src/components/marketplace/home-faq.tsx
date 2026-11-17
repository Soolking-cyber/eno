import { Bilingual } from '@/components/marketplace/bilingual'
import { HOME_FAQ, HOME_FAQ_HEADING, homeFaqJsonLd } from '@/lib/home-faq'
import { jsonLdText } from '@/lib/home-item-lists'
import { SITE_NAME } from '@/lib/edition'

/**
 * The home page's questions and answers, at the end of the page (src/lib/home-faq.ts has the rules), with the FAQPage
 * JSON-LD built from the same pairs. A plain <dl>: every answer is open, nothing to tap, nothing hidden from a reader or
 * a crawler — so no disclosure widget, and so no Base UI primitive to reach for.
 */
export function HomeFaq({ lang }: { lang: string }) {
  const site = { site: SITE_NAME }
  return (
    <section aria-labelledby="home-faq" className="mt-10 border-t border-border pb-8 pt-6">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdText(homeFaqJsonLd(lang)) }} />
      <h2 id="home-faq" className="text-base font-bold text-foreground">
        <Bilingual en={HOME_FAQ_HEADING.en} vi={HOME_FAQ_HEADING.vi} values={site} />
      </h2>
      <dl className="mt-4 grid gap-x-8 gap-y-5 sm:grid-cols-2">
        {HOME_FAQ.map((p) => (
          <div key={p.q.en}>
            <dt className="text-sm font-bold text-foreground"><Bilingual en={p.q.en} vi={p.q.vi} values={site} /></dt>
            <dd className="mt-1 text-sm leading-relaxed text-body"><Bilingual en={p.a.en} vi={p.a.vi} values={site} /></dd>
          </div>
        ))}
      </dl>
    </section>
  )
}
