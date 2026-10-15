// @vitest-environment jsdom
import * as React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * ADMIN › CATALOGUE › LICENCE CHECKS (owner, 2026-10-14) — src/components/admin/licence-checks.tsx, rendered against a
 * mocked database. Pinned: the read (non-desk, both aisles, no tombstones, capped); the six sections and the groups
 * inside them — waiting rows BY STAMP (one seller + aisle + values = one Approve, with the stamp on screen as `seen`),
 * values missing or invalid with no button, approved-but-unpublished with the reason, approved and live, VietKite's
 * grandfather until its end and a BREACH after it; which action sits on which group; the values printed verbatim in
 * translate="no"; the enterprise-code hint; the warnings at the top; and the overview tile's counts.
 * The stamps are the real licence-stamp.ts ones, so a change to how the tab groups cannot drift from what
 * 'licence-approve' compares `seen` against.
 */

// The licence WHITELIST (src/lib/licence-whitelist.ts — owner, 2026-10-15) is switchable here: EMPTY by default, so the
// tests below pin the check as it runs for everyone else (VietKite's grandfather included); the whitelist's own tests
// turn it on.
const wl = vi.hoisted(() => ({ list: [] as Array<{ sellerId: string; name: string; aisles: string[] }> }))
vi.mock('@/lib/licence-whitelist', () => ({
  get LICENCE_WHITELIST() { return wl.list },
  isLicenceWhitelisted: (sellerId: string | null | undefined, sub: string | null | undefined) =>
    !!sellerId && !!sub && wl.list.some((w) => w.sellerId === sellerId && w.aisles.includes(sub)),
}))
const { findMany, deskSellerIds, licenceGrandfatherProblem } = vi.hoisted(() => ({
  findMany: vi.fn(),
  deskSellerIds: vi.fn(async (): Promise<string[]> => ['desk-seller']),
  licenceGrandfatherProblem: vi.fn(async (): Promise<string | null> => null),
}))
vi.mock('@/lib/db', () => ({ db: { listing: { findMany } } }))
vi.mock('@/lib/edition-scope', () => ({ deskSellerIds }))
vi.mock('@/lib/core/licence-check', () => ({ licenceGrandfatherProblem }))
vi.mock('@/lib/log', () => ({ logError: vi.fn() }))
vi.mock('next/link', () => ({
  default: ({ href, children, prefetch: _p, ...rest }: { href: string; children: React.ReactNode; prefetch?: boolean }) => <a href={href} {...rest}>{children}</a>,
}))
// The button has its own test (licence-action-button.test.tsx). Here the point is WHICH action sits on WHICH group, over
// which ids and with which `seen` — so the stub renders exactly those, as data.
vi.mock('@/components/admin/licence-action-button', () => ({
  LicenceActionButton: (p: { action: string; ids: string[]; seen?: Record<string, string>; unapproved?: boolean; summary: { enterpriseCode?: boolean } }) => (
    <span
      data-licence-action={p.unapproved ? 'unpublish' : p.action}
      data-ids={p.ids.join(',')}
      data-seen={p.seen ? JSON.stringify(p.seen) : undefined}
      data-enterprise={p.summary.enterpriseCode ? '1' : undefined}
    />
  ),
}))

import { LicenceChecks, licenceGrandfatherUntilLabel, licenceQueueCounts } from './licence-checks'
import { LICENCE_GRANDFATHER, licenceGrandfatherEndsAt, licenceStampFor } from '@/lib/licence-stamp'

const VISA = { legalName: 'CÔNG TY TNHH VISA5S.VN', licenceNo: '79-123/2019/TCDL-GP LHQT' }
const LAW = { legalName: 'Công ty Luật TNHH Hoàng Phi', licenceNo: '0312345678' }
const attrs = (v: Partial<typeof VISA> | null) =>
  v ? JSON.stringify({ priceBasis: 'fixed', ...(v.legalName ? { providerLegalName: v.legalName } : {}), ...(v.licenceNo ? { providerLicenceNo: v.licenceNo } : {}) }) : null

