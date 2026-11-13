/**
 * UI climb batch 89 (2026-11-13; blind A/B on live eno.vn, Opus +0.24, trust −0.1; owner: "reduce lines … super clean, minimal
 * wording, only what's necessary"): ONE grey facts line under the H1 in place of the price row's chips and the meta row, and
 * no fact said twice below it. Source pins, like the other contracts in this folder (page.tsx is a server component with a
 * database behind it); the pure halves are unit-tested in src/lib/pdp-repeat-rows.test.ts and src/lib/rental-facts.test.ts.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const PAGE = readFileSync(join(process.cwd(), 'src/app/[lang]/listings/[id]/(pdp)/page.tsx'), 'utf8')
/** The facts builder: from `const facts` to the separators computed from it. */
const BUILD = PAGE.slice(PAGE.indexOf('  const facts: { key: string; node: ReactNode; phoneOnly?: boolean }[] = []'), PAGE.indexOf('  const factSeps = factSeparators('))
/** The rendered line. */
const LINE = PAGE.slice(PAGE.indexOf('<div data-facts-line=""'), PAGE.indexOf('</div>', PAGE.indexOf('<div data-facts-line=""')))
const PUSHES = [...BUILD.matchAll(/facts\.push\(\{ key: '([a-z]+)'/g)].map((m) => m[1])

describe('batch 89 — the facts line', () => {
  it('the scan is not vacuous', () => {
    expect(BUILD.length).toBeGreaterThan(500)
    expect(LINE.length).toBeGreaterThan(100)
    expect(PUSHES).toEqual(['fixed', 'condition', 'brand', 'bedrooms', 'floor', 'place', 'deposit', 'saved', 'views', 'posted'])
    expect(BUILD).toContain("facts.push({ key: `spec-${s.label}`")
  })

  it('⛔ nothing on a job: every fact is pushed inside `if (factsLine)`, and a job keeps its meta row', () => {
    expect(PAGE).toContain("const factsLine = listing.listingType !== 'job' && rawListing.category.slug !== 'jobs'")
    expect(BUILD.indexOf('  if (factsLine) {')).toBeGreaterThan(0)
    expect(BUILD.indexOf('  if (factsLine) {')).toBeLessThan(BUILD.indexOf('facts.push('))
    expect(PAGE).toContain('{factsLine ? facts.length > 0 && (')
    // The job's row: its place, Posted and proof, as before.
    const jobRow = PAGE.slice(PAGE.indexOf("/* A JOB'S META ROW"), PAGE.indexOf('{/* 4 — Enforcement caution'))
    expect(jobRow).toContain('<span className="truncate">{placeName}</span>')
    expect(jobRow).toContain('{showPosted && (')
    expect(jobRow).toContain('{showProof && <span data-fab-avoid')
  })

  it('"Fixed price" keeps its exact gate — wholesale included (16 live wholesale posts chose Fixed, 2026-09-29) — and its chip is gone', () => {
    expect(BUILD).toContain("if (!listing.negotiable && !affiliateUrl && listing.price > 0 && (listing.listingType === 'sell' || listing.listingType === 'rent' || listing.listingType === 'wholesale')) {")
    expect(PAGE.match(/<Tr text="Fixed price" \/>/g)).toHaveLength(1)
    expect(PAGE).not.toMatch(/<Badge[^>]*>\s*<Tag /)
  })

  it('the condition keeps its job gate and prints the seller\'s words through <Tr>, never cut', () => {
    expect(BUILD).toContain("if (listing.condition && rawListing.category.slug !== 'jobs') {")
    expect(BUILD).toContain("<Tr text={listing.condition === 'new' ? 'New' : listing.condition === 'used' ? 'Used' : listing.condition} />")
    expect(LINE).toContain('[overflow-wrap:anywhere]')
    expect(LINE).not.toMatch(/truncate|line-clamp|text-ellipsis|whitespace-nowrap/)
  })

  it('the numeric specs keep their CountValue nodes and push conditions; Details renders none of them where the line shows', () => {
    expect(PAGE).toMatch(/numericSpecs\.push\(\{ label: 'Mileage', value: <><CountValue value=\{listing\.mileageKm\} \/> km<\/> \}\)/)
    expect(BUILD).toContain('for (const s of numericSpecs) facts.push({ key: `spec-${s.label}`, node: <><Tr text={s.label} /> {s.value}</> })')
    expect(PAGE).toContain('const detailSpecs = factsLine ? [] : numericSpecs')
    expect(PAGE).toContain('{[...detailSpecs, ...detailOnlySpecs].map((s) => (')
  })

  it('bedrooms and floor only where the rental facts apply, from attribute keys — and Details drops them there', () => {
    expect(PAGE).toContain('const bedrooms = factsLine && factsApply ? bedroomsOf(listing.attributes) : null')
    expect(PAGE).toContain("const floorFact = factsLine ? factRows.find((r): r is Extract<FactRow, { key: 'floor' }> => r.key === 'floor') ?? null : null")
    expect(PAGE).toContain("if (bedrooms) restatedAttrs.push('bedrooms')")
    expect(PAGE).toContain('const detailFactRows = floorFact ? factRows.filter((r) => r !== floorFact) : factRows')
    expect(PAGE).toContain('{detailFactRows.length > 0 && <RentalFactRows rows={detailFactRows} />}')
    // Authored pairs, never English DOM labels.
    expect(BUILD).toContain('RENTAL_FACT_LABELS.bedroomsN.label')
    expect(BUILD).toContain('RENTAL_FACT_LABELS.floor.label')
  })

  it('the place is the one existing expression (never split on commas), and always printed — never dropped for the title', () => {
    expect(PAGE).toContain('const placeName = locationEn ? <PlaceName en={collapseRepeatedName(pinShortEn ? cardArea(locationEn) : locationEn)} vi={collapseRepeatedName(pinShortVi ? cardArea(listing.location) : listing.location)} /> : <LocalizedText ')
    expect(PAGE.match(/<PlaceName /g)).toHaveLength(1)
    expect(BUILD).toContain("if (listing.location?.trim()) facts.push({ key: 'place', node: placeName })")
    expect(PAGE).not.toMatch(/location\.split\(/)
  })

  it('⛔ the deposit is phone-only, and Costs hides its Deposit row below md only — from md Costs keeps it', () => {
    expect(BUILD).toContain("facts.push({ key: 'deposit', phoneOnly: true,")
    expect(LINE).toContain('? <span key={f.key} className="md:hidden">{f.node}{tail}</span>')
    expect(PAGE).toContain("const costsPhoneHidden = factsLine && deposit ? ['deposit'] : []")
    expect(PAGE).toContain('<RentalCosts rows={costRows} phoneHidden={costsPhoneHidden} />')
    // The Rent row is gone: the headline price says it.
    expect(PAGE).not.toContain('rent={monthlyRent}')
  })

  it('"Posted <ago>" is the LAST fact (freshness kept), after the social proof', () => {
    expect(PUSHES[PUSHES.length - 1]).toBe('posted')
    expect(BUILD).toContain("if (showPosted) facts.push({ key: 'posted', node: <><Tr text=\"Posted\" /> <PostedAgo iso={listing.postedAt} /></> })")
    expect(BUILD).toContain('if (listing.savedCount >= 3)')
    expect(BUILD).toContain('if (listing.views >= 20)')
    // Behind showProof itself, as the old socialProof element was (codex, 2026-11-13).
    expect(BUILD.indexOf('if (showProof) {')).toBeGreaterThan(-1)
    expect(BUILD.indexOf('if (showProof) {')).toBeLessThan(BUILD.indexOf('if (listing.savedCount >= 3)'))
  })

  it('separators come from the data: one constant, glued to the fact before it, placed by factSeparators', () => {
    expect(PAGE).toContain("const FACT_SEP = '\\u00a0· '")
    expect(PAGE).toContain('const factSeps = factSeparators(facts.map((f) => !!f.phoneOnly))')
    expect(LINE).toContain("factSeps[i] === 'phone' ? <span className=\"md:hidden\">{FACT_SEP}</span>")
    // No vehicle "ID + cash deposit" fact: it would be a regex of the description's words.
    expect(BUILD).not.toMatch(/cash deposit|description/i)
  })

  it('Details de-dups by KEY before detailAttrs and showDetails; the period rule comes from pdp-repeat-rows.ts', () => {
    const at = PAGE.indexOf('for (const k of restatedAttrs) hiddenAttrs.add(k)')
    expect(at).toBeGreaterThan(0)
    expect(at).toBeLessThan(PAGE.indexOf('const detailAttrs = attrs.filter'))
    expect(PAGE).toContain("if (periodRestatedByUnit(listing.attributes?.rentalPeriod, listing.price > 0 ? listing.priceUnit : null)) restatedAttrs.push('rentalPeriod')")
  })

  it('the partner repeat-CTA counts Details as before batch 89 (a money surface: same pages, same CTA)', () => {
    expect(PAGE).toContain('const detailRowCount = numericSpecs.length + detailOnlySpecs.length + (attrRowsBefore89 ?? detailAttrs.length)')
    const before = PAGE.indexOf('attrRowsBefore89 = attrs.filter(([k]) => !hiddenAttrs.has(k)).length')
    expect(before).toBeGreaterThan(0)
    expect(before).toBeLessThan(PAGE.indexOf('for (const k of restatedAttrs) hiddenAttrs.add(k)'))
  })

  it('⛔ no Details row goes because the title contains its value (withdrawn 2026-11-13: codex + Opus refuted it)', () => {
    // "Not automatic" hid "Transmission: Automatic"; "Phòng không chung chủ" hid every row answered "Không".
    expect(PAGE).not.toMatch(/headingRestatesValue\(shownHeading/)
    expect(PAGE).not.toContain('detailValueText')
    // Nor the place ("Phòng gần Quận 7" is a room NEAR District 7): no title-matching drop is left anywhere.
    expect(PAGE).not.toMatch(/headingRestatesValue|placeHeading|shownHeading/)
  })
})
