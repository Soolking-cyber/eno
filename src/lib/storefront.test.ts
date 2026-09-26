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
}))

vi.mock('@/lib/db', () => ({
  db: {
    handle: { findUnique: async ({ where }: { where: { handle: string } }) => h.handles.get(where.handle) ?? null },
    brand: { findUnique: async ({ where }: { where: { slug: string } }) => (h.brands.has(where.slug) ? { slug: where.slug } : null) },
  },
}))

const shop = (handle: string) => h.handles.set(handle, { handle, seller: { id: `s-${handle}`, name: handle, bannerUrl: null, bannerMobileUrl: null } })
const person = (handle: string) => h.handles.set(handle, { handle, seller: null })

beforeEach(() => {
  h.handles.clear()
  h.brands.clear()
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

  it('an underscore handle cannot be a host label, so it keeps the path', async () => {
    shop('sdc_store')
    const { shopShareUrl } = await import('./storefront')
    expect(await shopShareUrl('sdc_store')).toBe('https://eno.vn/sdc_store')
  })

  it('on eno.forum the subdomain hangs off the bare domain, never www', async () => {
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://www.eno.forum')
    shop('alex')
    const { shopShareUrl } = await import('./storefront')
    expect(await shopShareUrl('alex')).toBe('https://alex.eno.forum')
  })
})
