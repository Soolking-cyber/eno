import { DISTRICTS } from '@/components/marketplace/listings-explorer.constants'
import { CONCIERGE_CATEGORIES, CONCIERGE_HIDDEN_SUBCATEGORIES } from '@/lib/concierge/categories'
import { fold } from '@/lib/fold'
import { CATEGORY_BY_SLUG, facetsFor, subcategoriesFor, typesFor, type FacetDef, type RangeMeta } from '@/lib/taxonomy'
import { HCMC_DISTRICT_KEYS, HUBS, TOWN_ALIASES, isHcmcDistrict, isHub, placeLabel, provinceCodeOfKey, provinceOfPlace } from '@/lib/teachers/places'
import { VN_PROVINCES, type AreaGeo } from '@/lib/vn-areas'

/**
 * THE CONCIERGE'S CATALOG — every category, subcategory, filter key and value the voice concierge may write into an action,
 * as compact plain text for its instructions (brief.ts). Owner, 2026-10-27: "i say I need a teacher in district 1 it should
 * open right category select right filter and ask follow up question". The model never writes a URL: it writes an action
 * in THIS vocabulary, and the server checks it against the same taxonomy (actions.ts) before the page moves.
 *
 * ⛔ GENERATED, NEVER TYPED. From TAXONOMY (where a facet is offered is asked of `facetsFor`, the explorer's own rule — a
 * facet its view does not offer is dropped from the URL), the curated DISTRICTS, the teacher places and VN_PROVINCES. A
 * facet added to the taxonomy reaches the model with the next deploy; a typed copy would drift the way the electronics
 * chips once did (taxonomy.ts). The few hand-written words below say what a taxonomy label cannot (NOTES, TYPE_SPLITS,
 * SHELF_RULES, EXTRA_NAMES); catalog.test.ts pins what they print.
 * ⛔ THE SAME STRING ON EVERY CALL: it is part of the cached prompt prefix (brief.ts), which must stay byte-identical
 * between turns. No clock, and every list in a fixed order (the taxonomy's own). ⚠️ One bound moves once a year:
 * vehicles' model year ends at the taxonomy's own MAX_YEAR (next year, fixed when taxonomy.ts loads) — a new prefix after
 * a restart in January, nothing more.
 * ⛔ eno.vn ONLY: CONCIERGE_CATEGORIES (no unlinked shelf) without CONCIERGE_HIDDEN_SUBCATEGORIES (the e-Visa aisle, visa
 * runs) or a facet that lives only there; no word EDITION_BANNED matches, labels included (catalog.test.ts).
 * ⚠️ AND NO COUNSEL WORD (src/test/teachers-counsel-words.ts): the whole brief is read on teacher turns, so the eSIM
 * aisle's `foreigners` facet (its key and its label say "foreign") is left out (OMIT) — a filter nobody asks the voice for.
 * Target ≤ 3,500 tokens (catalog.test.ts measures it).
 */

/** Folded letters and digits, years and months shortened — how "does this label only spell the value out?" is asked. */
const bare = (s: string): string =>
  fold(s).replace(/\b(?:years?|yrs?)\b/g, 'y').replace(/\b(?:months?|mo)\b/g, 'm').replace(/[^a-z0-9]/g, '')

/** Combining marks in `s`: the accented spelling of a name wins over its plain twin ("Thảo Điền" over "Thao Dien"). */
const marks = (s: string): number => s.normalize('NFD').length - s.normalize('NFC').length

/**
 * ` (Label)` when the label says something the value does not — `partly (Unfurnished)`, `1024 (1 TB)` — and '' when it
 * only spells the value out (`pets` / "Pets allowed") or is a bare little word ("For", "TVs").
 */
function gloss(value: string, label: string): string {
  const v = bare(value), l = bare(label)
  if (l.length <= 3 && !/\d/.test(l)) return ''
  return l.includes(v) || v.includes(l) ? '' : ` (${label})`
}