type Fixture = {
  id: string; sellerId: string; sub: 'visa-legal' | 'legal-permits'; values?: Partial<typeof VISA> | null
  verified?: boolean; status?: string; identityHold?: boolean; approved?: boolean; reports?: string[]
  description?: string; seller?: Partial<{ name: string; officialPartner: boolean; email: string; accountType: string | null; enforcementState: string }>
}
function row(f: Fixture) {
  const values = f.values === undefined ? VISA : f.values
  const full = values?.legalName && values.licenceNo ? { legalName: values.legalName, licenceNo: values.licenceNo } : null
  return {
    id: f.id,
    title: `Listing ${f.id}`,
    status: f.status ?? 'active',
    verified: f.verified ?? false,
    identityHold: f.identityHold ?? false,
    images: JSON.stringify([`https://img.example/${f.id}.jpg`]),
    description: f.description ?? `About ${f.id}.`,
    attributes: attrs(values),
    verificationMethod: f.approved && full ? licenceStampFor({ sellerId: f.sellerId, subcategorySlug: f.sub }, full) : null,
    verifiedAt: f.approved ? new Date('2026-10-14T03:00:00Z') : null,
    subcategorySlug: f.sub,
    sellerId: f.sellerId,
    category: { slug: 'services' },
    seller: {
      name: f.seller?.name ?? `Shop ${f.sellerId}`,
      officialPartner: f.seller?.officialPartner ?? false,
      owner: { id: `owner-${f.sellerId}`, email: f.seller?.email ?? `${f.sellerId}@example.vn`, accountType: f.seller?.accountType === undefined ? 'business' : f.seller.accountType, enforcementState: f.seller?.enforcementState ?? 'good_standing' },
    },
    reports: (f.reports ?? []).map((status) => ({ status })),
  }
}

const VK = LICENCE_GRANDFATHER.sellerId
const ROWS = [
  // 1. Waiting: two of seller-a's with the same values (ONE group), the same values from seller-b (its OWN group — the
  //    stamp binds the seller), and a law firm's bare enterprise code.
  row({ id: 'p1', sellerId: 'seller-a', sub: 'visa-legal' }),
  row({ id: 'p2', sellerId: 'seller-a', sub: 'visa-legal', status: 'hidden' }),
  row({ id: 'p3', sellerId: 'seller-b', sub: 'visa-legal' }),
  row({ id: 'e1', sellerId: 'seller-law', sub: 'legal-permits', values: LAW }),
  // 2. Missing or invalid: nothing typed; a personal ID as the number.
  row({ id: 'm1', sellerId: 'seller-c', sub: 'visa-legal', values: null, seller: { accountType: 'individual', enforcementState: 'held' } }),
  row({ id: 'm2', sellerId: 'seller-c', sub: 'legal-permits', values: { legalName: 'Công ty Luật ABC', licenceNo: '079123456789' } }),
  // 3. Approved, still unpublished: parked for identity; hidden by its seller; an open + a confirmed report.
  row({ id: 'a1', sellerId: 'seller-a', sub: 'visa-legal', approved: true, identityHold: true }),
  row({ id: 'a2', sellerId: 'seller-a', sub: 'visa-legal', approved: true, verified: true, status: 'hidden' }),
  row({ id: 'a3', sellerId: 'seller-a', sub: 'visa-legal', approved: true, reports: ['open', 'confirmed'] }),
  // 4. Approved and live.
  row({ id: 'l1', sellerId: 'seller-e', sub: 'visa-legal', approved: true, verified: true, seller: { officialPartner: true } }),
  // 5. VietKite's grandfathered rows: live, e-Visa, no values.
  row({ id: 'g1', sellerId: VK, sub: 'visa-legal', values: null, verified: true, seller: { name: 'VietKite' } }),
  row({ id: 'g2', sellerId: VK, sub: 'visa-legal', values: null, verified: true, seller: { name: 'VietKite' } }),
  // 6. Live without a checked licence: complete values never approved; no values at all.
  row({ id: 'b1', sellerId: 'seller-f', sub: 'legal-permits', values: { legalName: 'Công ty Luật XYZ', licenceNo: '41.02.1234/TP/ĐKHĐ' }, verified: true }),
  row({ id: 'b2', sellerId: 'seller-g', sub: 'visa-legal', values: null, verified: true }),
]

