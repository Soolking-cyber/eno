import 'server-only'
import vnUnits from '@/data/vn-units.json'
import { buildFeedPayload } from '@/app/api/listings/feed-payload'
import { districtAfterProvinceChange } from '@/components/marketplace/listings-explorer.constants'
import type { PageCard, PageState } from '@/lib/concierge/types'
import { isHcmc } from '@/lib/city-short'
import { db } from '@/lib/db'
import { canonicalDistrictSlug, districtLabel, unaccent } from '@/lib/district-canonical'
import { scopedListingWhere } from '@/lib/edition-scope'
import { applyFilterParams, readExplorerUrl, type ExplorerUrlState } from '@/lib/explorer-url'
import { facetValues } from '@/lib/facet-tokens'
import { inferDistrictFromQuery } from '@/lib/district-query'
import { cutText } from '@/lib/feed-text'
import { fold } from '@/lib/fold'
import { pinnedVariant, stripViPrefix } from '@/lib/lang-pinned'
import { logError } from '@/lib/log'
import { priceUnitSuffix } from '@/lib/price-unit'
import { LISTING_CARD_SELECT, serializeListingCard } from '@/lib/serialize'
import { correctQuery } from '@/lib/spell-correct'
import { attributeBag, facetsFor } from '@/lib/taxonomy'
import { HOME_HIDDEN_TEACHER_LISTING_IDS, TEACHER_LISTING_TYPE } from '@/lib/teachers/constants'
import type { SerializedListingCard } from '@/lib/types'
import { provinceByCode, type AreaGeo } from '@/lib/vn-areas'
import { formatMoneyFull, vndWords } from '@/lib/vnd'

/**
 * eno's VOICE CONCIERGE — WHAT THE PERSON IS LOOKING AT WHEN THEY SPEAK (owner, 2026-10-27: "I say I need a teacher in
 * district 1 it should open right category select right filter and ask follow up question like do you need native or
 * non native"). Every turn the window sends the parent page's path + query; this reads it on the server into the PAGE
 * block the brain answers from (plan §3 and §10, ~/eno-classroom-2026-10-25/concierge/PLAN.md).
 *
 * ⛔ THE COUNT IS THE PAGE'S OWN, NEVER A SECOND QUERY'S. The explorer URL is read by the explorer's own reader
 * (explorer-url.ts readExplorerUrl), turned into the request the explorer itself sends (`feedParams` below), and answered by
 * the feed's own builder (api/listings/feed-payload.ts — the code behind GET /api/listings). Anything else drifts from the
 * screen, and the repo has already paid for "the chip said 12, the tap gave 2" more than once (feed-payload.ts notes).
 * ⛔ PUBLIC CARD FIELDS ONLY — never contact data, never a seller id. The owner's demo teacher profile and the teachers
 * who asked search engines not to list them (TeacherProfile.hideFromSearch) are COUNTED, as the page counts them, but never
 * described (plan §9, decisions 6 and 7).
 * ⚠️ 800 ms FOR THE WHOLE READ. A read that misses it leaves the turn with what the URL alone says (`total` null, no
 * cards) and carries on into a 60 s cache, so the next turn's PAGE is instant — as is the page the last turn navigated to,
 * which the turn route warms (`pageStateFor` on the new href, or `rememberPageState`).
 * ⚠️ ENGLISH DATA: the voice is English-only (plan §6), so prices, places and facts are written in English whatever the
 * page's language; only the titles are the page's own (`cardTitle`).
 */

/** The read's whole budget (plan §10). */
const PAGE_BUDGET_MS = 800
/** The cards the page shows first that the model may hear about (types.ts PageState.cards). */
const CARD_COUNT = 5
const HREF_MAX = 2_000
const SUMMARY_MAX = 900
const TITLE_MAX = 80
const CACHE_MS = 60_000
const CACHE_MAX = 200
/** A listing page's public path; the id is a cuid, and nothing longer or stranger reaches the database. */
const LISTING_PATH = /^\/listings\/([A-Za-z0-9_-]{1,64})$/
/** Only the shape of the base matters: an href must still be on it once parsed. */
const BASE = 'https://page.invalid'

