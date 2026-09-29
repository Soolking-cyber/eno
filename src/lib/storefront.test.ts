import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * `shopShareUrl` — the address the Settings "Copy link" chip and a shop's Share button hand out.
 * Owner, 2026-09-26: "give it in alex.eno.vn format and not eno.vn/alex". The rule is the
 * storefront's own: the subdomain only when it would actually SERVE the shop, else the path, because
 * a copied link that 404s is worse than the longer one. Measured on prod the same day:
 * `alex.eno.vn` 200 (a shop), `eska.eno.vn` 404 (a person).
 */
const h = vi.hoisted(() => ({
  handles: new Map<string, { handle: string; seller: { id: string; name: string; bannerUrl: null; bannerMobileUrl: null } | null }>(),
  brands: new Set<string>(),
  /** Every database read, so the batch can be held to its two. */
  reads: 0,
}))

vi.mock('@/lib/db', () => ({
  db: {
    /**
     * The two label reads (I2b), both `Prisma.sql` objects: `storefrontByLabel` asks for the handle
     * equal to the label OR stripping to it; `storefrontCanonicals` for every handle stripping to one
     * of a set. A label has no underscore, so "equal to" is contained in "strips to" and one fake
     * answers both: every handle whose own spelling or underscore-free form is among the values.
     */
    $queryRaw: async (q: { values: unknown[] }) => {
      h.reads++
      const want = new Set(q.values as string[])
      return [...h.handles.values()]
        .filter((r) => want.has(r.handle) || want.has(r.handle.replace(/_/g, '')))
        .map((r) => ({ handle: r.handle, sellerId: r.seller?.id ?? null }))
    },
    handle: {
      findUnique: async ({ where }: { where: { handle: string } }) => h.handles.get(where.handle) ?? null,
      findMany: async ({ where }: { where: { handle: { in: string[] } } }) =>
        where.handle.in.flatMap((k) => { const r = h.handles.get(k); return r ? [{ handle: r.handle, sellerId: r.seller?.id ?? null }] : [] }),
    },
    brand: {
      findUnique: async ({ where }: { where: { slug: string } }) => (h.brands.has(where.slug) ? { slug: where.slug } : null),
      findMany: async ({ where }: { where: { slug: { in: string[] } } }) => {
        h.reads++
        return where.slug.in.filter((s) => h.brands.has(s)).map((slug) => ({ slug }))
      },
    },
  },
}))

const shop = (handle: string) => h.handles.set(handle, { handle, seller: { id: `s-${handle}`, name: handle, bannerUrl: null, bannerMobileUrl: null } })
const person = (handle: string) => h.handles.set(handle, { handle, seller: null })

beforeEach(() => {
  h.handles.clear()
  h.brands.clear()
  h.reads = 0
  vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://eno.vn')
})
afterEach(() => { vi.unstubAllEnvs() })

describe('shopShareUrl', () => {
  it('a shop handle → its own subdomain (the owner\'s alex.eno.vn)', async () => {
    shop('alex')
    const { shopShareUrl } = await import('./storefront')
    expect(await shopShareUrl('alex')).toBe('https://alex.eno.vn')
  })

  it('a handle that names a BRAND keeps the path — the subdomain would not serve it', async () => {
    shop('apple'); h.brands.add('apple')
    const { shopShareUrl } = await import('./storefront')
    expect(await shopShareUrl('apple')).toBe('https://eno.vn/apple')
  })

  it('a PERSON\'s handle keeps the path — <person>.eno.vn is a 404', async () => {
    person('eska')
    const { shopShareUrl } = await import('./storefront')
    expect(await shopShareUrl('eska')).toBe('https://eno.vn/eska')
  })

  it('an underscore handle hands out its underscore-free subdomain (owner, 2026-09-28)', async () => {
    shop('sdc_store')
    const { shopShareUrl } = await import('./storefront')
    expect(await shopShareUrl('sdc_store')).toBe('https://sdcstore.eno.vn')
  })

  it('on eno.forum the subdomain hangs off the bare domain, never www', async () => {
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://www.eno.forum')
    shop('alex')
    const { shopShareUrl } = await import('./storefront')
    expect(await shopShareUrl('alex')).toBe('https://alex.eno.forum')
  })
})

/**
 * `storefrontCanonical` — the one answer for `<link rel="canonical">` and `og:url` on `/<handle>`,
 * the canonical `/sellers/<id>` points at, and the storefront `<loc>` in pages.xml (SEO wave B, I2).
 * The share address IS the canonical, so the two cannot drift.
 */
describe('storefrontCanonical', () => {
  it('is the address shopShareUrl hands out, for every kind of handle', async () => {
    shop('alex'); shop('apple'); h.brands.add('apple'); person('eska'); shop('sdc_store')
    const { shopShareUrl, storefrontCanonical } = await import('./storefront')
    for (const handle of ['alex', 'apple', 'eska', 'sdc_store', 'nobody']) {
      expect(await storefrontCanonical(handle, 'https://eno.vn'), handle).toBe(await shopShareUrl(handle))
    }
    expect(await storefrontCanonical('alex', 'https://eno.vn')).toBe('https://alex.eno.vn')
    expect(await storefrontCanonical('sdc_store', 'https://eno.vn')).toBe('https://sdcstore.eno.vn')
  })

  it('storefrontCanonicals (the sitemap\'s batch) gives the per-handle answer for every kind of handle', async () => {
    everyKind()
    const { storefrontCanonical, storefrontCanonicals } = await import('./storefront')
    const handles = [...KINDS, 'alex']
    for (const origin of ['https://eno.vn', 'https://www.eno.forum']) {
      h.reads = 0
      const batch = await storefrontCanonicals(handles, origin)
      // Two reads for the whole set — the handle rows and the brand slugs — never two per seller.
      expect(h.reads, origin).toBe(2)
      expect(batch.size).toBe(KINDS.length)
      for (const handle of handles) expect(batch.get(handle), `${handle} @ ${origin}`).toBe(await storefrontCanonical(handle, origin))
    }
    expect((await storefrontCanonicals([], 'https://eno.vn')).size).toBe(0)
  })

  it('takes the origin it is given, and a trailing slash does not double', async () => {
    shop('alex'); shop('s_b')
    const { storefrontCanonical } = await import('./storefront')
    expect(await storefrontCanonical('alex', 'https://www.eno.forum')).toBe('https://alex.eno.forum')
    expect(await storefrontCanonical('s_b', 'https://www.eno.forum/')).toBe('https://www.eno.forum/s_b')
  })
})

