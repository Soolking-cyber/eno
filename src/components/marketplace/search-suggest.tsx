'use client'

import Image from 'next/image'
import { isMockImageUrl } from '@/lib/listing-image'
import { Search, Tag } from 'lucide-react'
import { useLanguage } from '@/context/language-context'
import { Button } from '@/components/ui/button'
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

/** The id of the row at flat index `i` of `items`.
 *
 *  ⚠️ THE CONTRACT BETWEEN THE INPUT AND THE PANEL. DOM focus never leaves the
 *  input — the search bars move `activeIndex` and the panel paints a bg-muted
 *  highlight, so there is no focus event for a screen reader to announce. The
 *  substitute is `aria-activedescendant` on the input pointing at THIS id, which
 *  is why both sides must derive it from the same function and why the index used
 *  here is the flat `items` index (the one `activeIndex` is expressed in), NOT the
 *  per-section index. Get these out of sync and the highlight moves in silence
 *  again — exactly the bug this replaced. */
export const suggestOptionId = (listboxId: string, index: number) => `${listboxId}-o${index}`

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

const sectionLabelCls = 'block px-2 text-3xs font-bold uppercase tracking-wider text-ink-4'

/** Instant-match results rendered inside a search bar's dropdown surface. Shared
 *  by the header + hero search so they're identical on mobile and desktop. */
export function SearchSuggest({
  items, loading, query, activeIndex, listboxId, onPick, onSubmitQuery,
}: {
  items: SuggestItem[]
  loading: boolean
  query: string
  activeIndex: number
  /** Must match the `aria-controls` on the owning input — see `suggestOptionId`. */
  listboxId: string
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

  // Every row is an `option` in the input's listbox, not a button in its own right.
  // tabIndex={-1} is the load-bearing half: as focusable buttons the rows were a
  // SECOND, unsynchronised traversal track — Tab walked the DOM order while the
  // arrow keys walked `activeIndex`, and the two disagreed. A combobox listbox is
  // not in the tab order; the input is the only stop, and it speaks for the list.
  const optionProps = (index: number) => ({
    id: suggestOptionId(listboxId, index),
    role: 'option',
    'aria-selected': activeIndex === index,
    tabIndex: -1,
  } as const)

  // One string per section, used for BOTH the visible eyebrow and the group's
  // accessible name — the eyebrow is then aria-hidden so it isn't announced twice.
  const brandsLabel = tr('Brands', 'Thương hiệu')
  const categoriesLabel = tr('Categories', 'Danh mục')
  const listingsLabel = tr('Listings', 'Tin đăng')

  return (
    <>
    <div
      id={listboxId}
      role="listbox"
      aria-label={tr('Search suggestions', 'Gợi ý tìm kiếm')}
      className="space-y-2.5"
    >
      {/* Raw free-text search — ALWAYS the first row; Enter with no arrow-key
          selection executes exactly this. Flat index 0. */}
      {hasQueryRow && q.length >= 2 && (
        <Button
          variant="bare"
          size="none"
          type="button"
          {...optionProps(0)}
          onMouseDown={pickDown(onSubmitQuery)}
          className={cn(
            'flex w-full items-center justify-start gap-2 whitespace-normal rounded-xl px-2 py-2 text-left text-sm font-semibold text-accent-foreground transition-colors cursor-pointer',
            activeIndex === 0 ? 'bg-muted' : 'hover:bg-muted',
          )}
        >
          <Search className="h-4 w-4 shrink-0" /> {tr('Search for', 'Tìm')} “{q}”
        </Button>
      )}

      {brandItems.length > 0 && (
        <div className="space-y-1" role="group" aria-label={brandsLabel}>
          <span aria-hidden className={sectionLabelCls}>{brandsLabel}</span>
          <div className="flex flex-wrap gap-1.5">
            {brandItems.map((b, i) => (
              <Button
                variant="bare"
                size="none"
                key={b.slug}
                type="button"
                {...optionProps(brandStart + i)}
                onMouseDown={pickDown(() => onPick(b))}
                className={cn('flex items-center gap-1.5', chipCls(activeIndex === brandStart + i))}
              >
                <Tag className="h-3.5 w-3.5 shrink-0 text-ink-4" />
                <Highlight text={b.name} query={q} />
              </Button>
            ))}
          </div>
        </div>
      )}

      {categoryItems.length > 0 && (
        <div className="space-y-1" role="group" aria-label={categoriesLabel}>
          <span aria-hidden className={sectionLabelCls}>{categoriesLabel}</span>
          <div className="flex flex-wrap gap-1.5">
            {categoryItems.map((c, i) => (
              <Button
                variant="bare"
                size="none"
                key={c.slug}
                type="button"
                {...optionProps(categoryStart + i)}
                onMouseDown={pickDown(() => onPick(c))}
                className={chipCls(activeIndex === categoryStart + i)}
              >
                <Highlight text={lang === 'vi' ? c.nameVi : c.name} query={q} />
              </Button>
            ))}
          </div>
        </div>
      )}

      {listingItems.length > 0 && (
        <div className="space-y-1" role="group" aria-label={listingsLabel}>
          <span aria-hidden className={sectionLabelCls}>{listingsLabel}</span>
          {listingItems.map((it, i) => {
            const l = it.listing
            const title = lang === 'vi' ? (l.titleVi || l.title) : l.title
            return (
              <Button
                variant="bare"
                size="none"
                key={l.id}
                type="button"
                {...optionProps(listingStart + i)}
                onMouseDown={pickDown(() => onPick(it))}
                className={cn(
                  'group flex w-full items-center justify-start gap-3 rounded-xl px-2 py-1.5 text-left font-normal transition-colors cursor-pointer',
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
              </Button>
            )
          })}
        </div>
      )}

    </div>

    {/* The empty state is a SIBLING of the listbox, not a child. A role="listbox" may only own
        `option` and `group` children — a stray <p> inside it is handled inconsistently by AT (JAWS'
        virtual cursor in particular can skip right past it), which would make "no matches" the one
        message in this panel that a screen-reader user might never hear. Outside the listbox it is
        ordinary prose and is read normally. */}
    {!loading && none && (
      <p className="px-2 py-3 text-center text-xs text-muted-foreground">{tr('No matches yet', 'Chưa có kết quả')}</p>
    )}
    </>
  )
}
