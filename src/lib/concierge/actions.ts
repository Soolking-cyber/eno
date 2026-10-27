import { customFilterChipLabel } from '@/components/marketplace/facet-chip-label'
import { DISTRICTS_PROVINCE_CODE, districtSlugLabel } from '@/components/marketplace/listings-explorer.constants'
import { CONCIERGE_HIDDEN_SUBCATEGORIES, isConciergeCategory } from '@/lib/concierge/categories'
import { EDITION_BANNED } from '@/lib/concierge/guards'
import type { ConciergeAction, PageState, ResolvedAction } from '@/lib/concierge/types'
import { canonicalDistrictSlug, isCuratedDistrict } from '@/lib/district-canonical'
import { applyFilterParams, readExplorerUrl, type ExplorerUrlState } from '@/lib/explorer-url'
import { LANGS, type Language } from '@/lib/i18n/langs'
import { localizedHref } from '@/lib/lang-pinned'
import { variantOfLanguage } from '@/lib/lang-variant'
import { MULTI_SEP, canonicalFacetValue, multiFacetValues } from '@/lib/multi-facet'
import { slugify } from '@/lib/slug'
import {
  CATEGORY_BY_SLUG, CONDITION_FACET, LISTING_TYPES, facetsFor, subcategoriesFor, typesFor,
  type FacetDef, type RangeColumn, type RangeMeta,
} from '@/lib/taxonomy'
import { VN_PROVINCES } from '@/lib/vn-areas'
import { formatInteger, formatMoneyFull } from '@/lib/vnd'

/**
 * THE CONCIERGE'S ACTION → THE ONE URL THE PAGE MAY FOLLOW (owner, 2026-10-27: "i say I need a teacher in district 1 it
 * should open right category select right filter and ask follow up question like do you need native or non native or
 * whats ur budget"). The brain writes an ACTION in the catalog's own words (types.ts); this file is the only place an
 * action becomes an href, and the turn route's `go` line carries nothing else. Plan: ~/eno-classroom-2026-10-25/concierge/
 * PLAN.md §3 "Action validator" and §10; the URL contract is the nav research (nav.md §2–§6).
 *
 * ⛔ THE EXPLORER FAILS QUIETLY, SO THIS FILE MAY NOT. An unknown category, another shelf's subcategory, a facet the view
 * does not offer (`?category=rentals&attr_bedrooms=2` is ALL rentals: bedrooms needs a subcategory), a value outside the
 * facet's options (`attr_native=yes`), the wrong key case (`jobType` on teachers, `jobtype` on jobs), `condition` where
 * there is none, a price on teachers: none of them errors. Each empties or silently widens the feed while the avatar says
 * it is showing what was asked. So every part is checked against the view it lands on (facetsFor), anything invalid is
 * DROPPED, never the whole action, unless nothing valid is left for the shelf already open (then nothing moves, and the
 * brain speaks its refusal line rather than the model's "Showing …"). The result is read back through the explorer's own
 * reader (readExplorerUrl), and the href and the caption describe only what survived.
 *
 * ⛔ TEACHERS (nav.md §3, §4.4). A teacher's price is always 0, so the budget is the EXPECTED SALARY (`salary`, million đ
 * a month): never priceMin/priceMax, never a price order. "A teacher in District 1" is where they CAN TEACH (`workIn`),
 * so a `district` filter is read as `workIn`. "Lives in" (the page's own `district` / `province`, from a /c/teachers/<d>
 * link) is not offered (PLAN §10): a place the concierge sets replaces it, one place and never an AND of two meanings.
 *
 * ⚠️ PURE AND SERVER-SAFE: no database, no `window`. The turn route resolves the action before the first spoken word. (The
 * host keeps its own allowlist — client.ts CONCIERGE_PAGE_PATHS — and never imports this file.)
 */

