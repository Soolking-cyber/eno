import { describe, expect, it } from 'vitest'
import { canonicalFacetValue, editFormAttributes, isMultiFacetKey, multiFacetPicks, multiFacetValue, multiFacetValues, removeMultiFacetValue, sellerFacetTokens, sellerMultiFacets, toggleMultiFacetValue } from './multi-facet'
import { TAXONOMY, askableFacetsFor, facetsFor, isRequiredFacet, typesFor } from './taxonomy'
import { buildFacetTokens, parseFacetTokens } from './facet-tokens'
// The listing page's own gate and list — what "shown" means for a seller's picks.
import { amenityOptions, rentalFactsApply } from './rental-facts'

/**
 * The one reading of a multi-select facet's value (amenities — GoPlus partnership, 2026-10-19). Every reader of
 * `attr_amenities` goes through these functions; what is pinned here is what the feed, the counts, the Filter panel and
 * the explorer's URL all agree on.
 */
describe('multi-facet', () => {
  it('knows the apartment amenities facet as the multi one — and no single-select facet', () => {
    expect(isMultiFacetKey('amenities')).toBe(true)
    for (const k of ['bedrooms', 'furnishing', 'aptType', 'posted', 'hasVideo', 'video', 'size']) expect(isMultiFacetKey(k)).toBe(false)
    expect(facetsFor('rentals', 'apartment-rental').find((f) => f.key === 'amenities')?.multi).toBe(true)
  })

  it('reads a comma list in TAXONOMY order, deduplicated and trimmed — one search, one value', () => {
    expect(multiFacetValues('amenities', 'car-alley,no-landlord')).toEqual(['no-landlord', 'car-alley'])
    expect(multiFacetValues('amenities', ' pets , pets,no-landlord ')).toEqual(['no-landlord', 'pets'])
    expect(multiFacetValue('amenities', ['car-alley', 'no-landlord'])).toBe('no-landlord,car-alley')
  })

  it('drops unknown parts and never errors — a list with nothing valid left is no filter', () => {
    expect(multiFacetValues('amenities', 'no-landlord,jacuzzi')).toEqual(['no-landlord'])
    expect(multiFacetValues('amenities', 'jacuzzi')).toEqual([])
    expect(multiFacetValues('amenities', '')).toEqual([])
    expect(multiFacetValues('amenities', null)).toEqual([])
    expect(multiFacetValues('amenities', 'all')).toEqual([])
    expect(multiFacetValue('amenities', ['jacuzzi'])).toBeNull()
    // A token delimiter can never ride in: only taxonomy slugs survive.
    expect(multiFacetValues('amenities', 'no-landlord|size:m')).toEqual([])
    // Not a multi key → nothing (callers read a single facet's value as given).
    expect(multiFacetValues('bedrooms', '2')).toEqual([])
  })

  it('toggles one pick in and out, the last one out clearing the facet', () => {
    expect(toggleMultiFacetValue('amenities', null, 'car-alley')).toBe('car-alley')
    expect(toggleMultiFacetValue('amenities', 'car-alley', 'no-landlord')).toBe('no-landlord,car-alley')
    expect(toggleMultiFacetValue('amenities', 'no-landlord,car-alley', 'no-landlord')).toBe('car-alley')
    expect(toggleMultiFacetValue('amenities', 'car-alley', 'car-alley')).toBeNull()
  })

  it('canonicalises a multi value and passes any other facet value through as given', () => {
    expect(canonicalFacetValue('amenities', 'car-alley,no-landlord,bogus')).toBe('no-landlord,car-alley')
    expect(canonicalFacetValue('amenities', 'bogus')).toBeNull()
    expect(canonicalFacetValue('bedrooms', '2')).toBe('2')
  })

  // Reviewer catches (2026-10-19): an active chip's ✕ must be idempotent, and "Has video" has one meaningful value.
  it('removes a pick idempotently — a ✕ delivered twice never puts it back', () => {
    expect(removeMultiFacetValue('amenities', 'no-landlord,car-alley', 'no-landlord')).toBe('car-alley')
    expect(removeMultiFacetValue('amenities', 'car-alley', 'no-landlord')).toBe('car-alley')
    expect(removeMultiFacetValue('amenities', 'car-alley', 'car-alley')).toBeNull()
    expect(removeMultiFacetValue('amenities', null, 'car-alley')).toBeNull()
  })

  it('keeps "Has video" only as its one meaningful value — anything else is no filter, so no chip', () => {
    expect(canonicalFacetValue('hasVideo', 'yes')).toBe('yes')
    expect(canonicalFacetValue('hasVideo', 'maybe')).toBeNull()
    expect(canonicalFacetValue('hasVideo', '')).toBeNull()
  })

  // A reviewer's catch (2026-10-19): `multi` is looked up BY KEY (isMultiFacetKey), so a second, single-select facet
  // that reused a multi key elsewhere in the taxonomy would have its values read as an unknown list and silently
  // dropped. Pin that no other facet shares a multi facet's key.
  it('no single-select facet anywhere shares a multi facet\'s key', () => {
    const byKey = new Map<string, boolean[]>()
    for (const c of TAXONOMY) for (const f of c.facets) byKey.set(f.key, [...(byKey.get(f.key) ?? []), !!f.multi])
    for (const [key, flags] of byKey) if (flags.some(Boolean)) expect(flags.every(Boolean), key).toBe(true)
    expect(isMultiFacetKey('amenities')).toBe(true)
  })

  it('keeps every value a token can carry — the taxonomy slug shape facetTokens accepts', () => {
    const opts = facetsFor('rentals', 'apartment-rental').find((f) => f.key === 'amenities')!.options
    for (const o of opts) expect(o.value).toMatch(/^[a-z0-9][a-z0-9-]*$/)
    // GoPlus's two headline filters lead the chip row.
    expect(opts.slice(0, 2).map((o) => o.value)).toEqual(['no-landlord', 'car-alley'])
    // The four values the classifier wrote before 2026-10-19 keep their spelling (src/lib/apartment-classify.ts).
    for (const v of ['balcony', 'pool', 'gym', 'pets']) expect(opts.some((o) => o.value === v)).toBe(true)
  })
})

