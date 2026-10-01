// @vitest-environment jsdom
/**
 * ⛔ A JOB POST IS TAILORED TO HIRING (owner, 2026-10-01: "when posting a job we have price — if job
 * selected it should be salary and urgent hire etc. make sure posting page is tailored to post for job
 * hiring and not unrelated price, fixed price etc.").
 *
 * The wizard is rendered to a STRING with an edit prefill — the server's output for /listings/:id/edit,
 * and the same render tree a new post reaches once a category is chosen — so the assertions read what
 * the seller is actually shown, with no effect (fetch, autosave) able to change it first:
 *   · a job has NO Price section (no price input, no ×1,000 chips, no Negotiable / Fixed price) and a
 *     Salary section in its place, with "Urgent hiring / Tuyển gấp" instead of "Urgent sale";
 *   · its copy speaks to candidates, its checklist asks for no price and no photos;
 *   · a normal product still gets the Price section, untouched.
 */
import { renderToString } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import type { ListingEditData } from './post-wizard'
import type { SerializedCategory } from '@/lib/types'

const h = vi.hoisted(() => ({
  router: { push: () => {}, prefetch: () => {}, replace: () => {}, refresh: () => {}, back: () => {} },
  language: { lang: 'en', t: (k: string) => k, tr: (en: string) => en, setLang: () => {} },
  auth: { user: { id: 'u1' }, profile: null, loading: false, openSignIn: () => {} },
}))

vi.mock('next/navigation', () => ({ useRouter: () => h.router, usePathname: () => '/post', useSearchParams: () => new URLSearchParams() }))
vi.mock('sonner', () => ({ toast: Object.assign(() => {}, { success: () => {}, error: () => {} }) }))
vi.mock('@/context/language-context', () => ({
  useLanguage: () => h.language,
  useTr: (s: string) => s,
  Tr: ({ text }: { text?: string | null }) => <>{text}</>,
}))
vi.mock('@/context/auth-context', () => ({ useAuth: () => h.auth }))
// Only <Price> (the card's own price line, rendered below for comparison) reads the currency context.
vi.mock('@/context/currency-context', () => ({
  vndPerUsd: () => null,
  useCurrency: () => ({ currency: 'VND', rates: null, ratesPending: false, format: (n: number) => String(n) }),
}))
// The crop dialog imports react-easy-crop's stylesheet, which the test transform cannot load; it renders
// nothing until a photo is being cropped anyway.
vi.mock('./square-crop-dialog', () => ({ SquareCropDialog: () => null }))

const { PostWizard } = await import('./post-wizard')
const { Price } = await import('./price')
const { rangeColumnsPayload } = await import('./post-wizard-payload')
const { rangeFacetsFor } = await import('@/lib/taxonomy')

const CATS = [
  { id: 'c-jobs', slug: 'jobs', name: 'Jobs', nameVi: 'Việc làm', icon: 'Briefcase', color: 'violet' },
  { id: 'c-pets', slug: 'pets', name: 'Pets', nameVi: 'Thú cưng', icon: 'PawPrint', color: 'amber' },
] as unknown as SerializedCategory[]

const base: ListingEditData = {
  id: 'l1', title: 'English teacher, full-time', description: 'Teach adults in the evenings, 20 hours a week.',
  price: 45_000_000, negotiable: false, urgent: false, categorySlug: 'jobs', subcategorySlug: 'teaching', listingType: 'job',
  condition: null, brand: null, model: null, attributes: {}, year: null, mileageKm: null, engineL: null, engineCc: null,
  areaM2: null, salaryM: 45, district: 'Bình Thạnh', city: 'Hồ Chí Minh', lat: null, lng: null, images: [], video: null,
}
/** VndInput's ×1,000 unit chip as React's server output prints it ("×<!-- -->1,000"). */
const TIMES_1000 = /×(<!-- -->)?1,000/
const html = (edit: ListingEditData) => renderToString(<PostWizard categories={CATS} edit={edit} />)

describe('post wizard — a JOB is paid a salary, not priced', () => {
  const job = html(base)

  it('renders NO Price section: no price input, no ×1,000 chips, no Negotiable / Fixed price', () => {
    expect(job).not.toContain('id="pw-price"')
    expect(job).not.toContain('pw-price-input')
    expect(job).not.toContain('Fixed price')
    expect(job).not.toContain('Buyers can send offers')
    expect(job).not.toMatch(TIMES_1000)
    expect(job).not.toContain('Enter price')
  })

  it('renders the Salary section in its place, prefilled from the job\'s salaryM', () => {
    expect(job).toContain('id="pw-salary"')
    expect(job).toMatch(/<h2[^>]*>Salary<\/h2>/)
    expect(job).toContain('value="45"')
    expect(job).toContain('45,000,000')
    // …and the Salary facet is not ALSO asked in Specifics.
    expect(job.match(/tr\/tháng|million\/month/g)?.length).toBe(1)
  })

  it('says "Urgent hiring", never "Urgent sale" / "sell fast"', () => {
    expect(job).toContain('Urgent hiring')
    expect(job).toContain('for roles you need to fill fast')
    expect(job).not.toContain('Urgent sale')
    expect(job).not.toContain('sell fast')
  })

  it('speaks to candidates, not buyers', () => {
    expect(job).toContain('Candidates message you in-app; your number is revealed only after you reply.')
    expect(job).toContain('Job title')
    expect(job).not.toMatch(/buyers message you/i)
  })

  it('asks for no price and no photos in the checklist; the photo hint says optional', () => {
    expect(job).not.toContain('Set a price')
    expect(job).not.toContain('Add 3 photos')
    expect(job).toContain('Optional — a company logo or a photo of the workplace')
  })

  it('an empty salary is the NEGOTIABLE state, not a missing field', () => {
    const open = html({ ...base, salaryM: null, price: 0 })
    expect(open).toContain('Negotiable')
    expect(open).toContain('Salary: negotiable') // the preview card's line
    expect(open).not.toContain('Set a price')
  })
})