const END = licenceGrandfatherEndsAt()
const BEFORE = END - 86_400_000

async function render(now: number) {
  const html = renderToStaticMarkup(await LicenceChecks({ now }))
  return new DOMParser().parseFromString(html, 'text/html')
}
/** A group's listing lines — the items that carry a listing's thumbnail (problem and reason lists are items too). */
const listingLines = (group: Element) => [...group.querySelectorAll('li')].filter((x) => x.querySelector(':scope > img'))
/** The groups of one section, each as { ids of its listings, its action stubs, its text }. */
function groups(doc: Document, section: string) {
  const el = doc.getElementById(section)
  if (!el) return null
  return [...el.querySelectorAll(':scope > ul > li')].map((li) => ({
    listings: listingLines(li).map((x) => x.querySelector('img')?.getAttribute('src')?.match(/\/(\w+)\.jpg$/)?.[1]),
    actions: [...li.querySelectorAll('[data-licence-action]')].map((a) => ({ action: a.getAttribute('data-licence-action'), ids: a.getAttribute('data-ids'), seen: a.getAttribute('data-seen'), enterprise: a.getAttribute('data-enterprise') })),
    text: li.textContent ?? '',
    verbatim: [...li.querySelectorAll('[translate="no"]')].map((x) => x.textContent),
    li,
  }))
}

beforeEach(() => {
  wl.list = []
  findMany.mockReset()
  findMany.mockResolvedValue(ROWS)
  deskSellerIds.mockReset()
  deskSellerIds.mockResolvedValue(['desk-seller'])
  licenceGrandfatherProblem.mockReset()
  licenceGrandfatherProblem.mockResolvedValue(null)
})

describe('LicenceChecks — the read', () => {
  it('reads every non-desk, non-tombstone row in both aisles, waiting ones first, capped at 500', async () => {
    await render(BEFORE)
    const args = findMany.mock.calls[0][0]
    expect(args.where).toEqual({
      status: { not: 'removed' },
      category: { slug: 'services' },
      subcategorySlug: { in: ['visa-legal', 'legal-permits'] },
      sellerId: { notIn: ['desk-seller'] },
    })
    expect(args.orderBy).toEqual([{ verified: 'asc' }, { createdAt: 'desc' }])
    // One past the cap (commit gate): "capped" then means a row was cut off, not that there were exactly 500.
    expect(args.take).toBe(501)
    // Both report statuses 'licence-approve' refuses to publish over.
    expect(args.select.reports).toEqual({ where: { status: { in: ['open', 'confirmed'] } }, select: { status: true } })
  })

  it('an UNRESOLVED desk drops the exclusion (its rows then read as anyone’s, as every write path treats them) and says so', async () => {
    deskSellerIds.mockResolvedValue([])
    const doc = await render(BEFORE)
    expect(findMany.mock.calls[0][0].where).not.toHaveProperty('sellerId')
    expect(doc.body.textContent).toContain('eno\'s desk did not resolve on this server')
  })
})