/**
 * THE SELLER'S SIDE (owner, 2026-10-20: "also add those filter chips when someone posts in our app"). The post form asks
 * the apartment amenities; `sellerFacetTokens` is the one public writer of `facetTokens` (facet-tokens.ts). Pinned here:
 * optional, asked only on apartments for rent (never a Wanted ad — what is asked is what the page lists), the listing's OWN
 * facet's values only (no typed character reaches a token), only what the body names is replaced, every other token kept,
 * a move out (another shelf, or Rent → Wanted) drops the picks.
 */
const APT = { categorySlug: 'rentals', subcategorySlug: 'apartment-rental', listingType: 'rent' }
const amenities = facetsFor('rentals', 'apartment-rental').find((f) => f.key === 'amenities')!
const pairs = (t: string | null | undefined) => parseFacetTokens(t).map((p) => `${p.key}:${p.value}`)

describe('multi-facet — the seller’s picks (post form, 2026-10-20)', () => {
  it('asks the amenities on an apartment for rent only — optional, multi, never derived', () => {
    expect(sellerMultiFacets('rentals', 'apartment-rental', 'rent').map((f) => f.key)).toEqual(['amenities'])
    expect(askableFacetsFor('rentals', 'apartment-rental').some((f) => f.key === 'amenities')).toBe(true)
    expect(amenities.derived).toBeFalsy()
    expect(isRequiredFacet(amenities)).toBe(false)
    for (const sub of ['house-rental', 'room-rental', 'motorbike-rental', null]) expect(sellerMultiFacets('rentals', sub, 'rent'), String(sub)).toEqual([])
    for (const c of TAXONOMY) if (c.slug !== 'rentals') for (const s of [null, ...c.subcategories.map((x) => x.slug)]) for (const t of typesFor(c.slug)) expect(sellerMultiFacets(c.slug, s, t)).toEqual([])
  })

  // Reviewer's catch, 2026-10-20: a Wanted ad's picks filtered in browse (the feed has no default intent) while its page,
  // which lists amenities on a rent ad only, never mentioned them.
  it('⛔ never of a "Looking to rent" (wanted) ad — nor of an ad whose intent is unknown', () => {
    for (const t of ['wanted', '', null, undefined]) expect(sellerMultiFacets('rentals', 'apartment-rental', t), String(t)).toEqual([])
  })

  it('⛔ ASKED ⇒ LISTED: every pick the form can store on any (category, subcategory, intent) is one the listing page lists', () => {
    let asked = 0
    for (const c of TAXONOMY) {
      for (const s of [null, ...c.subcategories.map((x) => x.slug)]) {
        for (const t of typesFor(c.slug)) {
          for (const f of sellerMultiFacets(c.slug, s, t)) {
            asked++
            const where = `${c.slug}/${s}/${t}/${f.key}`
            // The page's gate (every listing is priced in đồng — taxonomy.ts listingMoneyFor)…
            expect(rentalFactsApply({ categorySlug: c.slug, subcategorySlug: s, listingType: t, currency: '₫' }), where).toBe(true)
            // …and its list: a row holding every option shows every option.
            const all = f.options.map((o) => o.value)
            expect(amenityOptions(buildFacetTokens({ [f.key]: all }), c.slug, s).map((o) => o.value), where).toEqual(all)
          }
        }
      }
    }
    expect(asked).toBe(1) // rentals › apartment-rental › rent › amenities, today
  })

  it('⛔ a flat with its OWN washing machine has a true chip — GoPlus’s building-wide `washer` still says "shared"', () => {
    const option = (v: string) => amenities.options.find((o) => o.value === v)
    expect(option('private-washer')).toEqual({ value: 'private-washer', label: 'Private washing machine', labelVi: 'Máy giặt riêng' })
    expect(option('washer')).toEqual({ value: 'washer', label: 'Shared washing machine', labelVi: 'Máy giặt chung' })
    expect(sellerFacetTokens(null, { amenities: ['washer', 'private-washer'] }, APT)).toBe('|amenities:private-washer|amenities:washer|')
  })

  it('reads an array or a comma list as THE FACET’S OWN option values: trimmed, deduped, in taxonomy order', () => {
    expect(multiFacetPicks(amenities, ['car-alley', 'no-landlord', 'car-alley'])).toEqual(['no-landlord', 'car-alley'])
    expect(multiFacetPicks(amenities, ' pets , no-landlord ')).toEqual(['no-landlord', 'pets'])
    expect(multiFacetPicks(amenities, '')).toEqual([])
  })

  it('⛔ drops everything that is not one of those options — free text, delimiters, other shelves’ values, non-strings', () => {
    expect(multiFacetPicks(amenities, ['pool|size:m', 'pool:x', 'jacuzzi', 'Pool', 'm', '2', 7, null, { pool: 1 }, ['gym']])).toEqual([])
    expect(multiFacetPicks(amenities, 'no-landlord|amenities:pool')).toEqual([])
    expect(multiFacetPicks(amenities, 42)).toEqual([])
    expect(multiFacetPicks(amenities, { 0: 'pool' })).toEqual([])
    // What comes out is the taxonomy's own string, whatever went in.
    for (const v of multiFacetPicks(amenities, amenities.options.map((o) => ` ${o.value} `))) expect(amenities.options.some((o) => o.value === v)).toBe(true)
  })

  it('opens the edit form on the stored picks — from the tokens, in taxonomy order, other answers as they are', () => {
    const tokens = '|rentalPeriod:weekly|amenities:car-alley|amenities:no-landlord|amenities:jacuzzi|'
    expect(editFormAttributes({ bedrooms: '2' }, tokens, 'rentals', 'apartment-rental', 'rent')).toEqual({ bedrooms: '2', amenities: 'no-landlord,car-alley' })
    expect(editFormAttributes({ bedrooms: '2' }, null, 'rentals', 'apartment-rental', 'rent')).toEqual({ bedrooms: '2' })
    // A shelf that does not ask the facet opens with none of it.
    expect(editFormAttributes({ bedrooms: '3' }, '|amenities:pool|', 'rentals', 'house-rental', 'rent')).toEqual({ bedrooms: '3' })
  })

  // codex, 2026-10-20: a legacy Wanted ad's picks are wishes — switched to Rent, they must not come back pressed as facts.
  it('⛔ a Wanted ad opens with no picks — not from its tokens, not from `attributes`', () => {
    expect(editFormAttributes({ bedrooms: '2' }, '|amenities:pool|rentalPeriod:weekly|', 'rentals', 'apartment-rental', 'wanted')).toEqual({ bedrooms: '2' })
    expect(editFormAttributes({ bedrooms: '2', amenities: 'gym' }, null, 'rentals', 'apartment-rental', 'wanted')).toEqual({ bedrooms: '2' })
  })

  // Reviewer's catch, 2026-10-20: browse matches such a value in `attributes` (attr-match.ts reads both columns). Opened
  // without it, the form sent `amenities: []`, sanitizeAttributes dropped the key, and one untouched save un-matched the row.
  it('⛔ carries a VALID pick an older write left in `attributes` into the picks — so the first save moves it to the tokens', () => {
    const tokens = '|amenities:car-alley|'
    expect(editFormAttributes({ bedrooms: '2', amenities: 'gym' }, tokens, 'rentals', 'apartment-rental', 'rent')).toEqual({ bedrooms: '2', amenities: 'car-alley,gym' })
    expect(editFormAttributes({ bedrooms: '2', amenities: 'pool, no-landlord' }, null, 'rentals', 'apartment-rental', 'rent')).toEqual({ bedrooms: '2', amenities: 'no-landlord,pool' })
    // Anything that is not one of the facet's options stays out (and the key is never carried as a single answer).
    expect(editFormAttributes({ bedrooms: '2', amenities: 'jacuzzi|size:m' }, null, 'rentals', 'apartment-rental', 'rent')).toEqual({ bedrooms: '2' })
    expect(editFormAttributes({ bedrooms: '3', amenities: 'pool' }, null, 'rentals', 'house-rental', 'rent')).toEqual({ bedrooms: '3' })
  })

  it('a stored JSON `null` (or any non-object) opens as no answers — never a crash of the edit page', () => {
    expect(editFormAttributes(null, '|amenities:pool|', 'rentals', 'apartment-rental', 'rent')).toEqual({ amenities: 'pool' })
    expect(editFormAttributes(null, null, 'rentals', 'house-rental', 'rent')).toEqual({})
    expect(editFormAttributes(['pool'] as unknown as Record<string, string>, null, 'rentals', 'apartment-rental', 'rent')).toEqual({})
  })
})