/** The text of the wizard preview card's price line (Preview in post-wizard-parts.tsx). */
const previewPriceLine = (out: string) => {
  const m = /<h2[^>]*>(?:Preview|Xem trước)<\/h2>[\s\S]*?<p class="mt-0\.5 text-sm font-bold text-foreground">([\s\S]*?)<\/p>/.exec(out)
  return m ? m[1].replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').trim() : null
}
const cardPriceLine = () =>
  renderToString(<Price native price={0} currency="₫" priceUnit="VND/month" listingType="job" linked={false} />).replace(/<[^>]+>/g, '').trim()

describe('the preview promises the line the published card prints (review, 2026-10-01)', () => {
  it('a job with no salary: preview and card say the SAME words, in English and in Vietnamese', () => {
    const en = previewPriceLine(html({ ...base, salaryM: null, price: 0 }))
    expect(en).toBe('Salary: negotiable')
    expect(cardPriceLine()).toBe(en)

    const saved = h.language
    h.language = { ...saved, lang: 'vi', tr: ((en: string, vi?: string) => vi ?? en) as unknown as typeof saved.tr }
    try {
      const vi = previewPriceLine(html({ ...base, salaryM: null, price: 0 }))
      expect(vi).toBe('Lương: thỏa thuận')
      expect(cardPriceLine()).toBe(vi)
    } finally {
      h.language = saved
    }
  })

  it('a LINKED job at 0 (pay on the original posting) keeps the neutral "see details"', () => {
    const linked = renderToString(<Price native price={0} currency="₫" priceUnit="VND/month" listingType="job" linked />).replace(/<[^>]+>/g, '')
    expect(linked).toBe('Salary: see details')
    // …and so does a caller that does not know (only an explicit false says negotiable).
    expect(renderToString(<Price native price={0} currency="₫" priceUnit="VND/month" listingType="job" />).replace(/<[^>]+>/g, '')).toBe('Salary: see details')
  })
})

describe('the submit payload — a job edit always states its salary (review, 2026-10-01)', () => {
  const facets = rangeFacetsFor('jobs', 'teaching')

  it('an EDIT left at "Negotiable" sends salaryM: null, so the server re-derives a pre-rule job\'s price', () => {
    // A job stored at "20,000 đ / month" with no salary: nothing to seed, the box opens empty.
    expect(rangeColumnsPayload(facets, {}, { salaryM: null }, 'salaryM')).toEqual({ salaryM: null })
    expect(rangeColumnsPayload(facets, { salary: 25 }, { salaryM: null }, 'salaryM')).toEqual({ salaryM: 25 })
  })

  it('a NEW job never sends a null salary (the create path would store it as 0)', () => {
    expect(rangeColumnsPayload(facets, {}, undefined, 'salaryM')).toEqual({})
    expect(rangeColumnsPayload(facets, { salary: 25 }, undefined, 'salaryM')).toEqual({ salaryM: 25 })
  })

  it('CONTROL: any other spec is nulled on edit only when the listing had it', () => {
    const car = rangeFacetsFor('vehicles', 'cars')
    expect(rangeColumnsPayload(car, {}, { year: 2019, mileageKm: null }, undefined)).toEqual({ year: null })
    expect(rangeColumnsPayload(car, {}, { year: null }, undefined)).toEqual({})
  })
})

describe('post wizard — a normal product keeps its Price section', () => {
  const pet = html({ ...base, title: 'Corgi puppy, 3 months', categorySlug: 'pets', subcategorySlug: null, listingType: 'sell', price: 9_000_000, negotiable: true, salaryM: null })

  it('renders the Price section with Negotiable / Fixed price and Urgent sale', () => {
    expect(pet).toContain('id="pw-price"')
    expect(pet).toContain('pw-price-input')
    expect(pet).toMatch(TIMES_1000) // proves the job's NOT-match above is not vacuous
    expect(pet).toContain('Buyers can send offers')
    expect(pet).toContain('Fixed price')
    expect(pet).toContain('Urgent sale')
    expect(pet).not.toContain('id="pw-salary"')
    expect(pet).not.toContain('Urgent hiring')
    expect(pet).toContain('buyers message you in-app')
  })
})