describe('LicenceChecks — the sections', () => {
  it('1. waiting rows are grouped BY STAMP: one seller’s identical values are one Approve, with that stamp as `seen` per id', async () => {
    const doc = await render(BEFORE)
    const g = groups(doc, 'licence-pending')!
    expect(g.map((x) => x.listings)).toEqual([['p1', 'p2'], ['p3'], ['e1']])
    const stampA = licenceStampFor({ sellerId: 'seller-a', subcategorySlug: 'visa-legal' }, VISA)
    const stampB = licenceStampFor({ sellerId: 'seller-b', subcategorySlug: 'visa-legal' }, VISA)
    expect(stampA).not.toBe(stampB)
    expect(g[0].actions).toEqual([{ action: 'licence-approve', ids: 'p1,p2', seen: JSON.stringify({ p1: stampA, p2: stampA }), enterprise: null }])
    expect(g[1].actions).toEqual([{ action: 'licence-approve', ids: 'p3', seen: JSON.stringify({ p3: stampB }), enterprise: null }])
    // The values, verbatim and untranslatable.
    expect(g[0].verbatim).toEqual([VISA.legalName, VISA.licenceNo])
    expect(g[0].text).toContain('e-Visa · 2 listings')
    expect(g[0].text).toContain('Shop seller-a')
    expect(g[0].text).toContain('seller-a@example.vn')
    expect(g[0].text).toContain('Business account')
  })

  it('a bare enterprise code is flagged: the same shape as a phone number', async () => {
    const doc = await render(BEFORE)
    const law = groups(doc, 'licence-pending')![2]
    expect(law.text).toContain('Legal & permits · 1 listing')
    expect(law.text).toContain('Licence / registration no.')
    expect(law.verbatim).toEqual([LAW.legalName, LAW.licenceNo])
    expect(law.text).toContain('Same shape as a phone number: compare it with the registration certificate.')
    expect(law.actions[0].enterprise).toBe('1')
    // …and only there.
    expect(groups(doc, 'licence-pending')![0].text).not.toContain('Same shape as a phone number')
  })

  it('2. missing or invalid values: no button, the problem per field, and where the seller fixes it', async () => {
    const doc = await render(BEFORE)
    const g = groups(doc, 'licence-missing')!
    expect(g.map((x) => x.listings)).toEqual([['m1'], ['m2']])
    expect(g.flatMap((x) => x.actions)).toEqual([])
    // Nothing typed: both values read "not entered", once — no second "not entered" line under them.
    expect([...g[0].li.querySelectorAll('dd')].map((d) => d.textContent)).toEqual(['not entered', 'not entered'])
    expect(g[0].text).not.toContain(': not entered')
    expect(g[0].verbatim).toEqual([])
    expect(g[0].text).toContain('Individual account')
    expect(g[0].text).toContain('Owner held')
    // Named as the values above name it in Legal & permits.
    expect(g[1].text).toContain('Licence / registration no.: looks like a personal ID number')
    // What was typed is still shown as typed, so the admin can tell the seller what is wrong.
    expect(g[1].verbatim).toEqual(['Công ty Luật ABC', '079123456789'])
    expect(doc.getElementById('licence-missing')!.textContent).toContain('the seller adds them in the post form')
  })

  it('3. approved but unpublished: Revoke, and WHY each one is not live', async () => {
    const doc = await render(BEFORE)
    const g = groups(doc, 'licence-unpublished')!
    expect(g).toHaveLength(1)
    expect(g[0].listings).toEqual(['a1', 'a2', 'a3'])
    expect(g[0].actions).toEqual([{ action: 'licence-revoke', ids: 'a1,a2,a3', seen: null, enterprise: null }])
    expect(g[0].text).toContain('approved 14 Oct 2026')
    const [a1, a2, a3] = listingLines(g[0].li).map((x) => x.textContent ?? '')
    expect(a1).toContain('Parked until the seller verifies their identity')
    expect(a2).toContain('Status hidden: it is live again once it is relisted.')
    expect(a3).toContain('1 open report')
    expect(a3).toContain('1 confirmed report')
    expect(a3).toContain('An open or confirmed report: approving does not publish it.')
  })

  it('4. approved and live: Revoke, and a link to the page (only a live row has one)', async () => {
    const doc = await render(BEFORE)
    const g = groups(doc, 'licence-live')!
    expect(g.map((x) => x.listings)).toEqual([['l1']])
    expect(g[0].actions).toEqual([{ action: 'licence-revoke', ids: 'l1', seen: null, enterprise: null }])
    expect(g[0].text).toContain('Official partner')
    expect(g[0].li.querySelector('a[href="/listings/l1"]')).not.toBeNull()
    // A waiting row has no page to open.
    expect(doc.querySelector('a[href="/listings/p1"]')).toBeNull()
  })

  it('5. VietKite’s rows are grandfathered until the end — no button, the date in the hint', async () => {
    const doc = await render(BEFORE)
    const g = groups(doc, 'licence-grandfathered')!
    expect(g.map((x) => x.listings)).toEqual([['g1', 'g2']])
    expect(g[0].actions).toEqual([])
    expect(doc.getElementById('licence-grandfathered')!.textContent).toContain(`VietKite, live without a checked licence until ${licenceGrandfatherUntilLabel()}`)
  })

  it('6. live without a checked licence: Unpublish everywhere, Approve only where both values are there — and a warning on top', async () => {
    const doc = await render(BEFORE)
    const g = groups(doc, 'licence-breach')!
    expect(g.map((x) => x.listings)).toEqual([['b1'], ['b2']])
    const stamp = licenceStampFor({ sellerId: 'seller-f', subcategorySlug: 'legal-permits' }, { legalName: 'Công ty Luật XYZ', licenceNo: '41.02.1234/TP/ĐKHĐ' })
    expect(g[0].actions).toEqual([
      { action: 'licence-approve', ids: 'b1', seen: JSON.stringify({ b1: stamp }), enterprise: null },
      { action: 'unpublish', ids: 'b1', seen: null, enterprise: null },
    ])
    expect(g[1].actions).toEqual([{ action: 'unpublish', ids: 'b2', seen: null, enterprise: null }])
    expect(doc.body.textContent).toContain('2 listings are live without a checked licence')
    expect(doc.querySelector('a[href="#licence-breach"]')).not.toBeNull()
  })

  it('AT the end the grandfather is over: VietKite’s rows are a breach, and the section is gone', async () => {
    const doc = await render(END)
    expect(doc.getElementById('licence-grandfathered')).toBeNull()
    const g = groups(doc, 'licence-breach')!
    expect(g.map((x) => x.listings)).toEqual([['g1', 'g2'], ['b1'], ['b2']])
    expect(g[0].actions).toEqual([{ action: 'unpublish', ids: 'g1,g2', seen: null, enterprise: null }])
    expect(doc.body.textContent).toContain('4 listings are live without a checked licence')
    // After the end the grandfather's identity is no longer read at all.
    expect(licenceGrandfatherProblem).not.toHaveBeenCalled()
  })

  it('every row is listed exactly once', async () => {
    const doc = await render(BEFORE)
    const listed = ['licence-pending', 'licence-missing', 'licence-unpublished', 'licence-live', 'licence-grandfathered', 'licence-breach']
      .flatMap((s) => groups(doc, s)!.flatMap((g) => g.listings))
    expect(listed.sort()).toEqual(ROWS.map((r) => r.id).sort())
  })

  it('an empty queue says so in each section and shows no button at all', async () => {
    findMany.mockResolvedValue([])
    const doc = await render(BEFORE)
    expect(doc.getElementById('licence-pending')!.textContent).toContain('Nothing is waiting.')
    expect(doc.getElementById('licence-breach')!.textContent).toContain('None, as expected.')
    expect(doc.querySelectorAll('[data-licence-action]')).toHaveLength(0)
  })
})