type Lang = 'en' | 'vi'

/** A listing's own row beyond its card: the facet values its facts are read from, and the teacher's search choice. */
type RowExtra = { attributes: string | null; facetTokens: string | null; teacherProfile: { hideFromSearch: boolean } | null }

/**
 * The explorer's state as it SETTLES after mount — what its request is built from: the URL as `readExplorerUrl` reads it,
 * the province resolved from its code (vn-areas.ts), the ward from the dataset /api/geo serves it, and an HCMC district
 * dropped under any other province (use-drop-stale-district.ts — "Hà Nội AND District 1" is an empty feed).
 */
type Explorer = { url: ExplorerUrlState; district: string; province: AreaGeo | null; ward: AreaGeo | null }

/**
 * What an href needs: an answer now (a page with nothing to read, or no page at all), or a read — cached under what the
 * page shows, so two spellings of one view share it — with the answer to give while it has not landed.
 */
type Plan = { answer: PageState } | { key: string; read: () => Promise<PageState | null>; meanwhile: PageState }

/**
 * The PAGE state for the parent's `href` (its path + query). Never throws: a href that is not a same-origin path reads as
 * "Page: unknown", a page off the explorer and the listings as its path, and a read that fails or misses `timeoutMs` as
 * what the URL alone says.
 */
export async function pageStateFor(href: string, opts: { lang: string; timeoutMs?: number }): Promise<PageState> {
  const plan = planFor(href, opts.lang)
  if ('answer' in plan) return plan.answer
  const now = Date.now()
  let pending = fresh(plan.key, now)
  if (!pending) {
    pending = plan.read()
    remember(plan.key, pending, now)
  }
  const state = await within(pending, opts.timeoutMs ?? PAGE_BUDGET_MS)
  // A copy: the cached state is shared by every turn that reads it. The href is this turn's own spelling.
  return state ? { ...structuredClone(state), href } : plan.meanwhile
}

/**
 * Keep a state the caller already holds — the turn route warms the page its last answer navigated to — so the next
 * turn's read of that page is instant. ⚠️ A COMPLETE state only (as `pageStateFor` returns it): an explorer view without
 * its count is refused, because it would stand in for the real count for a minute.
 * ⚠️ KEPT UNDER THE LANGUAGE THE PAGE IS RENDERED IN (its titles are that language's): the caller's `lang`, or the one the
 * path pins — `/` and `/vi`, every explorer view on eno.vn. With neither, nothing is kept: a guess could hand one
 * language's titles to the other language's reader.
 */
export function rememberPageState(state: PageState, opts: { lang?: string } = {}): void {
  if (state.kind === 'explorer' && state.total === null) return
  const url = pageUrl(state.href)
  const lang = opts.lang ?? (url && pinnedVariant(url.pathname))
  if (!lang) return
  const plan = planFor(state.href, lang)
  if ('key' in plan) remember(plan.key, Promise.resolve(structuredClone(state)), Date.now())
}

/** Tests only — the cache is process-wide. */
export function resetPageStateCache(): void {
  cache.clear()
}

function planFor(href: string, lang: string): Plan {
  const url = pageUrl(href)
  if (!url) return { answer: other('', 'Page: unknown') }
  // The language the page is RENDERED in: `/` and `/vi` pin it (lang-pinned.ts), every other path follows the reader.
  const pageLang: Lang = (pinnedVariant(url.pathname) ?? lang) === 'vi' ? 'vi' : 'en'
  const pathOnly = `Page: ${clip(url.pathname, 200)}`
  if (stripViPrefix(url.pathname) === '/') {
    const e = settle(url.search)
    const params = feedParams(e, pageLang)
    return {
      // The request itself is the key: every URL the explorer reads the same way (another param order, a utm tag, a view)
      // is one entry. Its `lang` keeps the two languages' titles apart.
      key: `explorer ${params}`,
      read: () => readExplorer(href, e, params, pageLang),
      meanwhile: explorerState(href, e, null, [], null),
    }
  }
  const listing = LISTING_PATH.exec(url.pathname)
  if (listing) {
    const id = listing[1]
    return { key: `listing ${pageLang} ${id}`, read: () => readListing(href, id, pathOnly, pageLang), meanwhile: other(href, pathOnly) }
  }
  return { answer: other(href, pathOnly) }
}