/** Facets the model is not given: `category/key`. ⚠️ The validator would still take one; only the brief leaves it out. */
const OMIT: ReadonlySet<string> = new Set(['services/foreigners'])

/** Options never offered: the bedrooms Studio chip stays empty (a studio is `aptType=studio` — taxonomy.ts aptType). */
const HIDDEN_OPTIONS: ReadonlySet<string> = new Set(['rentals/bedrooms/0'])

/** What a key means where its taxonomy label would mislead a voice (the facet's label is shown otherwise). */
const NOTES: Readonly<Record<string, string>> = {
  'teachers/workIn': 'where they can teach',
  'teachers/salary': "the teacher's expected MONTHLY salary, stated only by teachers who want a position; never a lesson price",
  'teachers/jobType': 'what they are open to: private = regular private lessons; parttime or fulltime = a position',
  'teachers/native': 'leave it out when fluent English is fine',
  'teachers/cover': 'free to cover a class, for schools',
  'jobs/salary': 'monthly pay',
  'rentals/amenities': 'several allowed, comma-separated; a listing must have every one',
}

/**
 * The `type` key, only where it splits what a person means (offers vs. people looking); every other shelf's types stay
 * out of the model's hands. Values are checked against typesFor, so a type the taxonomy drops leaves the catalog too.
 */
const TYPE_SPLITS: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  rentals: { rent: 'places and vehicles offered', wanted: 'people looking to rent' },
  jobs: { job: 'employers hiring', wanted: 'people seeking a job' },
}

/** One line of reminders where a shelf works unlike the rest. */
const SHELF_RULES: Readonly<Record<string, string>> = {
  teachers: 'no priceMin, priceMax, district, province or price sort here: a place is workIn, a budget is salary',
  jobs: 'a place is province (a job names its city, not a district); pay is salary, not priceMin/priceMax',
}

/** The taxonomy's range units as a voice says them (its own are chip suffixes: `tr/tháng`, `m²`). */
const UNIT_WORDS: Readonly<Record<string, string>> = { 'tr/tháng': 'million dong a month', 'm²': 'square metres', L: 'litres' }
const rangeText = (r: RangeMeta): string => `range ${r.min}-${r.max}${r.unit ? ` in ${UNIT_WORDS[r.unit] ?? r.unit}` : ''}`

/** A place facet (teachers' "Can teach in", cover areas) as groups: cities, districts, provinces, then the words. */
function placeValues(f: FacetDef): string {
  const keys = f.options.map((o) => o.value)
  const hubs = keys.filter(isHub)
  const districts = keys.filter(isHcmcDistrict)
  const provinces = keys.filter((k) => provinceCodeOfKey(k) !== null)
  const words = keys.filter((k) => !isHub(k) && !isHcmcDistrict(k) && provinceCodeOfKey(k) === null)
  const city = (h: string) => (bare(h) === bare(placeLabel(h, 'en')) ? h : `${h} (${placeLabel(h, 'en')})`)
  return [
    hubs.length ? `a city: ${hubs.map(city).join(', ')}` : '',
    districts.length === HCMC_DISTRICT_KEYS.length ? 'any district key' : districts.length ? `a district: ${districts.join(', ')}` : '',
    provinces.length ? `a province: ${provinces.map((p) => `${p} ${placeLabel(p, 'en')}`).join(', ')}` : '',
    ...words,
  ].filter(Boolean).join('; ')
}

/** Values that are every pairing of two parts (cover slots: day × part of day) as one pattern, else null. */
function pairedValues(values: readonly string[]): string | null {
  const pairs = values.map((v) => v.split('-'))
  if (values.length < 6 || pairs.some((p) => p.length !== 2)) return null
  const heads = [...new Set(pairs.map((p) => p[0]))]
  const tails = [...new Set(pairs.map((p) => p[1]))]
  const every = heads.length > 1 && tails.length > 1 && new Set(values).size === values.length && values.length === heads.length * tails.length
  return every ? `<${heads.join('|')}>-<${tails.join('|')}>, e.g. ${values[0]}` : null
}