/**
 * The pages a `page` action may open (PLAN §3; every path is a `page.tsx` under src/app/[lang]/ on both editions — the
 * test reads the files). `closes`: the window cannot live there (PLAN §10: the host hides it on the post flow, /messages
 * and the teacher host), so the host navigates and then ends the session, after the avatar has said so.
 * ⚠️ Read through `Object.hasOwn`, never `CONCIERGE_PAGES[target]` alone: `constructor` or `__proto__` would read the
 * prototype (lang-pinned.ts has the same trap).
 */
export const CONCIERGE_PAGES: Readonly<Record<string, { path: string; label: string; closes: boolean }>> = Object.freeze({
  post: { path: '/post', label: 'Post a listing', closes: true },
  'teacher-join': { path: '/teachers/join', label: 'Create your teacher profile', closes: true },
  messages: { path: '/messages', label: 'Messages', closes: true },
  help: { path: '/help', label: 'Help center', closes: false },
  safety: { path: '/safety', label: 'Safe trading', closes: false },
  trust: { path: '/trust', label: 'How trust works', closes: false },
  'rent-index': { path: '/hcmc-rent-index', label: 'HCMC Rent Index', closes: false },
  'teach-guides': { path: '/teach-in-vietnam', label: 'Teach in Vietnam guides', closes: false },
  schools: { path: '/schools', label: 'Saigon schools ranked by teachers', closes: false },
  saved: { path: '/saved', label: 'Saved', closes: false },
  home: { path: '/', label: 'Home', closes: false },
})

const TEACHERS = 'teachers'
/** Teachers' "Can teach in" facet, where their `district` filter goes. */
const WORK_IN = 'workIn'
/** The answer schema's cap on filters (PLAN §3). */
const MAX_FILTERS = 8
/** A Prisma `cuid()` (schema.prisma Listing.id), the repo's bound (vehicle-status-plan.ts): no other shape reaches a path. */
const LISTING_ID = /^c[a-z0-9]{20,30}$/

/**
 * The catalog keys that are top-level explorer params rather than facets, in nav.md §2.4's URL order. ⛔ `condition` is
 * one of them although the taxonomy lists it as a facet: the explorer sends it as `condition=`, never `attr_condition`
 * (an exact `attributes` match, a different filter — nav.md §3).
 */
const TOP_KEYS = ['district', 'province', 'type', 'condition', 'sort', 'priceMin', 'priceMax'] as const
const isTopKey = (k: string): boolean => (TOP_KEYS as readonly string[]).includes(k)

/** The explorer's orders besides its default relevance blend (explorer-url.ts SORTS). */
const SORTS = ['recent', 'price-low', 'price-high', 'popular'] as const
type Sort = (typeof SORTS)[number]

/** `any` drops a filter (types.ts), and so does the explorer's own `all` (applyFilterParams skips it). */
const isAny = (v: string): boolean => /^(any|all)$/i.test(v.trim())
const isLanguage = (s: string): s is Language => (LANGS as readonly string[]).includes(s)

/** Where an action lands: a concierge category and one of its subcategories ('' = all of it). */
type View = { category: string; subcategory: string }
/** The explorer URL in catalog terms: nav.md §2.4 explorerQuery's input, without what the concierge never sets
 *  (brand, model, line, deal, ward, view). `filters` keeps the order the keys were written in. */
type Target = View & { q: string; filters: Map<string, string> }

const facetsOf = (v: View): FacetDef[] => facetsFor(v.category, v.subcategory || null)

/** A subcategory of `category` the concierge may open: '' = all of it; null = none of it (another shelf's, or hidden). */
function subcategoryOf(raw: string, category: string): string | null {
  if (isAny(raw)) return ''
  const slug = slugify(raw)
  const s = subcategoriesFor(category).find((x) => x.slug === raw.trim().toLowerCase() || slugify(x.name) === slug)
  return s && !CONCIERGE_HIDDEN_SUBCATEGORIES.has(s.slug) ? s.slug : null
}

/**
 * The catalog key `raw` names on this view: exact, else the one key equal to it ignoring case, else null.
 * ⚠️ The explorer's keys are case-sensitive and a wrong case empties the feed (`attr_jobType` is teachers', `attr_jobtype`
 * jobs'). No view offers two keys that differ only by case, so the case-blind match is unambiguous.
 */