describe('sellerFacetTokens — the one public writer of facetTokens', () => {
  it('a create stores the picks in taxonomy order, and nothing when none is named or valid', () => {
    expect(sellerFacetTokens(null, { bedrooms: '2', amenities: ['car-alley', 'no-landlord'] }, APT)).toBe('|amenities:no-landlord|amenities:car-alley|')
    expect(sellerFacetTokens(null, { amenities: 'pets,wifi' }, APT)).toBe('|amenities:pets|amenities:wifi|')
    expect(sellerFacetTokens(null, { bedrooms: '2' }, APT)).toBeUndefined()
    expect(sellerFacetTokens(null, { amenities: [] }, APT)).toBeUndefined()
    expect(sellerFacetTokens(null, undefined, APT)).toBeUndefined()
  })

  it('⛔ no seller-typed character reaches a token — only the facet’s own slugs', () => {
    const t = sellerFacetTokens(null, { amenities: ['pool', 'gym|coverArea:quan-1', 'wifi:x', 'size:m', '"pool"', 'no-landlord,|x|'] }, APT)
    expect(t).toBe('|amenities:pool|')
    for (const p of parseFacetTokens(t)) expect(amenities.options.map((o) => o.value)).toContain(p.value)
  })

  it('⛔ a subcategory without the facet writes none — on a create, whatever is sent', () => {
    for (const sub of ['house-rental', 'room-rental', 'car-rental']) {
      expect(sellerFacetTokens(null, { amenities: ['pool', 'no-landlord'] }, { categorySlug: 'rentals', subcategorySlug: sub, listingType: 'rent' }), sub).toBeUndefined()
    }
    expect(sellerFacetTokens(null, { amenities: ['pool'] }, { categorySlug: 'electronics', subcategorySlug: 'phones-tablets', listingType: 'sell' })).toBeUndefined()
  })

  it('⛔ a "Looking to rent" create writes none, whatever is sent — its page would never list them', () => {
    expect(sellerFacetTokens(null, { amenities: ['pool', 'gym', 'no-landlord'] }, { ...APT, listingType: 'wanted' })).toBeUndefined()
    expect(sellerFacetTokens(null, { amenities: 'pool' }, { ...APT, listingType: 'wanted' })).toBeUndefined()
  })

  it('⛔ an edit Rent → Wanted drops the picks, named or not — every other token stays; Wanted → Rent takes what is named', () => {
    const toWanted = { ...APT, listingType: 'wanted' }
    const wasRent = { subcategorySlug: 'apartment-rental', listingType: 'rent' }
    expect(sellerFacetTokens('|amenities:pool|rentalPeriod:weekly|', undefined, toWanted, wasRent)).toBe('|rentalPeriod:weekly|')
    expect(sellerFacetTokens('|amenities:pool|', { amenities: ['gym'] }, toWanted, wasRent)).toBeNull()
    // A Wanted row edited as Wanted: nothing of it is the form's — the column is left exactly as it is…
    const wasWanted = { subcategorySlug: 'apartment-rental', listingType: 'wanted' }
    expect(sellerFacetTokens('|rentalPeriod:weekly|', { amenities: ['gym'] }, toWanted, wasWanted)).toBeUndefined()
    // …⛔ unless it still carries picks (a legacy row — codex, 2026-10-20): they go on any save, named or not, the rest kept.
    expect(sellerFacetTokens('|amenities:pool|rentalPeriod:weekly|', undefined, toWanted, wasWanted)).toBe('|rentalPeriod:weekly|')
    expect(sellerFacetTokens('|amenities:pool|', { amenities: ['gym'] }, toWanted, wasWanted)).toBeNull()
    // …and a legacy Wanted ad turned Rent by an edit that never names the facet (an /api/v1 PATCH): its wishes are not
    // carried over as facts (a reviewer's catch, 2026-10-20) — the form's own save names it and stores what is picked.
    expect(sellerFacetTokens('|amenities:pool|rentalPeriod:weekly|', { rentalPeriod: 'monthly' }, APT, wasWanted)).toBe('|rentalPeriod:weekly|')
    expect(sellerFacetTokens('|amenities:pool|rentalPeriod:weekly|', undefined, APT, wasWanted)).toBe('|rentalPeriod:weekly|')
    expect(sellerFacetTokens('|rentalPeriod:weekly|', undefined, APT, wasWanted)).toBeUndefined()
    // Back to Rent: the picks named are stored.
    expect(sellerFacetTokens('|rentalPeriod:weekly|', { amenities: ['gym', 'pool'] }, APT, wasWanted)).toBe('|rentalPeriod:weekly|amenities:pool|amenities:gym|')
  })

  it('⛔ an edit replaces ONLY the amenities tokens and keeps every other token — a teacher’s places, an importer’s periods', () => {
    const stored = '|coverArea:quan-1|amenities:pool|workIn:ho-chi-minh-city|rentalPeriod:weekly|amenities:gym|'
    const out = sellerFacetTokens(stored, { amenities: ['no-landlord'] }, APT)
    expect(pairs(out)).toEqual(['coverArea:quan-1', 'workIn:ho-chi-minh-city', 'rentalPeriod:weekly', 'amenities:no-landlord'])
    // Un-picking them all: the amenities go, nothing else does.
    expect(pairs(sellerFacetTokens(stored, { amenities: [] }, APT))).toEqual(['coverArea:quan-1', 'workIn:ho-chi-minh-city', 'rentalPeriod:weekly'])
    expect(pairs(sellerFacetTokens(stored, { amenities: '' }, APT))).toEqual(['coverArea:quan-1', 'workIn:ho-chi-minh-city', 'rentalPeriod:weekly'])
    expect(sellerFacetTokens('|amenities:pool|', { amenities: null }, APT)).toBeNull()
  })

  it('⛔ an edit that does not NAME the facet leaves the column exactly as it is (an API client fixing a title)', () => {
    const stored = '|amenities:pool|amenities:jacuzzi|'
    expect(sellerFacetTokens(stored, { bedrooms: '2' }, APT)).toBeUndefined()
    expect(sellerFacetTokens(stored, undefined, APT)).toBeUndefined()
    expect(sellerFacetTokens(stored, null, APT)).toBeUndefined()
    // A bag that is not a plain object names nothing (sanitizeAttributes reads only a plain object too).
    expect(sellerFacetTokens(stored, '{"amenities":["gym"]}', APT)).toBeUndefined()
    expect(sellerFacetTokens(stored, [['amenities', 'gym']], APT)).toBeUndefined()
  })

  it('re-sending the same picks — in any order — writes nothing', () => {
    expect(sellerFacetTokens('|rentalPeriod:weekly|amenities:car-alley|amenities:no-landlord|', { amenities: 'car-alley,no-landlord' }, APT)).toBeUndefined()
  })

  it('⛔ a move to a shelf that does not ask the facet drops its picks, named or not — every other token stays', () => {
    const house = { categorySlug: 'rentals', subcategorySlug: 'house-rental', listingType: 'rent' }
    const wasFlat = { subcategorySlug: 'apartment-rental', listingType: 'rent' }
    expect(sellerFacetTokens('|amenities:pool|rentalPeriod:weekly|', undefined, house, wasFlat)).toBe('|rentalPeriod:weekly|')
    expect(sellerFacetTokens('|amenities:pool|', { amenities: ['gym'] }, house, wasFlat)).toBeNull()
    // …and a move IN takes what is named.
    const wasHouse = { subcategorySlug: 'house-rental', listingType: 'rent' }
    expect(sellerFacetTokens(null, { amenities: ['gym', 'pool'] }, APT, wasHouse)).toBe('|amenities:pool|amenities:gym|')
    // A token the old shelf never asked is no answer to carry in: a move in that names nothing empties it.
    expect(sellerFacetTokens('|amenities:pool|', undefined, APT, wasHouse)).toBeNull()
    expect(sellerFacetTokens('|rentalPeriod:weekly|', undefined, APT, wasHouse)).toBeUndefined()
  })
})
