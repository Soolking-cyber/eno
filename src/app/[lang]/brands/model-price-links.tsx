import { Bilingual } from '@/components/marketplace/bilingual'
import { modelPagePath } from '@/lib/model-pages'

/**
 * "Prices by model" under the brand wall (owner, 2026-11-25, "1 ok": hub links for the pages Seobility's crawl 6 found 4 clicks
 * deep). Each model page (/price/<slug>, /gia/<slug> on the Vietnamese render) is otherwise linked only from a listing page.
 * The shape is /c/teachers' "More teachers" (teacher-links.tsx): a hairline, an `h-section` heading, a plain list of names —
 * no counts or prices (those are on the page, and a figure here would go stale with the ISR window). Model names are names:
 * never translated. Renders nothing without a page to list.
 */
const NAME_LIST = 'mt-4 grid grid-cols-2 gap-x-6 sm:grid-cols-3 lg:grid-cols-4 [&_a]:block [&_a]:truncate [&_a]:py-3 [&_a]:text-sm [&_a]:text-body [&_a]:hover:text-accent-foreground [&_a]:hover:underline sm:[&_a]:py-1'

export function ModelPriceLinks({ pages, lang }: { pages: readonly { slug: string; name: string }[]; lang: 'en' | 'vi' }) {
  if (!pages.length) return null
  return (
    <section data-model-price-links="" className="mt-12 border-t border-border pt-8">
      <h2 className="h-section text-foreground">
        <Bilingual en="Prices by model" vi="Giá theo mẫu" />
      </h2>
      <ul className={NAME_LIST}>
        {pages.map((p) => (
          <li key={p.slug}>
            <a href={modelPagePath(p.slug, lang)}>{p.name}</a>
          </li>
        ))}
      </ul>
    </section>
  )
}