/**
 * ⛔ WHICH SHOP A SUBDOMAIN LABEL SERVES (SEO wave B, I2b) — owner, 2026-09-28: the subdomain is the
 * handle without underscores. The exact handle first; else the ONE handle that strips to the label;
 * two such handles, a person, or a brand in either spelling → nobody. And a handle's canonical is its
 * subdomain only when that label resolves back to IT, so no link ever names another shop's host.
 */
const KINDS = ['alex', 'apple', 'eska', 'sdc_store', 'eno-trading', 'nobody', 'q_r_s_t', 'my-shop_two',
  'taken', 'tak_en', 'held', 'he_ld', 'ab_cd', 'abc_d', 'app_le', 's_b']
function everyKind() {
  shop('alex'); shop('apple'); h.brands.add('apple'); person('eska'); shop('sdc_store'); shop('eno-trading')
  shop('q_r_s_t'); shop('my-shop_two')
  shop('taken'); shop('tak_en') // the exact handle is a shop: it keeps the host
  person('held'); shop('he_ld') // the exact handle is a person: nobody gets the host
  shop('ab_cd'); shop('abc_d') // two strip to `abcd`, neither is it: nobody
  shop('app_le') // strips to a brand
  shop('s_b') // strips to the Supabase gateway's label
}

describe('storefrontByLabel and the canonical it decides', () => {
  const vn = 'https://eno.vn'

  it('serves the one handle a label strips from — multiple underscores, a hyphen kept', async () => {
    everyKind()
    const { storefrontByLabel, storefrontCanonical } = await import('./storefront')
    expect((await storefrontByLabel('sdcstore'))?.handle).toBe('sdc_store')
    expect((await storefrontByLabel('qrst'))?.handle).toBe('q_r_s_t')
    expect((await storefrontByLabel('my-shoptwo'))?.handle).toBe('my-shop_two')
    expect(await storefrontCanonical('q_r_s_t', vn)).toBe('https://qrst.eno.vn')
    expect(await storefrontCanonical('my-shop_two', vn)).toBe('https://my-shoptwo.eno.vn')
    expect(await storefrontCanonical('eno-trading', vn)).toBe('https://eno-trading.eno.vn')
  })

  it('⛔ the exact handle wins the host, and the other spelling keeps its path', async () => {
    everyKind()
    const { storefrontByLabel, storefrontCanonical } = await import('./storefront')
    expect((await storefrontByLabel('taken'))?.handle).toBe('taken')
    expect(await storefrontCanonical('taken', vn)).toBe('https://taken.eno.vn')
    expect(await storefrontCanonical('tak_en', vn)).toBe('https://eno.vn/tak_en')
  })

  it('⛔ an exact PERSON handle takes the host from nobody and gives it to nobody', async () => {
    everyKind()
    const { storefrontByLabel, storefrontCanonical } = await import('./storefront')
    expect(await storefrontByLabel('held')).toBeNull()
    expect(await storefrontCanonical('he_ld', vn)).toBe('https://eno.vn/he_ld')
  })

  it('⛔ two old handles on one label: nobody is served, both keep their paths', async () => {
    everyKind()
    const { storefrontByLabel, storefrontCanonical } = await import('./storefront')
    expect(await storefrontByLabel('abcd')).toBeNull()
    expect(await storefrontCanonical('ab_cd', vn)).toBe('https://eno.vn/ab_cd')
    expect(await storefrontCanonical('abc_d', vn)).toBe('https://eno.vn/abc_d')
  })

  it('⛔ a brand never gets its subdomain through an underscore', async () => {
    everyKind()
    const { storefrontByLabel, storefrontCanonical } = await import('./storefront')
    expect(await storefrontByLabel('apple')).toBeNull()
    expect(await storefrontCanonical('app_le', vn)).toBe('https://eno.vn/app_le')
  })

  it('a label that is an infra host is never asked: the canonical is the path', async () => {
    everyKind()
    const { storefrontCanonical } = await import('./storefront')
    expect(await storefrontCanonical('s_b', vn)).toBe('https://eno.vn/s_b')
  })

  it('answers the in-place render too, which passes the HANDLE (eno.vn/sdc_store)', async () => {
    everyKind()
    const { storefrontByLabel } = await import('./storefront')
    expect((await storefrontByLabel('sdc_store'))?.handle).toBe('sdc_store')
    expect((await storefrontByLabel('ab_cd'))?.handle).toBe('ab_cd')
    expect((await storefrontByLabel('app_le'))?.handle).toBe('app_le') // the PATH is not a brand's host
    expect(await storefrontByLabel('eska')).toBeNull()
    expect(await storefrontByLabel('nobody')).toBeNull()
  })
})