function catalogKey(raw: string, view: View): string | null {
  const keys: string[] = [...TOP_KEYS, ...facetsOf(view).map((f) => f.key).filter((k) => k !== CONDITION_FACET.key)]
  const k = raw.trim()
  return keys.find((x) => x === k) ?? keys.find((x) => x.toLowerCase() === k.toLowerCase()) ?? null
}

/** An ACTION's key on this view: teachers read `district` as where they can teach, and take no lives-in province. */
function actionKey(raw: string, view: View): string | null {
  const key = catalogKey(raw, view)
  if (view.category !== TEACHERS) return key
  if (key === 'district') return WORK_IN
  return key === 'province' ? null : key
}

/**
 * The option of facet `f` that `raw` names: its value (any case, spaces read as hyphens: "1-3 years"), else its English
 * or Vietnamese label ("District 1", "Quận 1"), else, for a place facet, any spelling of a curated district ("thao-dien").
 */
function optionOf(f: FacetDef, raw: string): string | null {
  const exact = raw.trim().toLowerCase()
  const loose = exact.replace(/[\s_]+/g, '-')
  const slug = slugify(raw)
  const hit = f.options.find((o) => o.value.toLowerCase() === exact || o.value.toLowerCase() === loose)
    ?? (slug ? f.options.find((o) => slugify(o.label) === slug || slugify(o.labelVi) === slug) : undefined)
    ?? (f.placeNames ? f.options.find((o) => o.value === canonicalDistrictSlug(raw)) : undefined)
  return hit?.value ?? null
}

const RANGE = /^(\d+(?:\.\d+)?)?-(\d+(?:\.\d+)?)?$/
/** A range facet's `min-max` (either side open) inside the facet's own bounds, written canonically ("30-40", "25-"). */
function rangeValue(r: RangeMeta, raw: string): string | null {
  const m = RANGE.exec(raw.replace(/\s+/g, ''))
  if (!m || (!m[1] && !m[2])) return null
  const lo = m[1] ? Number(m[1]) : null
  const hi = m[2] ? Number(m[2]) : null
  const inside = (n: number | null) => n === null || (n >= r.min && n <= r.max)
  if (!inside(lo) || !inside(hi) || (lo !== null && hi !== null && lo > hi)) return null
  return `${lo ?? ''}-${hi ?? ''}`
}

/** A facet value as the explorer keeps it: an option's value, a bounded range, or a multi facet's canonical list (the
 *  options named in it, taxonomy order — multi-facet.ts); null when nothing in `raw` is one of them. */
function facetValue(f: FacetDef, raw: string): string | null {
  if (f.kind === 'range') return f.range ? rangeValue(f.range, raw) : null
  if (f.multi) {
    const picks = raw.split(MULTI_SEP).map((part) => optionOf(f, part)).filter((v): v is string => v !== null)
    return picks.length ? canonicalFacetValue(f.key, picks.join(MULTI_SEP)) : null
  }
  const v = optionOf(f, raw)
  return v === null ? null : canonicalFacetValue(f.key, v)
}

const DIGITS = /^\d{1,12}$/
const GROUPED = /^\d{1,3}([.,])\d{3}(?:\1\d{3}){0,2}$/
/** Whole đồng: digits, or digits grouped in threes by one separator ("15,000,000", "15.000.000"). "15.5" is not money. */
function vndAmount(raw: string): string | null {
  const digits = DIGITS.test(raw) ? raw : GROUPED.test(raw) ? raw.replace(/[.,]/g, '') : null
  return digits === null ? null : String(Number(digits))
}

/** A VN_PROVINCES code, named by its code or by its name in either language ("Ha Noi", "Hồ Chí Minh"). */
function provinceCode(raw: string): string | null {
  const slug = slugify(raw)
  const p = VN_PROVINCES.find((x) => x.code === raw)
    ?? (slug ? VN_PROVINCES.find((x) => slugify(x.nameEn) === slug || slugify(x.name) === slug) : undefined)
  return p?.code ?? null
}