// ⛔ Owner, 2026-10-15: "whitelist vietkite" (src/lib/licence-whitelist.ts) — its e-Visa rows are exempt: in no section, in
// no count.
describe('LicenceChecks — the licence whitelist', () => {
  it('a whitelisted storefront’s e-Visa rows are in no section and no count; its Legal & permits row is checked as usual', async () => {
    wl.list = [{ sellerId: 'seller-wl', name: 'wl', aisles: ['visa-legal'] }]
    findMany.mockResolvedValue([
      row({ id: 'wl1', sellerId: 'seller-wl', sub: 'visa-legal', verified: true, values: null }),
      row({ id: 'wllp', sellerId: 'seller-wl', sub: 'legal-permits', values: null }),
    ])
    const doc = await render(BEFORE)
    expect(doc.body.innerHTML).not.toContain('wl1')
    expect(groups(doc, 'licence-missing')!.map((g) => g.listings)).toEqual([['wllp']])
    findMany.mockResolvedValue([row({ id: 'wl1', sellerId: 'seller-wl', sub: 'visa-legal', verified: true, values: null })])
    expect(await licenceQueueCounts(BEFORE)).toMatchObject({ waiting: 0, breach: 0 })
  })

})

describe('LicenceChecks — the rest of a group', () => {
  it('the description is cut at 400 characters', async () => {
    findMany.mockResolvedValue([row({ id: 'p1', sellerId: 'seller-a', sub: 'visa-legal', description: 'x'.repeat(450) })])
    const doc = await render(BEFORE)
    const p = listingLines(groups(doc, 'licence-pending')![0].li)[0].querySelector('p')!
    expect(p.textContent).toBe(`${'x'.repeat(400)}…`)
  })

  it('an unresolved grandfather is said at the top, while the window is open', async () => {
    licenceGrandfatherProblem.mockResolvedValue('storefront s-9: its handle is not "vietkite"')
    const doc = await render(BEFORE)
    expect(doc.body.textContent).toContain('VietKite\'s grandfather does not resolve')
    expect(doc.body.textContent).toContain('storefront s-9: its handle is not "vietkite". Until the seller id, handle and owner name one storefront again')
  })

  // Commit gate, 2026-10-14: only when the grandfather does not resolve (the sweep then leaves VietKite's rows alone) do
  // they carry Unpublish — otherwise a misclick could pull them early with no way back in the window.
  it('a grandfather that does not resolve gives its rows Unpublish — the one way down while the sweep refuses', async () => {
    licenceGrandfatherProblem.mockResolvedValue('storefront s-9: its handle is not "vietkite"')
    const doc = await render(BEFORE)
    expect(groups(doc, 'licence-grandfathered')![0].actions).toEqual([{ action: 'unpublish', ids: 'g1,g2', seen: null, enterprise: null }])
  })

  it('a failed grandfather check is said too, not thrown — and it offers no Unpublish (a failed read is not a problem)', async () => {
    licenceGrandfatherProblem.mockRejectedValue(new Error('db down'))
    const doc = await render(BEFORE)
    expect(doc.body.textContent).toContain('VietKite\'s grandfather could not be checked')
    expect(groups(doc, 'licence-grandfathered')![0].actions).toEqual([])
  })

  // Commit gate, 2026-10-14: a failed read degrades to one alert, never a failed Catalogue page.
  it('a failed read of the rows is one alert, not a thrown page', async () => {
    findMany.mockRejectedValueOnce(new Error('db down'))
    const doc = await render(BEFORE)
    expect(doc.body.textContent).toContain('The licence checks could not be read')
  })
})