/**
 * The page's URL when `href` is a same-origin relative path, else null. ⛔ A PATH, NEVER A URL: one leading '/', no '//'
 * (protocol-relative), no backslash (a browser reads '\' as '/'), no whitespace or control character, at most 2,000
 * characters — and still on the base origin once parsed.
 */
function pageUrl(href: string): URL | null {
  if (href.length > HREF_MAX || !href.startsWith('/') || href.startsWith('//') || /[\\\s\u0000-\u001f\u007f]/.test(href)) return null
  try {
    const url = new URL(href, BASE)
    return url.origin === BASE ? url : null
  } catch {
    return null
  }
}

function settle(search: string): Explorer {
  const url = readExplorerUrl(search)
  const province = provinceByCode(url.province)
  return {
    url,
    province,
    ward: province ? wardOf(province.code, url.ward) : null,
    district: districtAfterProvinceChange(province?.code, url.district),
  }
}

type Unit = { code: string; wards: AreaGeo[] }
/** A `?ward=` code inside its province, from the dataset /api/geo hands the explorer (data/vn-units.json). */
function wardOf(provinceCode: string, wardCode: string): AreaGeo | null {
  if (!wardCode) return null
  return (vnUnits as Unit[]).find((p) => p.code === provinceCode)?.wards.find((w) => w.code === wardCode) ?? null
}

/**
 * ⛔ THE REQUEST THE EXPLORER ITSELF SENDS FOR THAT STATE — listings-explorer.tsx `baseParamsString` + `fetchFeedPage`,
 * branch for branch — so `total` is the number on the screen:
 *   · a brand with neither a model nor a subcategory BOOSTS its category (`priorityCategory`) instead of filtering by it;
 *   · province and ward travel as their ENGLISH NAMES (province-match.ts matches the row's text; a code matches nothing);
 *   · a facet the view does not offer is dropped by the explorer's own writer (applyFilterParams).
 * Then the first five rows (the diversity window's first five are the screen's), no facet counts (`facets=0`: the six
 * aggregates are the slow half and nothing here reads them) and `lang` en/vi, so no title translation is fetched.
 * ⚠️ NOT MIRRORED, BECAUSE NO URL SAYS THEM: a "near you" circle (never in the URL) and the brand-heal fetch a bare
 * `?brand=` triggers. (The explorer's zero-result spelling retry, `spell=1`, lives in route.ts GET, not in
 * buildFeedPayload — readExplorer repeats it.)
 */
function feedParams(e: Explorer, lang: Lang): URLSearchParams {
  const s = e.url
  const p = new URLSearchParams()
  if (s.subcategory !== 'all') p.set('subcategory', s.subcategory)
  if (s.brand !== 'all') {
    p.set('brand', s.brand)
    if (s.line) p.set('line', s.line)
    if (s.model !== 'all') {
      p.set('model', s.model)
      if (s.category !== 'all') p.set('category', s.category)
    } else if (s.category !== 'all') {
      p.set(s.subcategory !== 'all' ? 'category' : 'priorityCategory', s.category)
    }
  } else if (s.category !== 'all') {
    p.set('category', s.category)
  }
  if (e.district !== 'all') p.set('district', e.district)
  if (e.province) p.set('province', e.province.nameEn)
  if (e.ward) p.set('ward', e.ward.nameEn)
  if (s.condition !== 'all') p.set('condition', s.condition)
  if (s.goodPrice) p.set('deal', 'good')
  if (s.listingType !== 'all') p.set('type', s.listingType)
  const q = s.query.trim()
  if (q) p.set('q', q)
  if (s.looseMatch && q) p.set('match', 'any')
  p.set('sort', s.sort)
  if (s.priceRange !== 'all') {
    const [min, max] = s.priceRange.split('-')
    if (min) p.set('priceMin', min)
    if (max) p.set('priceMax', max)
  }
  applyFilterParams(p, s.customFilters, s.category, s.subcategory)
  p.set('limit', String(CARD_COUNT))
  p.set('offset', '0')
  p.set('facets', '0')
  p.set('lang', lang)
  return p
}

