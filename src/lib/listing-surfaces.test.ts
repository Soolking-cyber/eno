import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ purged: [] as string[], reindexed: [] as string[], throwOn: new Set<string>(), afterAvailable: true }))
vi.mock('server-only', () => ({}))
vi.mock('@/lib/revalidate-lang', () => ({
  revalidatePublicPath: (path: string, type?: string) => {
    if (h.throwOn.has(path)) throw new Error('boom')
    h.purged.push(type ? `${path}|${type}` : path)
  },
}))
vi.mock('@/lib/listing-index', () => ({ reindexListing: async (id: string) => { h.reindexed.push(id) } }))
vi.mock('@/lib/log', () => ({ logError: () => {} }))
vi.mock('next/server', () => ({
  after: (fn: () => unknown) => {
    if (!h.afterAvailable) throw new Error('after() outside a request scope')
    void fn()
  },
}))

import { readdirSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { getImplicitTags } from 'next/dist/server/lib/implicit-tags'
import { REVALIDATE_CAP, refreshListingSurfaces } from './listing-surfaces'

const flush = () => new Promise((r) => setTimeout(r, 0))

beforeEach(() => {
  h.purged = []; h.reindexed = []; h.throwOn = new Set(); h.afterAvailable = true
})

describe('refreshListingSurfaces — what the world sees follows the database', () => {
  it('purges each listing page and re-syncs each in AI search', async () => {
    refreshListingSurfaces(['a', 'b'])
    await flush()
    expect(h.purged).toEqual(['/listings/a', '/listings/b'])
    expect(h.reindexed).toEqual(['a', 'b'])
  })

  it('one purge that throws does not leave the rest stale (continue, not break)', async () => {
    h.throwOn.add('/listings/a')
    refreshListingSurfaces(['a', 'b', 'c'])
    await flush()
    expect(h.purged).toEqual(['/listings/b', '/listings/c'])
  })

  it(`above ${REVALIDATE_CAP} ids it purges the whole route once instead`, async () => {
    const ids = Array.from({ length: REVALIDATE_CAP + 1 }, (_, i) => `l${i}`)
    refreshListingSurfaces(ids)
    await flush()
    // 'layout': the PDP sits in the (pdp) route group, so a 'page' pattern would match no cached page.
    expect(h.purged).toEqual(['/listings/[id]|layout'])
    expect(h.reindexed).toHaveLength(ids.length)
  })

  /**
   * ⛔ THE ASSERTION ABOVE ONLY PROVES WHICH STRING WAS PASSED — a purge whose tag no cached page
   * carries returns normally and changes nothing. This runs NEXT'S OWN tag derivation on the product
   * page's real file path, read off disk, so moving the page (into a route group, as happened
   * 2026-09-23) cannot quietly turn the whole-route purge into a no-op.
   */
  it('the whole-route purge names a tag the product page actually carries', async () => {
    refreshListingSurfaces(Array.from({ length: REVALIDATE_CAP + 1 }, (_, i) => `l${i}`))
    await flush()
    const [path, type] = h.purged[0].split('|')
    // revalidatePublicPath prefixes the hidden [lang] segment; Next's revalidatePath appends `/<type>`.
    const purgeTag = `_N_T_/[lang]${path}/${type}`

    const root = join(process.cwd(), 'src/app')
    const walk = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
      e.isDirectory() ? walk(join(dir, e.name)) : e.name === 'page.tsx' ? [join(dir, e.name)] : [])
    const pages = walk(join(root, '[lang]/listings/[id]'))
    expect(pages.filter((f) => !f.split(sep).includes('edit')), 'the product page itself').not.toHaveLength(0)
    for (const file of pages) {
      const routeKey = '/' + relative(root, file).split(sep).join('/').replace(/\.tsx$/, '')
      const { tags } = await getImplicitTags(routeKey, '/en/listings/l0', null)
      expect(tags, routeKey).toContain(purgeTag)
    }
  })

  it('outside a request scope (cron, script) the reindex still runs', async () => {
    h.afterAvailable = false
    refreshListingSurfaces(['a'])
    await flush()
    expect(h.reindexed).toEqual(['a'])
  })

  it('home too when asked (auto-holds), and a failed purge is logged once, not swallowed', async () => {
    refreshListingSurfaces(['a'], 'x', { home: true })
    await flush()
    expect(h.purged).toEqual(['/listings/a', '/'])
  })

  it('nothing to do for no ids', async () => {
    refreshListingSurfaces([])
    await flush()
    expect(h.purged).toEqual([]); expect(h.reindexed).toEqual([])
  })
})
