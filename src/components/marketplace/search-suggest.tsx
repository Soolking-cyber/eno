'use client'

import Image from 'next/image'
import { isMockImageUrl } from '@/lib/listing-image'
import { Search, Tag } from 'lucide-react'
import { useLanguage } from '@/context/language-context'
import { Price } from './price'
import { fold } from '@/lib/fold'
import { cn } from '@/lib/utils'
import type { SuggestListing, SuggestCategory, SuggestBrand } from '@/hooks/use-search-suggest'

// Ordered, keyboard-navigable dropdown items. The 'Search for "{q}"' row is ALWAYS
// first — Enter with no arrow-key selection executes that raw free-text search,
// never a suggestion. Then Brands → Categories → Listings, capped at 8 suggestions
// beyond the query row so the panel stays scannable. The search bars own the active
// index and call onPick(items[activeIndex]) on Enter; the panel renders the same
// order so highlight + selection stay in sync.
export type SuggestItem =
  | { type: 'query' }
  | { type: 'brand'; slug: string; name: string }
  | { type: 'category'; slug: string; name: string; nameVi: string }
  | { type: 'listing'; listing: SuggestListing }

export function buildSuggestItems(
  query: string,
  brands: SuggestBrand[],
  categories: SuggestCategory[],
  listings: SuggestListing[],
): SuggestItem[] {
  const items: SuggestItem[] = []
  if (query.trim().length >= 2) items.push({ type: 'query' })
  brands.slice(0, 2).forEach((b) => items.push({ type: 'brand', slug: b.slug, name: b.name }))
  categories.slice(0, 2).forEach((c) => items.push({ type: 'category', slug: c.slug, name: c.name, nameVi: c.nameVi }))
  const used = items.length - (items[0]?.type === 'query' ? 1 : 0)
  listings.slice(0, Math.max(0, 8 - used)).forEach((l) => items.push({ type: 'listing', listing: l }))
  return items
}

/** Accent-insensitive substring bolding: "can ho" bolds the "Căn hộ" inside a
 *  suggestion. Folds the text char-by-char with an index map so the bold range
 *  lands on the ORIGINAL string even where folding changes character counts. */
function Highlight({ text, query }: { text: string; query: string }) {
  const fq = fold(query)
  if (!fq) return <>{text}</>
  let folded = ''
  const map: number[] = []
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    const f = /\s/.test(ch) ? ' ' : fold(ch) // fold() trims whitespace — keep it as a boundary
    for (let j = 0; j < f.length; j++) { folded += f[j]; map.push(i) }
  }
  // Whole query first, then its first matching ≥2-char token ("honda wave" still
  // highlights "Honda" when only the brand appears in the text).
  const needles = [fq, ...fq.split(' ').filter((t) => t.length >= 2)]
  for (const n of needles) {
    const at = folded.indexOf(n)
    if (at < 0) continue
    const start = map[at]
    const end = map[at + n.length - 1] + 1
    return (
      <>
        {text.slice(0, start)}
        <span className="font-bold">{text.slice(start, end)}</span>
        {text.slice(end)}
      </>
    )
  }
  return <>{text}</>
}

const sectionLabelCls = 'block px-2 text-[10px] font-bold uppercase tracking-wider text-ink-4'

/** Instant-match results rendered inside a search bar's dropdown surface. Shared
 *  by the header + hero search so they're identical on mobile and desktop. */