/**
 * The view's filters in the CATALOG's words (types.ts ConciergeAction.filters): the facet values as the explorer holds
 * them (a range facet as `min-max`), then the place, the price band, sort, condition and intent — each only when it is
 * not the default. Brand, model, a ward and "good price" are not catalog words; the summary names them.
 */
function catalogFilters(e: Explorer): Record<string, string> {
  const s = e.url
  const f: Record<string, string> = { ...s.customFilters }
  if (e.district !== 'all') f.district = e.district
  if (e.province) f.province = e.province.code
  if (s.priceRange !== 'all') {
    const [min, max] = s.priceRange.split('-')
    if (/^\d+$/.test(min)) f.priceMin = min
    if (/^\d+$/.test(max)) f.priceMax = max
  }
  if (s.sort !== 'newest') f.sort = s.sort
  if (s.condition !== 'all') f.condition = s.condition
  if (s.listingType !== 'all') f.type = s.listingType
  return f
}

async function readExplorer(href: string, e: Explorer, params: URLSearchParams, lang: Lang): Promise<PageState | null> {
  try {
    let { body } = await buildFeedPayload(new URLSearchParams(params))
    /**
     * ⛔ THE EXPLORER ASKS WITH `spell=1` WHENEVER THERE IS A SEARCH (listings-explorer.tsx `spellOn`): a search that finds
     * nothing is answered for its likely spelling, beside "Showing results for …". route.ts GET's rule, step for step, so
     * the count is the screen's (commit review, codex: "iphnoe" read 0 here and the guide offered to widen a full page).
     */
    let corrected: string | null = null
    const q = params.get('q')?.trim()
    if (body.total === 0 && q && !inferDistrictFromQuery(q)) {
      const fixed = await correctQuery(q)
      if (fixed && fixed !== fold(q)) {
        const retry = new URLSearchParams(params)
        retry.set('q', fixed)
        const answer = (await buildFeedPayload(retry)).body
        if (answer.total > 0) {
          body = answer
          corrected = fixed
        }
      }
    }
    const rows = Array.isArray(body.listings) ? (body.listings as SerializedListingCard[]).slice(0, CARD_COUNT) : []
    const inferred = typeof body.inferredDistrict === 'string' ? body.inferredDistrict : null
    return explorerState(href, e, body.total, await describe(rows, lang), inferred, corrected)
  } catch (err) {
    logError(err, { op: 'concierge.page-state' })
    return null
  }
}

/**
 * `told` is the page's first rows in order — a card, or null for one that is counted but not described — so the summary
 * keeps the screen's numbering ("the second one" is the second card on the screen).
 */
