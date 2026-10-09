import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The saved-search alert's link follows the RECIPIENT's saved language (A1-LANG item 10): `/vi?…` for a
 * Vietnamese reader — the plain `/` is English for everyone (V-a), so `/?…` switched them to English —
 * and the plain `/?…` for everyone else. The same URL goes into the in-app notification and the push.
 * The database, the push sender and the scope are stubbed: only the URL the cron writes is under test.
 */
const h = vi.hoisted(() => ({
  searches: [] as unknown[],
  notifications: [] as { recipientId: string; url: string }[],
  pushes: [] as { profileId: string; url: string }[],
}))
vi.mock('server-only', () => ({}))
vi.mock('@/lib/ratelimit', () => ({ rateLimit: async () => ({ success: true }) }))
vi.mock('@/lib/db', () => ({
  db: {
    savedSearch: {
      findMany: async () => h.searches,
      update: (a: unknown) => a,
    },
    listing: { count: async () => 3 },
    notification: {
      create: ({ data }: { data: { recipientId: string; url: string } }) => { h.notifications.push(data); return data },
    },
    $transaction: async (ops: unknown[]) => ops,
  },
}))
vi.mock('@/lib/push', () => ({
  sendPushToProfile: async (profileId: string, p: { url: string }) => { h.pushes.push({ profileId, url: p.url }); return 1 },
}))
vi.mock('@/lib/edition-scope', () => ({ scopedListingWhere: async (w: unknown) => w }))
vi.mock('@/lib/saved-search-where', () => ({ buildListingWhere: async () => ({}) }))
// vitest runs as the SERVICES edition, where the `/vi` pilot is off; the cron runs on eno.vn (the
// marketplace), so put its lists in front of localizedHref.
vi.mock('@/lib/lang-pinned', async (importOriginal) => {
  const m = await importOriginal<typeof import('@/lib/lang-pinned')>()
  return { ...m, localizedHref: (href: string, variant: string) => m.localizedHref(href, variant, { live: m.VI_PREFIX_PATHS, retired: [] }) }
})

const { GET } = await import('./route')
const { readExplorerUrl } = await import('@/lib/explorer-url')
const req = () => new Request('https://eno.vn/api/cron/saved-search-alerts', { headers: { authorization: 'Bearer cron-secret' } })
const search = (id: string, locale: string | null) => ({
  id,
  profileId: `p-${id}`,
  label: 'Rentals in District 2',
  params: JSON.stringify({ category: 'rentals', district: 'd2' }),
  lastNotifiedAt: new Date('2026-10-01T00:00:00Z'),
  profile: { locale },
})

beforeEach(() => {
  process.env.CRON_SECRET = 'cron-secret'
  h.searches = []
  h.notifications = []
  h.pushes = []
})

describe('GET /api/cron/saved-search-alerts — the alert link speaks the recipient\'s language', () => {
  it('a Vietnamese recipient gets the /vi twin in the bell and the push; English and unset keep the plain URL', async () => {
    h.searches = [search('vi', 'vi'), search('en', 'en'), search('none', null), search('ko', 'ko')]
    const res = await GET(req())
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ ok: true, notified: 4 })
    const byRecipient = Object.fromEntries(h.notifications.map((n) => [n.recipientId, n.url]))
    expect(byRecipient).toEqual({
      'p-vi': '/vi?category=rentals&district=d2',
      'p-en': '/?category=rentals&district=d2',
      'p-none': '/?category=rentals&district=d2',
      // A machine-translated language rides on the English variant.
      'p-ko': '/?category=rentals&district=d2',
    })
    // The push carries exactly the bell's URL.
    expect(Object.fromEntries(h.pushes.map((p) => [p.profileId, p.url]))).toEqual(byRecipient)
  })
})

/**
 * ⛔ A RANGE ALERT OPENS ON ITS RANGE (2026-10-09). A range facet is stored under `attrs` by facet key, and the link went
 * out as `attr_year=…` — a param the explorer drops (it reads a range only as `range_<column>`), so the tap opened every
 * vehicle. The link is toUrlParams, which now names it the way the explorer does (taxonomy.ts facetParamName).
 */
describe('GET /api/cron/saved-search-alerts — a range alert links to its range', () => {
  it('the bell and the push open `range_<column>`, which the explorer reads back into the same filter', async () => {
    h.searches = [{ ...search('en', 'en'), params: JSON.stringify({ category: 'vehicles', attrs: { year: '2018-2022' } }) }]
    await GET(req())
    expect(h.notifications.map((n) => n.url)).toEqual(['/?category=vehicles&range_year=2018-2022'])
    expect(h.pushes.map((p) => p.url)).toEqual(['/?category=vehicles&range_year=2018-2022'])
    expect(readExplorerUrl(new URL(h.notifications[0].url, 'https://eno.vn').search).customFilters).toEqual({ year: '2018-2022' })
  })
})
