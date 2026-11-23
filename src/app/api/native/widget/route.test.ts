// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

/** GET /api/native/widget — the iOS widget's tiles in the asked language, public and cached; 503 while there is no feed. */
const h = vi.hoisted(() => ({ feed: null as unknown }))
vi.mock('@/lib/native-surfaces', () => ({ widgetFeed: async () => h.feed }))

import { GET } from './route'

const tile = (title: string) => ({ id: 'l1', title, price: '12.8M đ', image: 'https://eno.vn/_next/image?url=x&w=256&q=60' })

beforeEach(() => { h.feed = { en: [tile('Bike')], vi: [tile('Xe đạp')] } })

describe('GET /api/native/widget', () => {
  it('English unless the URL asks for Vietnamese, marked public', async () => {
    const en = await GET(new Request('https://eno.vn/api/native/widget'))
    expect(en.status).toBe(200)
    expect(await en.json()).toEqual({ items: [tile('Bike')] })
    expect(en.headers.get('cache-control')).toContain('public')
    const vi = await GET(new Request('https://eno.vn/api/native/widget?lang=vi'))
    expect((await vi.json()).items[0].title).toBe('Xe đạp')
    const other = await GET(new Request('https://eno.vn/api/native/widget?lang=ko'))
    expect((await other.json()).items[0].title).toBe('Bike')
  })

  it('no feed yet: 503, never cached', async () => {
    h.feed = null
    const res = await GET(new Request('https://eno.vn/api/native/widget'))
    expect(res.status).toBe(503)
    expect(res.headers.get('cache-control')).toBe('no-store')
    expect(await res.json()).toEqual({ items: [] })
  })
})