function explorerState(href: string, e: Explorer, total: number | null, told: (PageCard | null)[], inferredDistrict: string | null, corrected: string | null = null): PageState {
  const s = e.url
  const filters = catalogFilters(e)
  const parts = ['Explorer', s.category === 'all' ? 'all categories' : `category ${clip(s.category, 40)}`]
  if (s.subcategory !== 'all') parts.push(`subcategory ${clip(s.subcategory, 40)}`)
  const named = Object.entries(filters).map(([k, v]) => `${k}=${clip(v, 40)}${k === 'province' && e.province ? ` (${e.province.nameEn})` : ''}`)
  if (named.length) parts.push(`filters ${named.join(', ')}`)
  if (e.ward) parts.push(`ward ${e.ward.nameEn}`)
  // The feed applied a district it read out of the search words (district-query.ts); the screen shows it as a chip.
  if (inferredDistrict) parts.push(`district ${clip(inferredDistrict, 30)} read from the search words`)
  if (s.brand !== 'all') parts.push(`brand ${clip([s.brand, s.model === 'all' ? '' : s.model, s.line].filter(Boolean).join(' '), 60)}`)
  if (s.goodPrice) parts.push('good prices only')
  const search = s.query.trim()
  if (search) parts.push(`search "${clip(search, 60)}"`)
  if (corrected) parts.push(`nothing found as typed — the screen shows the results for "${clip(corrected, 60)}"`)
  parts.push(total === null ? 'results not counted' : `${total} ${total === 1 ? 'result' : 'results'}`)
  const keep: Record<string, string> = {}
  if (s.brand !== 'all') {
    keep.brand = s.brand
    if (s.model !== 'all') keep.model = s.model
    if (s.line) keep.line = s.line
  }
  if (s.goodPrice) keep.deal = 'good'
  // "Any of the words" (visual search lands with it): a refine keeps it, or "cheapest first" would match every word
  // (review round 3, codex).
  if (s.looseMatch) keep.match = 'any'
  if (e.ward && s.ward) keep.ward = s.ward
  return {
    href,
    kind: 'explorer',
    category: s.category === 'all' ? null : s.category,
    subcategory: s.subcategory === 'all' ? null : s.subcategory,
    filters,
    search,
    keep,
    total,
    cards: told.filter((c): c is PageCard => c !== null),
    summary: fit([...parts, ...told.map((c, i) => `${i + 1}) ${c ? cardLine(c) : '(not described)'}`)]),
  }
}

/** `pathOnly`: the summary of the page as its path alone — what a listing the public cannot open here reads as. */
async function readListing(href: string, id: string, pathOnly: string, lang: Lang): Promise<PageState | null> {
  try {
    const row = await db.listing.findFirst({
      // ⛔ ONLY A LISTING THE PUBLIC CAN OPEN ON THIS EDITION — live, published, outside eno's own desk on eno.vn — with
      // teachers in (`teachers: true`): a teacher's profile IS a listing page.
      where: await scopedListingWhere({ id, verified: true, status: 'active' }, { teachers: true }),
      select: { ...LISTING_CARD_SELECT, facetTokens: true, teacherProfile: { select: { hideFromSearch: true } } },
    })
    if (!row) return other(href, pathOnly)
    const card = serializeListingCard(row)
    const head = `Listing page · ${clip(card.category.name, 40)}`
    const page = { href, kind: 'listing' as const, category: null, subcategory: null, filters: {}, search: '', total: null }
    if (withheld(card, row)) return { ...page, cards: [], summary: `${head} · (not described)` }
    const told = pageCard(card, row, lang)
    return { ...page, cards: [told], summary: fit([head, cardLine(told)]) }
  } catch (err) {
    logError(err, { op: 'concierge.page-state' })
    return null
  }
}

/** The rows' cards, in order, with null for a row that is counted but never described (`withheld`). */
async function describe(rows: SerializedListingCard[], lang: Lang): Promise<(PageCard | null)[]> {
  const extras = await rowExtras(rows.map((r) => r.id))
  return rows.map((r) => {
    const extra = extras?.get(r.id)
    return withheld(r, extra) ? null : pageCard(r, extra, lang)
  })
}

/**
 * The cards' own rows, one read by id (the card projection carries neither a teacher's search choice nor the facet values).
 * Null when the read fails: every teacher card is then withheld (`withheld` fails closed) and the rest keep their card facts.
 */
async function rowExtras(ids: string[]): Promise<Map<string, RowExtra> | null> {
  if (!ids.length) return new Map()
  try {
    const rows = await db.listing.findMany({
      // The rows came from the scoped feed; the read is scoped all the same, so it can never describe more than the page.
      where: await scopedListingWhere({ id: { in: ids } }, { teachers: true }),
      select: { id: true, attributes: true, facetTokens: true, teacherProfile: { select: { hideFromSearch: true } } },
    })
    return new Map(rows.map((r) => [r.id, r] as const))
  } catch (err) {
    logError(err, { op: 'concierge.page-state' })
    return null
  }
}