/**
 * A district: a curated HCMC key, from any spelling canonicalDistrictSlug knows ("District 1", "quan-1", "thao-dien").
 * ⚠️ The PAGE may also hold a place outside the curated list (a /c/<category>/<district> landing's `cau-giay`, already
 * the slug the explorer read): a refine keeps it. The model may only name the catalog's places.
 */
function districtValue(raw: string, from: 'action' | 'page'): string | null {
  const d = canonicalDistrictSlug(raw)
  if (isCuratedDistrict(d)) return d
  return from === 'page' && d !== '' && d === raw ? d : null
}

/** The canonical value of catalog filter `key` on this view, or null when the view does not take `raw` there. */
function catalogValue(key: string, raw: string, view: View, from: 'action' | 'page'): string | null {
  const teachers = view.category === TEACHERS
  const v = raw.trim()
  const lower = v.toLowerCase()
  switch (key) {
    case 'district': return districtValue(v, from)
    case 'province': return provinceCode(v)
    case 'type': return typesFor(view.category).find((t) => t === lower) ?? null
    case 'condition':
      return facetsOf(view).some((f) => f.key === CONDITION_FACET.key) && CONDITION_FACET.options.some((o) => o.value === lower) ? lower : null
    // ⛔ A teacher's price is always 0, so a price order is no order at all.
    case 'sort': return SORTS.find((s) => s === lower && !(teachers && s.startsWith('price'))) ?? null
    case 'priceMin':
    case 'priceMax': return teachers ? null : vndAmount(v)
    default: {
      const f = facetsOf(view).find((x) => x.key === key)
      return f ? facetValue(f, v) : null
    }
  }
}

/**
 * Set a filter, or remove it (`null`). ⚠️ A NEWER BOUND BEATS A CONTRADICTING OLDER ONE: "under 10 million" on a page
 * already "from 20 million" is an empty feed, so the older bound goes.
 */
function put(filters: Map<string, string>, key: string, value: string | null): void {
  if (value === null) {
    filters.delete(key)
    return
  }
  const n = Number(value)
  if (key === 'priceMax' && Number(filters.get('priceMin') ?? 0) > n) filters.delete('priceMin')
  if (key === 'priceMin' && filters.has('priceMax') && Number(filters.get('priceMax')) < n) filters.delete('priceMax')
  filters.set(key, value)
}

/**
 * ⚠️ A PLACE REPLACES A PLACE — the explorer's own rule (listings-explorer.constants.ts districtAfterProvinceChange,
 * explorer-place.ts): an HCMC district under a province outside HCMC is an empty feed, so the place just asked for wins.
 * On teachers the concierge's one place is "can teach in": setting or clearing it also clears the page's lives-in
 * district and province, so "anywhere is fine" widens what the screen shows, whichever of the two the page had.
 */
function replacePlace(filters: Map<string, string>, key: string, value: string | null, view: View): void {
  if (view.category === TEACHERS) {
    if (key === WORK_IN) {
      filters.delete('district')
      filters.delete('province')
    }
    return
  }
  if (value === null) return
  if (key === 'district' && filters.has('province') && filters.get('province') !== DISTRICTS_PROVINCE_CODE) filters.delete('province')
  if (key === 'province' && value !== DISTRICTS_PROVINCE_CODE && isCuratedDistrict(filters.get('district') ?? '')) filters.delete('district')
}

/** The words of a search box: NFC, one space between words. */
const words = (s: string): string => s.normalize('NFC').replace(/\s+/g, ' ').trim()
/** ⛔ The MODEL's search: short, letters, digits, spaces and hyphens (PLAN §10). Places and prices belong in filters;
 *  the brief keeps them out, nothing here parses them. */
const MODEL_SEARCH = /^[\p{L}\p{N} -]{1,60}$/u
/** ⚠️ The PAGE's search is what the person typed ("levi's jeans"): a refine keeps it as it is, within a sane length. */
const PAGE_SEARCH_MAX = 200