function facetValues(category: string, f: FacetDef): string {
  if (f.kind === 'range' && f.range) return rangeText(f.range)
  if (f.placeNames) return placeValues(f)
  const options = f.options.filter((o) => !HIDDEN_OPTIONS.has(`${category}/${f.key}/${o.value}`))
  return pairedValues(options.map((o) => o.value))
    ?? options.map((o) => o.value + (o.orMore ? ' (or more)' : gloss(o.value, o.label))).join('|')
}

/** One category's lines: its subcategories, `type` where it splits, then every facet key with its values and views. */
function categoryBlock(slug: string): string[] {
  const cat = CATEGORY_BY_SLUG[slug]
  const subs = subcategoriesFor(slug).filter((s) => !CONCIERGE_HIDDEN_SUBCATEGORIES.has(s.slug))
  const views: (string | null)[] = [null, ...subs.map((s) => s.slug)]
  const lines = [`${slug} (${cat.name})`, `  sub: ${subs.map((s) => s.slug + gloss(s.slug, s.name)).join(', ')}`]
  const split = TYPE_SPLITS[slug]
  const types = split ? typesFor(slug).filter((t) => Object.hasOwn(split, t)) : []
  if (types.length) lines.push(`  type: ${types.map((t) => `${t} (${split[t]})`).join('|')}`)
  if (SHELF_RULES[slug]) lines.push(`  ${SHELF_RULES[slug]}`)

  // Each facet with the views (no subcategory, or one of them) that offer it; a facet only a hidden aisle offers is gone.
  const offered = cat.facets
    .filter((f) => !OMIT.has(`${slug}/${f.key}`))
    .map((f) => ({ f, values: facetValues(slug, f), on: views.filter((v) => facetsFor(slug, v).includes(f)) }))
    .filter((x) => x.on.length > 0)
  // A key can have two definitions on disjoint subcategories (a car's and a bike's gearbox): one line when their values
  // agree, else one line per definition.
  const keys = [...new Set(offered.map((x) => x.f.key))]
  for (const key of keys) {
    const defs = offered.filter((x) => x.f.key === key)
    const groups = defs.every((d) => d.values === defs[0].values)
      ? [{ ...defs[0], on: views.filter((v) => defs.some((d) => d.on.includes(v))) }]
      : defs
    const note = NOTES[`${slug}/${key}`]
    for (const g of groups) {
      const label = note ? ` (${note})` : gloss(key, g.f.label)
      const notWith = subs.map((s) => s.slug).filter((s) => !g.on.includes(s))
      const where = !g.on.includes(null) ? ` [sub: ${g.on.join(', ')}]` : notWith.length ? ` [not with: ${notWith.join(', ')}]` : ''
      lines.push(`  ${key}${label}: ${g.values}${where}`)
    }
  }
  return lines
}

/** The curated districts (DISTRICTS minus `all`) — the `district` key's values and teachers' district places. */
const CURATED = DISTRICTS.filter((d) => d.slug !== 'all')
type District = (typeof CURATED)[number]

/** Names people say that no stored row spells — the housing guide's "Thao Dien and An Phu" (the former District 2). */
const EXTRA_NAMES: Readonly<Record<string, readonly string[]>> = { d2: ['An Phú'] }

/** `d` lies inside `e`: every spelling of `d` is also one of `e`'s (District 2 and Thảo Điền are Thủ Đức's too). */
const inside = (d: District, e: District): boolean =>
  d !== e && !!d.match && !!e.match && e.match.length > d.match.length && d.match.every((m) => e.match!.includes(m))

