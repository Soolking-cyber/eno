import { describe, expect, it } from 'vitest'
import { askableFacetsFor, isRequiredFacet } from '@/lib/taxonomy'
import { minPhotosFor } from '@/lib/publish-guard'
import { publishSteps, type GateCheck } from './post-wizard-steps'

/**
 * THE PROGRESS THE SELLER SEES MUST NEVER GO BACKWARDS ON A CORRECT TAP, AND MUST AGREE WITH THE GATE.
 *
 * publishSteps() is a display-only VIEW of post-wizard.tsx's `checks` array (the publish gate): it
 * groups and hides gate rows but never recomputes one. `checksFor` below restates how the wizard
 * builds that array, so the scenarios read like the form; the last block pins the one property that
 * matters — for an account whose profile has loaded, every step is done exactly when every gate row
 * passes, and a gate row this file has never heard of still shows up.
 */

// The wizard's helper is t(vi, en); these tests read English.
const t = (_vi: string, en: string) => en

type Form = {
  photos: number
  categorySlug: string
  subcategorySlug: string
  title: string
  description: string
  condition: string
  attrs: Record<string, string>
  price: string
  hasLocation: boolean
  contactName: string
  phone: string
}
type Who = 'guest' | 'loading' | 'member'

const EMPTY: Form = {
  photos: 0, categorySlug: '', subcategorySlug: '', title: '', description: '', condition: '',
  attrs: {}, price: '', hasLocation: false, contactName: '', phone: '',
}

/** post-wizard.tsx's `checks`, rebuilt for a form state (labels abbreviated — only keys and ok matter). */
function checksFor(f: Form, who: Who): GateCheck[] {
  const catFacets = askableFacetsFor(f.categorySlug, f.subcategorySlug)
  const hasCondition = catFacets.some((x) => x.key === 'condition')
  const attrFacets = catFacets.filter((x) => x.key !== 'condition')
  const phoneOk = f.phone.replace(/\D/g, '').length >= 9
  return [
    { key: 'photo', ok: f.photos >= minPhotosFor(f.categorySlug), label: 'photo' },
    { key: 'category', ok: !!f.categorySlug, label: 'category' },
    { key: 'title', ok: f.title.trim().length >= 3, label: 'title' },
    { key: 'description', ok: f.description.trim().length >= 20, label: 'description' },
    ...(hasCondition ? [{ key: 'condition', ok: !!f.condition, label: 'condition' }] : []),
    ...(attrFacets.some(isRequiredFacet) ? [{ key: 'details', ok: attrFacets.filter(isRequiredFacet).every((x) => !!f.attrs[x.key]), label: 'details' }] : []),
    { key: 'price', ok: f.price.trim().length > 0, label: 'price' },
    { key: 'location', ok: f.hasLocation, label: 'location' },
    who === 'guest'
      ? { key: 'signin', ok: true, label: 'Sign in to publish' }
      : { key: 'contact', ok: f.contactName.trim().length >= 2 && phoneOk, label: 'contact' },
  ]
}

function stepsFor(f: Form, who: Who = 'guest', checks = checksFor(f, who)) {
  const facets = askableFacetsFor(f.categorySlug, f.subcategorySlug).filter((x) => x.key !== 'condition')
  return publishSteps({
    checks,
    photos: f.photos,
    minPhotos: minPhotosFor(f.categorySlug),
    missingFacetLabels: facets.filter((x) => isRequiredFacet(x) && !f.attrs[x.key]).map((x) => x.label),
    showContact: who === 'member',
    contactMissing: { name: f.contactName.trim().length < 2, phone: f.phone.replace(/\D/g, '').length < 9 },
    t,
  })
}
const remaining = (f: Form, who: Who = 'guest') => stepsFor(f, who).filter((s) => !s.ok).length