/** nav.md §2.4 explorerQuery: the top-level params in its order, then the facets through the explorer's own writer
 *  (applyFilterParams: `attr_` or `range_<column>`, canonical multi lists, and a facet the view does not offer dropped). */
function explorerQuery(t: Target): URLSearchParams {
  const p = new URLSearchParams({ category: t.category })
  if (t.subcategory) p.set('subcategory', t.subcategory)
  if (t.q) p.set('q', t.q)
  for (const k of TOP_KEYS) {
    const v = t.filters.get(k)
    if (v) p.set(k, v)
  }
  applyFilterParams(p, Object.fromEntries([...t.filters].filter(([k]) => !isTopKey(k))), t.category, t.subcategory || 'all')
  return p
}

/** The explorer's reading of a URL, back in catalog terms: exactly what survived ('all' and 'newest' are none). */
function targetOf(s: ExplorerUrlState): Target {
  const [min = '', max = ''] = s.priceRange === 'all' ? [] : s.priceRange.split('-')
  const top: Record<(typeof TOP_KEYS)[number], string> = {
    district: s.district === 'all' ? '' : s.district,
    province: s.province,
    type: s.listingType === 'all' ? '' : s.listingType,
    condition: s.condition === 'all' ? '' : s.condition,
    sort: s.sort === 'newest' ? '' : s.sort,
    priceMin: min,
    priceMax: max,
  }
  const filters = new Map<string, string>()
  for (const k of TOP_KEYS) if (top[k]) filters.set(k, top[k])
  for (const [k, v] of Object.entries(s.customFilters)) filters.set(k, v)
  return { category: s.category, subcategory: s.subcategory === 'all' ? '' : s.subcategory, q: s.query, filters }
}

/** The caption's `tr`: English (the voice and its captions are English-only, PLAN §6). */
const english = (en: string): string => en
/** ⚠️ The taxonomy's range units are the slider's ("tr/tháng" is Vietnamese); the caption says them in English. */
const RANGE_UNIT: Readonly<Record<RangeColumn, string>> = {
  year: '', mileageKm: 'km', engineL: 'L', engineCc: 'cc', areaM2: 'm²', salaryM: 'million đ/month',
}
/** The explorer's own order names (explorer-toolbar.tsx); a job's price is its salary there too. */
const SORT_LABEL: Readonly<Record<Sort, string>> = {
  recent: 'Newest', popular: 'Most contacted', 'price-low': 'Price: low to high', 'price-high': 'Price: high to low',
}

/**
 * Plain English for the trace and the caption: "Teachers · Can teach in: District 1 · Native speaker: Native". Facets
 * read as the explorer's applied-filter chips read (facet-chip-label.ts), so the caption names what the screen's chips
 * name; places by their curated names (never machine-translated); money through vnd.ts. Every word comes from the
 * taxonomy, the district table or VN_PROVINCES, and a hidden subcategory never reaches a target, so no visa word can.
 */
