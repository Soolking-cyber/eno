// @vitest-environment jsdom
/**
 * A5-SELL (UX program 2, 2026-10-04) — what the posting wizard SHOWS, read from its server render the
 * way post-wizard.job.test.tsx reads a job: no effect (fetch, autosave, draft restore) runs first, so
 * the assertions are about the markup a seller is handed.
 *   · the category grid leads with the curated rank and keeps the unlinked shelves behind "More…";
 *   · a rent price wears the period the seller picked, INSIDE the field, and a rental has no "Urgent
 *     sale" row, a "Looking to rent" Wanted chip and a vehicle-brand example;
 *   · the condition chips use the taxonomy's own labels ("New / Like new");
 *   · the shot-list hints follow the shelf; the success screen offers "List another item".
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { renderToString } from 'react-dom/server'
import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
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
vi.mock('@/context/currency-context', () => ({
  vndPerUsd: () => null,
  useCurrency: () => ({ currency: 'VND', rates: null, ratesPending: false, format: (n: number) => String(n) }),
}))
// react-easy-crop's stylesheet cannot load under the test transform; the dialog renders nothing here.
vi.mock('./square-crop-dialog', () => ({ SquareCropDialog: () => null }))

const { PostWizard } = await import('./post-wizard')
const { PostSuccess } = await import('./post-wizard-sections')
const { DraftNotice, PublishButton, PublishLabel } = await import('./post-wizard-parts')
const { POST_CATEGORY_RANK } = await import('./post-wizard-category')
const { brandModelPayload, draftHasContent } = await import('./post-wizard-payload')

afterEach(() => cleanup())

const cat = (slug: string, name: string, icon = 'Package') => ({ id: `c-${slug}`, slug, name, nameVi: name, icon, color: 'blue' })
// The order /post hands them over in: by ENGLISH name (post/page.tsx).
const CATS = [
  cat('baby-kids', 'Baby & kids'), cat('electronics', 'Electronics'), cat('fashion-beauty', 'Fashion & beauty'),
  cat('furniture-appliances', 'Furniture & appliances'), cat('jobs', 'Jobs'), cat('moving-sale', 'Moving sale'),
  cat('pets', 'Pets'), cat('property', 'Property'), cat('rentals', 'Rentals'), cat('services', 'Services'), cat('vehicles', 'Vehicles'),
] as unknown as SerializedCategory[]

const base: ListingEditData = {
  id: 'l1', title: 'Honda Vision 2022 for rent', description: 'Helmet included, delivery in District 1 and 3.',
  price: 150_000, negotiable: true, urgent: false, categorySlug: 'rentals', subcategorySlug: 'motorbike-rental', listingType: 'rent',
  condition: null, brand: 'Honda', model: 'Vision', attributes: { rentalPeriod: 'daily' }, year: null, mileageKm: null, engineL: null, engineCc: null,
  areaM2: null, salaryM: null, district: 'Quận 1', city: 'Hồ Chí Minh', lat: null, lng: null, images: [], video: null,
}
const html = (edit?: ListingEditData) => renderToString(<PostWizard categories={CATS} edit={edit} />)

describe('post wizard — the category grid (sell-06)', () => {
  const page = html()
  const order = [...page.matchAll(/data-cat-slug="([a-z-]+)"/g)].map((m) => m[1])

  it('leads with the curated rank, not the alphabet', () => {
    expect(order.slice(0, POST_CATEGORY_RANK.length)).toEqual(POST_CATEGORY_RANK)
  })

  it('keeps the unlinked shelves behind "More…" until it is opened', () => {
    for (const hidden of ['pets', 'property', 'vehicles']) expect(order).not.toContain(hidden)
    expect(page).toContain('More…')
  })

  it('shows a neutral photo hint until a category is chosen (sell-08)', () => {
    expect(page).toContain('The minimum depends on the category you pick below.')
    expect(page).not.toContain('Shots buyers look for')
  })
})

describe('post wizard — a rental (sell-02 / sell-07 / sell-13)', () => {
  const rental = html(base)

  it('quotes the price per the period picked, inside the field after the đ', () => {
    expect(rental).toMatch(/<span>đ<\/span><span[^>]*>\/ day<\/span>/)
    expect(html({ ...base, attributes: { rentalPeriod: 'long-term' } })).toMatch(/<span>đ<\/span><span[^>]*>\/ month<\/span>/)
    expect(html({ ...base, attributes: {} })).toMatch(/<span>đ<\/span><span[^>]*>\/ month<\/span>/)
  })

  it('⛔ an EDIT opens on the STORED unit when the period chip disagrees — the unit is what buyers see', () => {
    // A row stamped monthly before the chip counted: the editor says "/ month", as every card does.
    expect(html({ ...base, priceUnit: 'VND/month', attributes: { rentalPeriod: 'daily' } })).toMatch(/<span>đ<\/span><span[^>]*>\/ month<\/span>/)
    // An imported per-day row with no chip: "/ day", never an invitation to a ×30 "fix".
    expect(html({ ...base, priceUnit: 'VND/day', attributes: {} })).toMatch(/<span>đ<\/span><span[^>]*>\/ day<\/span>/)
    // Agreeing values, and 'long-term' over a monthly unit, open as they are.
    expect(html({ ...base, priceUnit: 'VND/day', attributes: { rentalPeriod: 'daily' } })).toMatch(/<span>đ<\/span><span[^>]*>\/ day<\/span>/)
    expect(html({ ...base, priceUnit: 'VND/month', attributes: { rentalPeriod: 'long-term' } })).toMatch(/<span>đ<\/span><span[^>]*>\/ month<\/span>/)
  })

  it('has no "Urgent sale" row, but keeps offers', () => {
    expect(rental).not.toContain('Urgent sale')
    expect(rental).toContain('Fixed price')
  })

  it('⛔ …except on an EDIT of a rental that is urgent NOW — the row is how the run is switched off', () => {
    const urgentNow = html({ ...base, urgent: true })
    expect(urgentNow).toContain('Urgent sale')
    // …and it opens switched ON, so one tap ends it.
    expect(urgentNow).toMatch(/role="switch"[^>]*aria-checked="true"|aria-checked="true"[^>]*role="switch"/)
  })

  it('names Wanted "Looking to rent" and gives a vehicle brand example', () => {
    expect(rental).toContain('Looking to rent')
    expect(rental).toContain('e.g. Honda, Yamaha, VinFast')
    expect(rental).toContain('e.g. Honda Vision 2022 for rent — helmet included')
  })

  it('asks an apartment for no brand at all', () => {
    const flat = html({ ...base, subcategorySlug: 'apartment-rental', brand: null, model: null, attributes: { rentalPeriod: 'monthly' } })
    expect(flat).not.toContain('e.g. Honda, Yamaha, VinFast')
    expect(flat).not.toContain('e.g. Apple, Samsung, Honda')
  })
})

describe('post wizard — goods (sell-09 / sell-15)', () => {
  const phone = html({
    ...base, title: 'iPhone 13 128GB', categorySlug: 'electronics', subcategorySlug: 'phones-tablets', listingType: 'sell',
    condition: 'used', brand: 'Apple', model: 'iPhone 13', attributes: {}, price: 9_000_000,
  })

  it('labels the condition chips with the taxonomy wording', () => {
    expect(phone).toContain('New / Like new')
    expect(phone).toContain('Used')
  })

  it('shows the shot list for the shelf, once, and still offers the urgent row on a sale', () => {
    expect(phone).toContain('Shots buyers look for')
    expect(phone).toContain('Battery health screen')
    expect(phone).toContain('Urgent sale')
    // The cover sentence is said once, in the section hint — not again under the grid.
    expect(phone.split('The first is your cover').length - 1).toBe(1)
    expect(phone).not.toContain('First photo is your cover')
  })
})

describe('post wizard — success, draft notice, loading label (sell-04 / si-10 / step 1)', () => {
  const t = (_vi: string, en: string) => en

  it('offers "List another item" only when the wizard can take it', () => {
    const withNext = renderToString(<PostSuccess firstListing={false} createdId="l9" title="Sofa" price="1000000" onPostAnother={() => {}} t={t} />)
    expect(withNext).toContain('List another item')
    expect(renderToString(<PostSuccess firstListing={false} createdId="l9" title="Sofa" price="1000000" t={t} />)).not.toContain('List another item')
    expect(renderToString(<PostSuccess firstListing={false} createdId="l9" title="Tutor" price="" job onPostAnother={() => {}} t={t} />)).toContain('Post another job')
  })

  it('says what came back with the draft, as a status callout (ui/alert), and offers Discard', () => {
    const kept = renderToString(<DraftNotice photosKept={3} askPhotos={false} onDiscard={() => {}} onDismiss={() => {}} t={t} />)
    expect(kept).toContain('data-slot="alert"')
    expect(kept).toContain('role="status"')
    expect(kept).toContain('Draft restored')
    expect(kept).toContain('Photos kept: 3')
    expect(kept).toContain('Discard')
    // The confirm is not on the page until Discard is pressed.
    expect(kept).not.toContain('Discard this draft?')
    const lost = renderToString(<DraftNotice photosKept={0} askPhotos onDiscard={() => {}} onDismiss={() => {}} t={t} />)
    expect(lost).toContain('Your photos were not kept')
  })

  it('⛔ Discard ASKS before it wipes the text and the photos (ui/alert-dialog), and Keep it does nothing', async () => {
    const onDiscard = vi.fn()
    render(<DraftNotice photosKept={2} askPhotos={false} onDiscard={onDiscard} onDismiss={() => {}} t={t} />)
    await act(async () => { screen.getByRole('button', { name: 'Discard' }).click() })
    const dialog = await screen.findByRole('alertdialog')
    expect(dialog.textContent).toContain('Discard this draft?')
    expect(onDiscard).not.toHaveBeenCalled()
    await act(async () => { screen.getByRole('button', { name: 'Keep it' }).click() })
    expect(onDiscard).not.toHaveBeenCalled()
    // Asked again, and confirmed: now — and only now — the draft goes.
    await act(async () => { screen.getByRole('button', { name: 'Discard' }).click() })
    const confirm = (await screen.findByRole('alertdialog')).querySelector<HTMLButtonElement>('[data-slot="alert-dialog-action"]')
    await act(async () => { confirm?.click() })
    expect(onDiscard).toHaveBeenCalledTimes(1)
  })

  it('names the profile load on the Publish button instead of a count — ui/button’s busy state, no hand-built spinner', () => {
    const label = renderToString(<PublishLabel submitting={false} loadingProfile edit={false} missingCount={4} t={t} />)
    expect(label).toContain('Loading your details…')
    expect(label).not.toContain('still needed')
    expect(label).not.toContain('<svg')
    const button = renderToString(<PublishButton onSubmit={() => {}} canSubmit={false} submitting={false} loadingProfile edit={false} missingCount={4} t={t} />)
    expect(button).toContain('aria-busy="true"')
    expect(button).toContain('data-loading=""')
    expect(button).toContain('Loading your details…')
  })
})

describe('post wizard — brand and model on an EDIT (review, 2026-10-04)', () => {
  it('⛔ a hidden Brand field is LEFT OUT of an edit — never null, which would clear the stored brand', () => {
    // An apartment rental hides Brand, but rentals is a brand category on the server: a null would
    // clear the brand the listing has and move its brand count (core/listings.ts updateListingCore).
    expect(brandModelPayload({ showBrand: false, brand: 'Vinhomes', model: 'Central Park', edit: true })).toEqual({})
  })

  it('⛔ …but an edit that MOVED the listing to a brandless subcategory (scooter → apartment) clears it', () => {
    expect(brandModelPayload({ showBrand: false, brand: '', model: '', edit: true, subcategoryChanged: true })).toEqual({ brand: null, model: null })
    // Unchanged subcategory, Brand hidden: still omitted — the original fix.
    expect(brandModelPayload({ showBrand: false, brand: '', model: '', edit: true, subcategoryChanged: false })).toEqual({})
  })

  it('sends null for a hidden field on a NEW post, and the trimmed values when the field shows', () => {
    expect(brandModelPayload({ showBrand: false, brand: 'Honda', model: 'Vision', edit: false })).toEqual({ brand: null, model: null })
    expect(brandModelPayload({ showBrand: true, brand: '  Honda ', model: ' Vision ', edit: true })).toEqual({ brand: 'Honda', model: 'Vision' })
    expect(brandModelPayload({ showBrand: true, brand: '  ', model: '', edit: false })).toEqual({ brand: null, model: null })
  })

  it('O-34: the wizard asks the visa chips by the listing’s OWN attributes on an edit (the server’s rule)', () => {
    const src = readFileSync(join(__dirname, 'post-wizard.tsx'), 'utf8')
    expect(src).toContain('askableFacetsFor(categorySlug, subcategorySlug, { newPost: !edit, officialPartner, existing: edit?.attributes })')
  })

  it('is what the wizard actually sends', () => {
    const src = readFileSync(join(__dirname, 'post-wizard.tsx'), 'utf8')
    expect(src).toContain('...brandModelPayload({ showBrand, brand, model, edit: !!edit, subcategoryChanged: !!edit && (subcategorySlug || null) !== (edit.subcategorySlug || null) })')
    expect(src).not.toMatch(/brand: showBrand \?/)
    expect(src).not.toMatch(/model: showBrand \?/)
  })
})

describe('post wizard — "List another item" on a moving sale is not a draft until the seller types (review, 2026-10-04)', () => {
  const sale = 'Moving out 20/10 — pick up in Thảo Điền, everything must go.'

  it('the carried-over moving-sale description alone is not draft content; anything typed is', () => {
    expect(draftHasContent({ title: '', description: sale, price: '' }, sale)).toBe(false)
    expect(draftHasContent({ title: 'Sofa', description: sale, price: '' }, sale)).toBe(true)
    expect(draftHasContent({ title: '', description: sale, price: '500000' }, sale)).toBe(true)
    expect(draftHasContent({ title: '', description: `${sale} Sofa included.`, price: '' }, sale)).toBe(true)
    // Without carried context, a description is typed work as it always was.
    expect(draftHasContent({ title: '', description: sale, price: '' })).toBe(true)
    expect(draftHasContent({ title: '  ', description: '  ', price: '' })).toBe(false)
  })

  it('is what the autosave asks, and postAnother records the carried context', () => {
    const src = readFileSync(join(__dirname, 'post-wizard.tsx'), 'utf8')
    expect(src).toContain('if (!draftHasContent({ title, description, price }, carriedDescription.current)) {')
    expect(src).toContain("carriedDescription.current = movingSale ? description : ''")
  })

  it('a successful publish — banner or ordinary button — takes ?resume=publish off the address (see post-wizard.flow.test.tsx)', () => {
    const src = readFileSync(join(__dirname, 'post-wizard.tsx'), 'utf8')
    const success = src.slice(src.indexOf("try { localStorage.removeItem('eno-listing-draft') } catch {}\n      void clearDraftPhotos()"), src.indexOf('setSubmitted(true)'))
    expect(success).toContain('stripResumeParam()')
  })
})
