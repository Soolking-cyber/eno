import { isValidElement, type ReactElement, type ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { licenceStampFor } from '@/lib/licence-stamp'

/**
 * ⛔ WHAT THE EDIT SCREEN TELLS THE WIZARD ABOUT eno'S LICENCE CHECK (owner, 2026-10-14 — e-Visa and Legal & permits).
 * `edit.licence = { approved, exempt }`: approved — the stamp is the stamp of exactly the stored values (licenceCleared;
 * always true outside the aisles and for the desk); exempt — eno's own desk. It decides only what the form SHOWS (the
 * resubmit note, or the quiet hint; no fields for the desk), never the hold — so a failed desk read fails CLOSED (the
 * form asks for the values), and the stamp itself never leaves the server.
 */
const h = vi.hoisted(() => ({
  listing: null as Record<string, unknown> | null,
  desk: [] as string[] | Error,
  wizardProps: null as Record<string, unknown> | null,
}))

vi.mock('next/navigation', () => ({
  redirect: (to: string) => { throw new Error(`redirect ${to}`) },
  notFound: () => { throw new Error('notFound') },
}))
vi.mock('@/lib/admin', () => ({ getCurrentProfile: async () => ({ id: 'owner-1' }) }))
vi.mock('@/lib/db', () => ({
  db: {
    seller: { findUnique: async () => ({ id: 'seller-1' }) },
    listing: { findUnique: async () => h.listing },
    category: { findMany: async () => [{ id: 'c-services', slug: 'services', name: 'Services', nameVi: 'Dịch vụ', icon: 'Wrench', color: 'cyan' }] },
    brand: { findUnique: async () => null },
  },
}))
vi.mock('@/lib/edition-scope', () => ({ deskSellerIds: async () => { if (h.desk instanceof Error) throw h.desk; return h.desk } }))
vi.mock('@/components/marketplace/header', () => ({ Header: () => null }))
vi.mock('@/components/marketplace/footer', () => ({ Footer: () => null }))
vi.mock('@/components/marketplace/post-wizard', () => ({ PostWizard: (p: Record<string, unknown>) => { h.wizardProps = p; return null } }))

const { default: EditListingPage } = await import('./page')

/** The PostWizard element the page returns, found in its (unrendered) element tree. */
function wizardIn(node: ReactNode): Record<string, unknown> | null {
  if (!isValidElement(node)) return Array.isArray(node) ? node.map(wizardIn).find(Boolean) ?? null : null
  const el = node as ReactElement<{ children?: ReactNode; edit?: unknown }>
  if (el.props.edit !== undefined) return el.props as Record<string, unknown>
  return wizardIn(el.props.children)
}
async function editFor(listing: Record<string, unknown>) {
  h.listing = listing
  const props = wizardIn(await EditListingPage({ params: Promise.resolve({ id: 'l1' }) }))
  return props?.edit as { licence?: { approved: boolean; exempt: boolean; exemptAisles?: string[] }; attributes: Record<string, string> } & Record<string, unknown>
}

const VALUES = { legalName: 'CÔNG TY TNHH VISA5S.VN', licenceNo: '79-123/2019/TCDL-GP LHQT' }
const ATTRS = JSON.stringify({ providerLegalName: VALUES.legalName, providerLicenceNo: VALUES.licenceNo })
const row = (over: Record<string, unknown>) => ({
  id: 'l1', sellerId: 'seller-1', title: 'e-Visa, 3 days', description: 'A 90-day e-visa, prepared with you and filed online.', price: 900_000,
  negotiable: false, urgentUntil: null, categoryId: 'c-services', subcategorySlug: 'visa-legal', listingType: 'service', condition: null,
  brandSlug: null, model: null, attributes: ATTRS, priceUnit: 'VND/service', year: null, mileageKm: null, engineL: null, engineCc: null,
  areaM2: null, salaryM: null, district: 'Quận 1', city: 'Hồ Chí Minh', lat: null, lng: null, images: '[]', video: null, status: 'active',
  verificationMethod: null, category: { slug: 'services' },
  ...over,
})

beforeEach(() => {
  h.desk = []
  h.wizardProps = null
})

describe('the edit screen and the licence check', () => {
  it('a listing stamped for exactly its values is approved — and the stamp itself is not handed to the client', async () => {
    const stamp = licenceStampFor({ sellerId: 'seller-1', subcategorySlug: 'visa-legal' }, VALUES)
    const edit = await editFor(row({ verificationMethod: stamp }))
    expect(edit.licence).toEqual({ approved: true, exempt: false, exemptAisles: [] })
    expect(JSON.stringify(edit)).not.toContain(stamp)
    expect(edit.attributes).toEqual({ providerLegalName: VALUES.legalName, providerLicenceNo: VALUES.licenceNo }) // the fields open prefilled
  })

  it('not approved: no stamp, a stamp of other values, another aisle’s stamp, or a legacy value', async () => {
    const otherNo = licenceStampFor({ sellerId: 'seller-1', subcategorySlug: 'visa-legal' }, { ...VALUES, licenceNo: '79-124/2019/TCDL-GP LHQT' })
    const otherAisle = licenceStampFor({ sellerId: 'seller-1', subcategorySlug: 'legal-permits' }, VALUES)
    for (const verificationMethod of [null, otherNo, otherAisle, 'manual']) {
      expect((await editFor(row({ verificationMethod }))).licence, String(verificationMethod)).toEqual({ approved: false, exempt: false, exemptAisles: [] })
    }
  })

  it('eno’s own desk is exempt — approved whatever its stamp, and asked nothing', async () => {
    h.desk = ['seller-1']
    expect((await editFor(row({ attributes: null }))).licence).toEqual({ approved: true, exempt: true, exemptAisles: ['visa-legal', 'legal-permits'] })
  })

  it('a desk that cannot be read fails CLOSED: not exempt, so the form asks for the values (the server decides the hold)', async () => {
    h.desk = new Error('connection reset')
    expect((await editFor(row({ attributes: null }))).licence).toEqual({ approved: false, exempt: false, exemptAisles: [] })
  })

  it('outside the two aisles there is nothing to check: approved', async () => {
    expect((await editFor(row({ subcategorySlug: 'cleaning', attributes: null }))).licence).toEqual({ approved: true, exempt: false, exemptAisles: [] })
  })
})