/**
 * A district's spoken names: English, Vietnamese, then its own stored spellings — a spelling it shares with a narrower
 * district is that one's (the rule district-canonical.ts sends a shared alias by), and the accented form wins.
 */
function spokenNames(d: District): string[] {
  const narrower = CURATED.filter((x) => inside(x, d))
  const own = (d.match ?? []).filter((m) => !narrower.some((x) => x.match!.includes(m)))
  const out: string[] = []
  for (const name of [d.nameEn, d.name, ...own, ...(EXTRA_NAMES[d.slug] ?? [])].map((s) => s.replace(/\s*\(.*\)$/, ''))) {
    const b = bare(name)
    const same = out.findIndex((n) => bare(n) === b)
    if (same >= 0) {
      if (marks(name) > marks(out[same])) out[same] = name
    } else if (!out.some((n) => bare(n).includes(b) && marks(n) >= marks(name))) out.push(name)
  }
  return out
}

function districtEntry(d: District): string {
  const covers = CURATED.filter((x) => inside(x, d)).map((x) => x.slug)
  const within = CURATED.find((x) => inside(d, x))
  return `${d.slug} = ${spokenNames(d).join(' / ')}${covers.length ? ` (covers ${covers.join(', ')})` : ''}${within ? ` (in ${within.slug})` : ''}`
}

/** The provinces people name most, first; the rest in VN_PROVINCES order. */
const LEAD_PROVINCES = ['79', '01', '48']

/** `79 Ho Chi Minh City (also Binh Duong, Vung Tau, Thu Dau Mot)` — the hubs and towns inside a province (2025 units). */
function provinceEntry(p: AreaGeo): string {
  const hubs = HUBS.filter((h) => provinceOfPlace(h) === p.code).map((h) => placeLabel(h, 'en'))
  const towns = TOWN_ALIASES.filter((t) => provinceOfPlace(t.to) === p.code).map((t) => t.nameEn)
  const name = [p.nameEn, ...hubs].filter((n) => bare(n).startsWith(bare(p.nameEn))).reduce((a, b) => (b.length > a.length ? b : a))
  const also = [...new Set([...hubs, ...towns])].filter((n) => !bare(name).includes(bare(n)))
  return `${p.code} ${name}${also.length ? ` (also ${also.join(', ')})` : ''}`
}

const HOW_TO_READ = 'HOW TO READ IT: action.filters takes these keys, one value each. "a|b" = pick one. A range is "min-max"; '
  + 'either side may stay open ("25-" = 25 or more, "-40" = up to 40). [sub: x, y] = only once the subcategory is x or y; '
  + '[not with: x] = never in x. The value any removes a key. Anything not listed here does not exist.'

const KEYS_EVERYWHERE = [
  'KEYS EVERY CATEGORY TAKES',
  'district: an HCMC district key (PLACES); not for teachers (workIn) or jobs (province)',
  'province: a province code (PLACES); not for teachers',
  'priceMin, priceMax: whole dong; rentals per month, vehicle hire per day; never teachers; jobs use salary',
  'sort: recent|price-low|price-high|popular (teachers: recent|popular)',
  'condition, type: only in the categories that list them',
]

/** The catalog. Pure: the brief (brief.ts) builds it once per process and caches the whole instruction text. */
export function conciergeCatalog(): string {
  const provinces = [...LEAD_PROVINCES.map((c) => VN_PROVINCES.find((p) => p.code === c)!), ...VN_PROVINCES.filter((p) => !LEAD_PROVINCES.includes(p.code))]
  return [
    HOW_TO_READ,
    KEYS_EVERYWHERE.join('\n'),
    ['CATEGORIES', ...CONCIERGE_CATEGORIES.flatMap(categoryBlock)].join('\n'),
    ['PLACES', `district keys: ${CURATED.map(districtEntry).join('; ')}`, `province codes: ${provinces.map(provinceEntry).join(', ')}`].join('\n'),
  ].join('\n\n')
}