function browseLabel(t: Target): string {
  const pay = t.category === 'jobs' ? 'Salary' : 'Price'
  const lives = (place: string) => (t.category === TEACHERS ? `Lives in ${place}` : place)
  const parts = [CATEGORY_BY_SLUG[t.category].name]
  const sub = subcategoriesFor(t.category).find((s) => s.slug === t.subcategory)
  if (sub) parts.push(sub.name)
  const type = t.filters.get('type')
  // A shelf of one intent (teachers) says nothing by naming it.
  if (type && typesFor(t.category).length > 1) parts.push(LISTING_TYPES.find((x) => x.value === type)?.label ?? type)
  // ⛔ The caption is the guide's own words: a search the person typed that eno.vn may not say ("visa") stays in the URL —
  // it is their page — and off the caption (commit review, codex + opus).
  if (t.q && !EDITION_BANNED.test(t.q)) parts.push(`"${t.q}"`)
  const district = t.filters.get('district')
  if (district) parts.push(lives(districtSlugLabel(district, 'en')))
  const province = VN_PROVINCES.find((p) => p.code === t.filters.get('province'))
  if (province) parts.push(lives(province.nameEn))
  const condition = CONDITION_FACET.options.find((o) => o.value === t.filters.get('condition'))
  if (condition) parts.push(condition.label)
  const facets = facetsFor(t.category, t.subcategory || null)
  for (const [key, value] of t.filters) {
    const f = isTopKey(key) ? undefined : facets.find((x) => x.key === key)
    if (!f) continue
    const chip = f.range ? { ...f, range: { ...f.range, unit: RANGE_UNIT[f.range.column] } } : f
    // One part per pick of the multi facet, as the explorer draws one chip per pick (listings-explorer.tsx).
    for (const one of f.multi ? multiFacetValues(key, value) : [value]) parts.push(customFilterChipLabel(chip, key, one, 'en', english))
  }
  const min = t.filters.get('priceMin')
  const max = t.filters.get('priceMax')
  if (min && max) parts.push(`${pay} ${formatInteger(Number(min))}–${formatMoneyFull(Number(max), '₫')}`)
  else if (min) parts.push(`${pay} ≥ ${formatMoneyFull(Number(min), '₫')}`)
  else if (max) parts.push(`${pay} ≤ ${formatMoneyFull(Number(max), '₫')}`)
  const sort = SORTS.find((s) => s === t.filters.get('sort'))
  if (sort) parts.push(SORT_LABEL[sort].replace('Price', pay))
  return parts.join(' · ')
}

/** Did the multi facet `key` keep fewer distinct picks than `raw` named? (Single-value keys never drop a part.) */
function droppedPicks(key: string, raw: string, value: string, view: View): boolean {
  if (!facetsOf(view).some((x) => x.key === key && x.multi)) return false
  const named = new Set(raw.split(MULTI_SEP).map((p) => p.trim().toLowerCase()).filter(Boolean))
  return multiFacetValues(key, value).length < named.size
}

/** The query of the page's own href (a same-origin path page-state.ts checked) — the URL as the explorer reads it. */
function pageQuery(href: string): URLSearchParams {
  const q = href.indexOf('?')
  return new URLSearchParams(q < 0 ? '' : href.slice(q + 1).split('#')[0])
}

/**
 * `browse`: the category (the action's, or with `refine` the page's), then BASE = the page's own subcategory, filters
 * and search when it refines the shelf already open (else nothing), then the action's parts in order, each validated
 * against the view it lands on.
 */