describe('publishSteps — the count never rises on forward progress', () => {
  it('picking a category that brings condition AND specifics keeps the count (5 → 5 → 5)', () => {
    // A guest on a fresh form: photos, category, title + description, price, area.
    expect(remaining(EMPTY)).toBe(5)
    const electronics = { ...EMPTY, categorySlug: 'electronics' }
    const phones = { ...electronics, subcategorySlug: 'phones-tablets' }
    // Sanity: the fixture really does bring both, or this test proves nothing.
    expect(askableFacetsFor('electronics', 'phones-tablets').some((f) => f.key === 'condition')).toBe(true)
    expect(askableFacetsFor('electronics', 'phones-tablets').filter((f) => f.key !== 'condition').some(isRequiredFacet)).toBe(true)
    expect(remaining(electronics)).toBe(5)
    expect(remaining(phones)).toBe(5)
  })

  it('a category with no specifics takes the count DOWN, never up', () => {
    expect(remaining({ ...EMPTY, categorySlug: 'community-events' })).toBe(remaining(EMPTY) - 1)
  })

  it('filling a field never raises the count', () => {
    const steps: Form[] = [
      EMPTY,
      { ...EMPTY, photos: 3 },
      { ...EMPTY, photos: 3, categorySlug: 'electronics' },
      { ...EMPTY, photos: 3, categorySlug: 'electronics', subcategorySlug: 'phones-tablets' },
      { ...EMPTY, photos: 3, categorySlug: 'electronics', subcategorySlug: 'phones-tablets', title: 'iPhone 14' },
      { ...EMPTY, photos: 3, categorySlug: 'electronics', subcategorySlug: 'phones-tablets', title: 'iPhone 14', condition: 'used' },
    ]
    for (let i = 1; i < steps.length; i++) expect(remaining(steps[i])).toBeLessThanOrEqual(remaining(steps[i - 1]))
  })

  it('names the condition first, then the missing facets by their labels', () => {
    const phones = { ...EMPTY, categorySlug: 'electronics', subcategorySlug: 'phones-tablets' }
    expect(stepsFor(phones).find((s) => s.key === 'specifics')).toMatchObject({ todo: 'Pick the condition', target: 'condition' })
    const specifics = stepsFor({ ...phones, condition: 'used' }).find((s) => s.key === 'specifics')!
    expect(specifics.target).toBe('details')
    expect(specifics.todo).toMatch(/^Fill in the specifics: \S/)
    // No stray whitespace inside the translated half — it is harvested trimmed.
    expect(specifics.todo).not.toContain('  ')
  })

  it('points the about step at the title first, then the description', () => {
    expect(stepsFor(EMPTY).find((s) => s.key === 'about')).toMatchObject({ target: 'title', todo: 'Add a title' })
    expect(stepsFor({ ...EMPTY, title: 'Sofa' }).find((s) => s.key === 'about')).toMatchObject({ target: 'description' })
  })
})

describe('publishSteps — guests and the loading window', () => {
  it('never lists a sign-in step for a guest', () => {
    for (const f of [EMPTY, { ...EMPTY, categorySlug: 'electronics', subcategorySlug: 'phones-tablets' }]) {
      const keys = stepsFor(f, 'guest').map((s) => s.key)
      expect(keys).not.toContain('signin')
      expect(keys).not.toContain('contact')
    }
  })

  it('hides the contact step while the account is loading, and shows it once it is known', () => {
    expect(stepsFor(EMPTY, 'loading').map((s) => s.key)).not.toContain('contact')
    expect(stepsFor(EMPTY, 'member').at(-1)).toMatchObject({ key: 'contact', ok: false, todo: 'Add your name & phone', target: 'contact' })
    expect(stepsFor({ ...EMPTY, contactName: 'Minh', phone: '0901234567' }, 'member').at(-1)).toMatchObject({ key: 'contact', ok: true })
  })

  it('names the half of the contact that is actually missing', () => {
    expect(stepsFor({ ...EMPTY, contactName: 'Minh' }, 'member').at(-1)).toMatchObject({ key: 'contact', ok: false, todo: 'Add your phone number', target: 'contactPhone' })
    expect(stepsFor({ ...EMPTY, phone: '0901234567' }, 'member').at(-1)).toMatchObject({ key: 'contact', ok: false, todo: 'Add your name', target: 'contact' })
    // Without the hint (an older caller) the step keeps the both-halves wording.
    const legacy = publishSteps({ checks: [{ key: 'contact', ok: false, label: 'contact' }], photos: 0, minPhotos: 0, missingFacetLabels: [], showContact: true, t })
    expect(legacy[0]).toMatchObject({ todo: 'Add your name & phone', target: 'contact' })
  })

  it('every target is a pw-<key> the wizard renders', () => {
    const targets = new Set([
      ...stepsFor({ ...EMPTY, categorySlug: 'electronics', subcategorySlug: 'phones-tablets' }, 'member').map((s) => s.target),
      ...stepsFor({ ...EMPTY, contactName: 'Minh' }, 'member').map((s) => s.target),
    ])
    for (const target of targets) expect(['photo', 'category', 'title', 'description', 'condition', 'details', 'price', 'location', 'contact', 'contactPhone']).toContain(target)
  })
})