/**
 * ⛔ COUNTED, NEVER DESCRIBED: the owner's demo teacher profile (constants.ts — "not a teacher a school can hire"), a
 * teacher who asked search engines not to list them, and a teacher whose profile row could not be read (fail closed).
 */
function withheld(card: SerializedListingCard, extra: RowExtra | undefined): boolean {
  if ((HOME_HIDDEN_TEACHER_LISTING_IDS as readonly string[]).includes(card.id)) return true
  return card.listingType === TEACHER_LISTING_TYPE && extra?.teacherProfile?.hideFromSearch !== false
}

function pageCard(card: SerializedListingCard, extra: RowExtra | undefined, lang: Lang): PageCard {
  return { id: card.id, title: cardTitle(card, lang), price: spokenPrice(card), place: cardPlace(card), facts: cardFacts(card, extra) }
}

/** One card in the summary; the id is there so a `listing` action can name it (actions take ids from this turn's PAGE). */
const cardLine = (c: PageCard): string => [c.title, c.price, c.place, c.facts.join(', '), `id ${c.id}`].filter(Boolean).join(' — ')

/**
 * The title the page prints: a teacher's name as stored (a name is never translated — listing-card.tsx), anything else in
 * the Vietnamese column on a Vietnamese page when it has one. Collapsed to one line and cut to 80 characters: it is the
 * poster's own text, and it reaches the prompt only as data.
 */
function cardTitle(card: SerializedListingCard, lang: Lang): string {
  return clip(card.listingType !== TEACHER_LISTING_TYPE && lang === 'vi' && card.titleVi ? card.titleVi : card.title, TITLE_MAX)
}

/**
 * The card's price as words the voice can say — through vnd.ts, never hand-formatted (root CLAUDE.md "Money").
 * ⛔ A TEACHER'S ONLY FIGURE IS THE EXPECTED MONTHLY SALARY, AND IT SAYS SO: a parent must not hear it as a lesson price
 * (plan §1). The other figure a teacher card can carry is the cover rate an hour (profile.ts teacherCardPriceFromSaved) —
 * cover is a school's arrangement (first-message.ts) — so that card reads "teacher profile", like a card with no figure.
 */
function spokenPrice(card: SerializedListingCard): string {
  const unit = priceUnitSuffix(card.priceUnit)
  if (card.listingType === TEACHER_LISTING_TYPE) {
    return card.price > 0 && unit === 'month' ? `expected salary ${money(card)}/month` : 'teacher profile'
  }
  if (card.price <= 0) return card.listingType === 'job' ? 'salary not stated' : 'free'
  // A partner booking's figure is the lowest ticket; the card says "from" (types.ts isPartnerBooking).
  return `${card.isPartnerBooking ? 'from ' : ''}${money(card)}${unit ? `/${unit}` : ''}`
}

const money = (card: { price: number; currency: string }): string =>
  card.currency === '₫' ? vndWords(card.price, 'en') : formatMoneyFull(card.price, card.currency, 'en')

/**
 * District and city as the card's row holds them, in English: a curated HCMC district by its English name
 * (district-canonical.ts), any other place unaccented; the place line itself when the row has neither (a teacher abroad).
 * A teacher's place is where they LIVE — "can teach in" is the workIn filter — so it says so.
 */
function cardPlace(card: SerializedListingCard): string {
  const district = card.district?.trim() ? districtLabel(canonicalDistrictSlug(card.district), card.district.trim()).en : ''
  const city = card.city?.trim() ? (isHcmc(card.city) ? 'HCMC' : unaccent(card.city.trim())) : ''
  const place = clip([district, city].filter(Boolean).join(', ') || unaccent(card.location), 60)
  return place && card.listingType === TEACHER_LISTING_TYPE ? `home: ${place}` : place
}