describe('licenceQueueCounts — the overview tile', () => {
  it('counts what waits (values to compare, values missing, grandfathered) and, apart, what is live against the rule', async () => {
    expect(await licenceQueueCounts(BEFORE)).toEqual({ waiting: 10, pending: 5, missing: 3, grandfathered: 2, breach: 2, deskUnresolved: false })
    expect(findMany.mock.calls[0][0].where).toEqual({
      status: { not: 'removed' },
      category: { slug: 'services' },
      subcategorySlug: { in: ['visa-legal', 'legal-permits'] },
      sellerId: { notIn: ['desk-seller'] },
    })
    // Uncapped: a count of every row, not of the first page.
    expect(findMany.mock.calls[0][0]).not.toHaveProperty('take')
  })

  it('after the grandfather ends, VietKite’s rows count as missing — and as a breach', async () => {
    expect(await licenceQueueCounts(END)).toEqual({ waiting: 10, pending: 5, missing: 5, grandfathered: 0, breach: 4, deskUnresolved: false })
  })

  // Commit gate, 2026-10-14: with no desk ids, eno's own e-Visa rows count as anyone's — the tile must say so.
  it('an unresolved desk is flagged, and nothing is excluded by id', async () => {
    deskSellerIds.mockResolvedValueOnce([])
    const c = await licenceQueueCounts(BEFORE)
    expect(c.deskUnresolved).toBe(true)
    expect(findMany.mock.calls[0][0].where).not.toHaveProperty('sellerId')
  })
})

describe('licenceGrandfatherUntilLabel', () => {
  it('is 00:00 in Vietnam on LICENCE_GRANDFATHER.until, whatever the server’s own time zone', () => {
    const [y, m, d] = LICENCE_GRANDFATHER.until.split('-').map(Number)
    const month = new Date(Date.UTC(y, m - 1, 1)).toLocaleString('en-GB', { month: 'short', timeZone: 'UTC' })
    expect(licenceGrandfatherUntilLabel()).toBe(`${d} ${month} ${y}, 00:00 ICT`)
  })
})