export function SearchSuggest({
  items, loading, query, activeIndex, onPick, onSubmitQuery,
}: {
  items: SuggestItem[]
  loading: boolean
  query: string
  activeIndex: number
  onPick: (it: SuggestItem) => void
  onSubmitQuery: () => void
}) {
  const { lang, tr } = useLanguage()
  const q = query.trim()
  // onMouseDown + preventDefault so the pick fires BEFORE the input blurs and the
  // outside-click handler closes the panel.
  const pickDown = (fn: () => void) => (e: React.MouseEvent) => { e.preventDefault(); fn() }

  const hasQueryRow = items[0]?.type === 'query'
  const brandItems = items.filter((i): i is Extract<SuggestItem, { type: 'brand' }> => i.type === 'brand')
  const categoryItems = items.filter((i): i is Extract<SuggestItem, { type: 'category' }> => i.type === 'category')
  const listingItems = items.filter((i): i is Extract<SuggestItem, { type: 'listing' }> => i.type === 'listing')
  const none = brandItems.length === 0 && categoryItems.length === 0 && listingItems.length === 0
  const brandStart = hasQueryRow ? 1 : 0
  const categoryStart = brandStart + brandItems.length
  const listingStart = categoryStart + categoryItems.length

  const chipCls = (active: boolean) =>
    cn(
      'rounded-xl px-3.5 py-2 text-sm font-semibold transition-colors cursor-pointer',
      active ? 'bg-muted text-accent-foreground' : 'text-body hover:bg-muted hover:text-accent-foreground',
    )

  return (
    <div className="space-y-2.5">
      {/* Raw free-text search — ALWAYS the first row; Enter with no arrow-key
          selection executes exactly this. */}
      {hasQueryRow && q.length >= 2 && (
        <button
          type="button"
          onMouseDown={pickDown(onSubmitQuery)}
          className={cn(
            'flex w-full items-center gap-2 rounded-xl px-2 py-2 text-left text-sm font-semibold text-accent-foreground transition-colors cursor-pointer',
            activeIndex === 0 ? 'bg-muted' : 'hover:bg-muted',
          )}
        >
          <Search className="h-4 w-4 shrink-0" /> {tr('Search for', 'Tìm')} “{q}”
        </button>
      )}

      {brandItems.length > 0 && (
        <div className="space-y-1">
          <span className={sectionLabelCls}>{tr('Brands', 'Thương hiệu')}</span>
          <div className="flex flex-wrap gap-1.5">
            {brandItems.map((b, i) => (
              <button
                key={b.slug}
                type="button"
                onMouseDown={pickDown(() => onPick(b))}
                className={cn('flex items-center gap-1.5', chipCls(activeIndex === brandStart + i))}
              >
                <Tag className="h-3.5 w-3.5 shrink-0 text-ink-4" />
                <Highlight text={b.name} query={q} />
              </button>
            ))}
          </div>
        </div>
      )}

      {categoryItems.length > 0 && (
        <div className="space-y-1">
          <span className={sectionLabelCls}>{tr('Categories', 'Danh mục')}</span>
          <div className="flex flex-wrap gap-1.5">
            {categoryItems.map((c, i) => (
              <button
                key={c.slug}
                type="button"
                onMouseDown={pickDown(() => onPick(c))}
                className={chipCls(activeIndex === categoryStart + i)}
              >
                <Highlight text={lang === 'vi' ? c.nameVi : c.name} query={q} />
              </button>
            ))}
          </div>
        </div>
      )}

      {listingItems.length > 0 && (
        <div className="space-y-1">
          <span className={sectionLabelCls}>{tr('Listings', 'Tin đăng')}</span>
          {listingItems.map((it, i) => {
            const l = it.listing
            const title = lang === 'vi' ? (l.titleVi || l.title) : l.title
            return (
              <button
                key={l.id}
                type="button"
                onMouseDown={pickDown(() => onPick(it))}
                className={cn(
                  'group flex w-full items-center gap-3 rounded-xl px-2 py-1.5 text-left transition-colors cursor-pointer',
                  activeIndex === listingStart + i ? 'bg-muted' : 'hover:bg-muted',
                )}
              >
                <span className="relative h-10 w-10 shrink-0 overflow-hidden rounded-lg bg-tint">
                  {l.image && (
                    <Image src={l.image} alt="" fill sizes="40px" quality={60} unoptimized={isMockImageUrl(l.image) || undefined} className="object-cover" />
                  )}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-foreground transition-colors group-hover:text-accent-foreground"><Highlight text={title} query={q} /></span>
                  <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <Price price={l.price} currency={l.currency} priceUnit={l.priceUnit} compact className="font-semibold text-accent-foreground" />
                    <span className="truncate">· {l.location}</span>
                  </span>
                </span>
              </button>
            )
          })}
        </div>
      )}

      {!loading && none && (
        <p className="px-2 py-3 text-center text-xs text-muted-foreground">{tr('No matches yet', 'Chưa có kết quả')}</p>
      )}
    </div>
  )
}