/**
 * The shelves whose cards show little: their facts come from the row's own facet values — public, they are what the
 * explorer filters on — in the order they are said.
 */
const FACT_FACETS: Readonly<Record<string, readonly string[]>> = {
  teachers: ['native', 'experience'],
  rentals: ['bedrooms', 'furnishing', 'rentalPeriod'],
  jobs: ['jobtype', 'workMode'],
}

/** Up to three public facts, each labelled the way the filter chips label it (taxonomy.ts), then what the card shows. */
function cardFacts(card: SerializedListingCard, extra: RowExtra | undefined): string[] {
  const facets = facetsFor(card.category.slug, card.subcategorySlug ?? null)
  const bag = attributeBag(extra?.attributes)
  const out: string[] = []
  for (const key of FACT_FACETS[card.category.slug] ?? []) {
    const facet = facets.find((f) => f.key === key)
    const stored = bag?.[key]
    const value = typeof stored === 'string' || typeof stored === 'number' ? String(stored) : facetValues(extra?.facetTokens, key)[0]
    if (facet && value) out.push(`${facet.label}: ${facet.options.find((o) => o.value === value)?.label ?? value}`)
  }
  if (card.identityMark) out.push('Identity verified')
  if (card.condition) out.push(`Condition: ${card.condition}`)
  const brand = [card.brandSlug, card.model].filter(Boolean).join(' ')
  if (brand) out.push(`Brand: ${brand}`)
  if (card.goodPrice) out.push('Good price')
  return out.slice(0, 3).map((f) => clip(f, 60))
}

function other(href: string, summary: string): PageState {
  return { href, kind: 'other', category: null, subcategory: null, filters: {}, search: '', total: null, cards: [], summary }
}

/**
 * Poster, importer or URL text as one line: control characters and runs of whitespace collapsed to one space, cut to `max`
 * with an ellipsis (cutText never splits a surrogate pair). It reaches the prompt only as data, inside the brain's markers.
 */
function clip(text: string, max: number): string {
  const flat = text.replace(/[\s\u0000-\u001f\u007f]+/g, ' ').trim()
  return flat.length > max ? `${cutText(flat, max - 1).trimEnd()}…` : flat
}

/** The parts joined with " · ", as many whole parts as fit in SUMMARY_MAX characters; "…" says the rest was left out. */
function fit(parts: string[]): string {
  let out = ''
  for (const part of parts) {
    const next = out ? `${out} · ${part}` : part
    if (next.length > SUMMARY_MAX - 4) return out ? `${out} · …` : `${cutText(part, SUMMARY_MAX - 1)}…`
    out = next
  }
  return out
}

/** Reads keyed by what the page shows, for CACHE_MS; at most CACHE_MAX, the oldest dropped first. An in-flight read is
 *  shared too, so a turn that lands while the last turn's read is still running waits for it rather than starting another. */
const cache = new Map<string, { at: number; state: Promise<PageState | null> }>()

function fresh(key: string, now: number): Promise<PageState | null> | null {
  const hit = cache.get(key)
  if (hit && now - hit.at < CACHE_MS) return hit.state
  if (hit) cache.delete(key)
  return null
}

function remember(key: string, state: Promise<PageState | null>, now: number): void {
  cache.delete(key) // re-inserted as the newest
  cache.set(key, { at: now, state })
  for (const oldest of cache.keys()) {
    if (cache.size <= CACHE_MAX) break
    cache.delete(oldest)
  }
  // A read that failed is forgotten at once, so the next turn asks again (a read never rejects: it resolves null).
  void state.then((s) => {
    if (!s && cache.get(key)?.state === state) cache.delete(key)
  })
}

/** The read, or null once `ms` have passed. The read itself carries on, into the cache, for the next turn. */
function within(state: Promise<PageState | null>, ms: number): Promise<PageState | null> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const late = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), ms)
  })
  return Promise.race([state, late]).finally(() => clearTimeout(timer))
}
