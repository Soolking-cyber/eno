import { beforeEach, describe, expect, it, vi } from 'vitest'

/** The collector's source-failure rules, over fake sitemap handlers. */
const h = vi.hoisted(() => ({
  index: { status: 200, body: '' },
  children: {} as Record<string, { status: number; body: string }>,
  pages: { xml: '', frozen: [] as string[] } as { xml: string; frozen: string[] } | Error,
  childCalls: [] as string[],
}))
vi.mock('@/app/sitemap.xml/route', () => ({ GET: async () => new Response(h.index.body, { status: h.index.status }) }))
vi.mock('@/app/sitemaps/[file]/route', () => ({
  GET: async (_req: Request, { params }: { params: Promise<{ file: string }> }) => {
    const { file } = await params
    h.childCalls.push(file)
    const c = h.children[file] ?? { status: 404, body: 'Not Found' }
    return new Response(c.body, { status: c.status })
  },
}))
vi.mock('@/app/sitemaps/pages.xml/build', () => ({
  buildPagesSitemap: async (opts: { rentIndex: string }) => {
    if (opts.rentIndex !== 'optional') throw new Error('the collector must use optional mode')
    if (h.pages instanceof Error) throw h.pages
    return h.pages
  },
}))

import { collectSitemaps } from './collect'

const idx = (...children: string[]) => `<sitemapindex>${children.map((c) => `<sitemap><loc>https://eno.vn${c}</loc></sitemap>`).join('')}</sitemapindex>`
const set = (...u: Array<[string, string?]>) => `<urlset>${u.map(([l, m]) => `<url><loc>${l}</loc>${m ? `<lastmod>${m}</lastmod>` : ''}</url>`).join('')}</urlset>`

beforeEach(() => {
  h.index = { status: 200, body: idx('/sitemaps/pages.xml', '/sitemaps/listings-0.xml') }
  h.children = { 'listings-0.xml': { status: 200, body: set(['https://eno.vn/listings/a', '2026-09-01']) } }
  h.pages = { xml: set(['https://eno.vn/'], ['https://eno.vn/about']), frozen: [] }
  h.childCalls = []
})

describe('collectSitemaps', () => {
  it('merges every child, host-filtered, and passes the builder\'s frozen list through', async () => {
    h.pages = { xml: set(['https://eno.vn/'], ['https://www.eno.forum/x']), frozen: ['/c/rentals/', '/hcmc-rent-index'] }
    const got = await collectSitemaps()
    expect([...got.urls]).toEqual([['https://eno.vn/', ''], ['https://eno.vn/listings/a', '2026-09-01']])
    expect(got.frozen).toEqual(['/c/rentals/', '/hcmc-rent-index'])
    expect(h.childCalls).toEqual(['listings-0.xml'])
  })

  it.each([
    ['the index answers non-200', () => { h.index = { status: 500, body: '{}' } }, /sitemap.xml answered 500/],
    ['the index names no child', () => { h.index = { status: 200, body: '<sitemapindex></sitemapindex>' } }, /no child/],
    ['an unknown child', () => { h.index.body = idx('/sitemaps/pages.xml', '/sitemaps/other.xml') }, /unknown child/],
    ['a child outside /sitemaps/', () => { h.index.body = idx('/sitemaps/pages.xml', '/listings-0.xml') }, /unknown child/],
    ['a child answering non-200', () => { h.children['listings-0.xml'] = { status: 500, body: '{}' } }, /answered 500/],
    ['a child with no loc', () => { h.children['listings-0.xml'] = { status: 200, body: '<urlset></urlset>' } }, /lists no URL/],
    ['the builder throws', () => { h.pages = new Error('db down') }, /db down/],
    ['one child with only other hosts, even when another child has eno.vn URLs', () => {
      h.children['listings-0.xml'] = { status: 200, body: set(['https://www.eno.forum/listings/a']) }
    }, /listings-0.xml lists no URL on https/],
    ['no URL on https://eno.vn', () => {
      h.pages = { xml: set(['https://www.eno.vn/']), frozen: [] }
      h.children['listings-0.xml'] = { status: 200, body: set(['https://www.eno.vn/listings/a']) }
    }, /pages.xml lists no URL on https:\/\/eno.vn/],
  ])('%s is a source failure', async (_name, arrange, message) => {
    arrange()
    await expect(collectSitemaps()).rejects.toThrow(message)
  })
})
