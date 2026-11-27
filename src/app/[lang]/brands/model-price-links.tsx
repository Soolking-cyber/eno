import { Bilingual } from '@/components/marketplace/bilingual'
import { modelHubPath, modelPagePath } from '@/lib/model-pages'

/**
 * "Prices by model" under the brand wall (owner, 2026-11-25, "1 ok": hub links for the pages Seobility's crawl 6 found 4 clicks
 * deep). Each model page (/price/<slug>, /gia/<slug> on the Vietnamese render) is otherwise linked only from a listing page.
 * The shape is /c/teachers' "More teachers" (teacher-links.tsx): a hairline, an `h-section` heading, a plain list of names —
 * no counts or prices (those are on the page, and a figure here would go stale with the ISR window). Model names are names:
 * never translated. Renders nothing without a page to list.
 * The heading links the hub of the render's language (/price, /gia — 2026-11-27, for Cốc Cốc: the hubs had no inbound link).
 * `hub`: the hub's own render (model-price-page.tsx ModelPriceHub) — the list alone, its h1 is the heading.
 */
const NAME_LIST = 'mt-4 grid grid-cols-2 gap-x-6 sm:grid-cols-3 lg:grid-cols-4 [&_a]:block [&_a]:truncate [&_a]:py-3 [&_a]:text-sm [&_a]:text-body [&_a]:hover:text-accent-foreground [&_a]:hover:underline sm:[&_a]:py-1'

export function ModelPriceLinks({ pages, lang, hub = false }: { pages: readonly { slug: string; name: string }[]; lang: 'en' | 'vi'; hub?: boolean }) {
  if (!pages.length) return null
  const list = (
    <ul className={NAME_LIST}>
      {pages.map((p) => (
        <li key={p.slug}>
          <a href={modelPagePath(p.slug, lang)}>{p.name}</a>
        </li>
      ))}
    </ul>
  )
  if (hub) return list
  return (
    <section data-model-price-links="" className="mt-12 border-t border-border pt-8">
      <h2 className="h-section text-foreground">
        <a href={modelHubPath(lang)} className="hover:text-accent-foreground hover:underline">
          <Bilingual en="Prices by model" vi="Giá theo mẫu" />
        </a>
      </h2>
      {list}
    </section>
  )
}