describe('publishSteps — the photo step counts down', () => {
  const photoStep = (photos: number, categorySlug = 'electronics') =>
    stepsFor({ ...EMPTY, photos, categorySlug }).find((s) => s.key === 'photo')!
  it('reads what is LEFT of the three-angle minimum', () => {
    expect(photoStep(0).todo).toBe('Add 3 photos')
    expect(photoStep(1).todo).toBe('Add 2 more photos')
    expect(photoStep(2).todo).toBe('Add 1 more photo')
    expect(photoStep(3).ok).toBe(true)
  })
  it('asks for one photo where one is the bar (services)', () => {
    expect(minPhotosFor('services')).toBe(1)
    expect(photoStep(0, 'services').todo).toBe('Add 1 photo')
    expect(photoStep(1, 'services').ok).toBe(true)
  })
  it('says the real remaining count for any other minimum (never an assumed 3)', () => {
    const todo = (photos: number, minPhotos: number) =>
      publishSteps({ checks: [{ key: 'photo', ok: photos >= minPhotos, label: 'photo' }], photos, minPhotos, missingFacetLabels: [], showContact: false, t })[0].todo
    expect(todo(0, 5)).toBe('Photos still needed: 5')
    expect(todo(2, 5)).toBe('Photos still needed: 3')
    expect(todo(3, 5)).toBe('Add 2 more photos')
    expect(todo(4, 5)).toBe('Add 1 more photo')
    expect(todo(0, 2)).toBe('Photos still needed: 2')
    expect(todo(1, 2)).toBe('Add 1 more photo')
  })
})

describe('publishSteps agrees with the publish gate', () => {
  const COMPLETE: Form = {
    photos: 3,
    categorySlug: 'electronics',
    subcategorySlug: 'phones-tablets',
    title: 'iPhone 14 128GB',
    description: 'Used for a year, battery at 92%, box included.',
    condition: 'used',
    attrs: Object.fromEntries(
      askableFacetsFor('electronics', 'phones-tablets')
        .filter((f) => f.key !== 'condition' && isRequiredFacet(f))
        .map((f) => [f.key, f.options[0]?.value ?? 'x']),
    ),
    price: '100000',
    hasLocation: true,
    contactName: 'Minh',
    phone: '0901 234 567',
  }

  // Each variant breaks exactly one thing the gate cares about.
  const variants: Array<[string, Form]> = [
    ['complete', COMPLETE],
    ['two photos', { ...COMPLETE, photos: 2 }],
    ['no category', { ...COMPLETE, categorySlug: '', subcategorySlug: '', condition: '', attrs: {} }],
    ['short title', { ...COMPLETE, title: 'ab' }],
    ['short description', { ...COMPLETE, description: 'too short' }],
    ['no condition', { ...COMPLETE, condition: '' }],
    ['a required facet empty', { ...COMPLETE, attrs: {} }],
    ['no price', { ...COMPLETE, price: '' }],
    ['no area', { ...COMPLETE, hasLocation: false }],
    ['no phone', { ...COMPLETE, phone: '' }],
    ['services with one photo', { ...COMPLETE, categorySlug: 'services', subcategorySlug: '', condition: '', attrs: {}, photos: 1 }],
  ]
  it.each(variants)('signed in, profile loaded — %s', (_name, f) => {
    const checks = checksFor(f, 'member')
    expect(stepsFor(f, 'member', checks).every((s) => s.ok)).toBe(checks.every((c) => c.ok))
  })
  it.each(variants)('guest — %s', (_name, f) => {
    const checks = checksFor(f, 'guest')
    expect(stepsFor(f, 'guest', checks).every((s) => s.ok)).toBe(checks.every((c) => c.ok))
  })
  it('the complete fixture really is publishable', () => {
    expect(checksFor(COMPLETE, 'member').every((c) => c.ok)).toBe(true)
  })
  it('a gate row it has never heard of is still shown, under its own label', () => {
    const checks = [...checksFor(COMPLETE, 'member'), { key: 'identity', ok: false, label: 'Verify your identity' }]
    const steps = stepsFor(COMPLETE, 'member', checks)
    expect(steps.filter((s) => !s.ok)).toEqual([{ key: 'identity', ok: false, name: 'Verify your identity', todo: 'Verify your identity', target: 'identity' }])
  })
})