function resolveBrowse(a: ConciergeAction, page: PageState, variant: string): ResolvedAction | null {
  const onExplorer = page.kind === 'explorer'
  const category = a.category.trim().toLowerCase() || (a.mode === 'refine' && onExplorer ? page.category ?? '' : '')
  if (!isConciergeCategory(category)) return null
  const sameShelf = onExplorer && page.category === category
  const base = a.mode === 'refine' && sameShelf
  let accepted = 0
  let refused = 0

  let subcategory = ''
  if (base && page.subcategory) {
    const kept = subcategoryOf(page.subcategory, category)
    // ⛔ The page's own aisle is one the guide may not open (the e-Visa aisle): the refine leaves it, and that is SAID —
    // the model wrote "cheapest first" for the aisle it saw (review round 4, opus).
    if (kept === null) refused++
    else subcategory = kept
  }
  if (a.subcategory.trim()) {
    const s = subcategoryOf(a.subcategory, category)
    if (s === null) refused++
    else {
      accepted++
      subcategory = s
    }
  }
  const view: View = { category, subcategory }

  const filters = new Map<string, string>()
  if (base) {
    for (const [raw, value] of Object.entries(page.filters)) {
      if (isAny(value)) continue // the reader's 'all' is no filter
      const key = catalogKey(raw, view)
      const v = key === null ? null : catalogValue(key, value, view, 'page')
      if (key !== null && v !== null) put(filters, key, v)
    }
  }
  for (const f of a.filters.slice(0, MAX_FILTERS)) {
    const key = actionKey(f.key, view)
    const remove = isAny(f.value)
    const value = key === null || remove ? null : catalogValue(key, f.value, view, 'action')
    if (key === null || (value === null && !remove)) {
      refused++
      continue
    }
    accepted++
    // A multi facet keeps the picks it knows: a pick it dropped ("pool, jacuzzi" → pool) is part of the action not applied
    // (review round 4, codex).
    if (value !== null && droppedPicks(key, f.value, value, view)) refused++
    replacePlace(filters, key, value, view)
    put(filters, key, value)
  }

  const typed = base ? words(page.search) : ''
  let q = typed.length <= PAGE_SEARCH_MAX ? typed : ''
  const said = words(a.search)
  if (said) {
    if (isAny(said)) {
      accepted++
      q = ''
    } else if (MODEL_SEARCH.test(said) && !EDITION_BANNED.test(said)) {
      // (never a word eno.vn may not say — commit review, codex: a "visa" search drove the app where the guide may not)
      accepted++
      q = said
    } else refused++
  }

  // ⛔ Nothing valid asked of the shelf already open: nothing moves, and the brain says so instead of "Showing …".
  if (sameShelf && accepted === 0 && refused > 0) return null
  const survived = targetOf(readExplorerUrl(explorerQuery({ ...view, q, filters })))
  const qs = new URLSearchParams(explorerQuery(survived))
  // A refine of the same shelf keeps what the catalog cannot name — brand, model, line, good prices, a ward. ⛔ The ward
  // only while its place is unchanged (commit review, codex: HCMC → Hanoi kept an HCMC ward, which the explorer then drops
  // as invalid — the person's neighbourhood silently lost).
  if (base && page.keep) {
    // Brand, model and line belong to the aisle they were picked in: another aisle drops them (review round 4, codex — an
    // iPhone line kept on Tablets empties it). Good prices and "any of the words" fit any view.
    const sameAisle = subcategory === (page.subcategory ?? '')
    for (const k of ['brand', 'model', 'line'] as const) if (sameAisle && page.keep[k]) qs.set(k, page.keep[k])
    for (const k of ['deal', 'match'] as const) if (page.keep[k]) qs.set(k, page.keep[k])
    const before = pageQuery(page.href)
    const samePlace = !!qs.get('province') && ['province', 'district'].every((k) => qs.get(k) === before.get(k))
    if (page.keep.ward && samePlace) qs.set('ward', page.keep.ward)
  }
  return {
    kind: 'browse',
    href: localizedHref(`/?${qs}`, variant),
    label: browseLabel(survived),
    category,
    ...(refused > 0 ? { partial: true } : {}),
  }
}

/**
 * The validated action, or null when there is nothing to follow (`none`, or an action that does not hold).
 * ⚠️ The language: the variant of the reader's language through `localizedHref` (on eno.vn `/` + vi → `/vi?…`; eno.forum
 * has no `/vi` twin). It is the server, so `hereVariant` (which reads `window`) has nothing to add.
 */
export function resolveAction(
  a: ConciergeAction,
  page: PageState,
  opts: { lang: string; listingIds: ReadonlySet<string> },
): ResolvedAction | null {
  const variant = variantOfLanguage(isLanguage(opts.lang) ? opts.lang : 'en')
  switch (a.kind) {
    case 'browse':
      return resolveBrowse(a, page, variant)
    case 'listing': {
      // ⛔ Only an id the server itself put in this turn's PAGE: never one the model made up or remembered.
      const id = a.target.trim()
      if (!opts.listingIds.has(id) || !LISTING_ID.test(id)) return null
      return { kind: 'listing', href: localizedHref(`/listings/${id}`, variant), label: 'Listing details' }
    }
    case 'page': {
      const key = a.target.trim()
      if (!Object.hasOwn(CONCIERGE_PAGES, key)) return null
      const p = CONCIERGE_PAGES[key]
      return { kind: 'page', href: localizedHref(p.path, variant), label: p.label, closes: p.closes }
    }
    default:
      return null
  }
}
