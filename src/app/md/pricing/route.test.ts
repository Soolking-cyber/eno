import { afterEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'

/**
 * /pricing.md (ora.ai pricing-md): what using the marketplace costs, only from the fees clauses, marketplace only, and only
 * while POSTING_IS_FREE. The structured twin (makesOffer, 0 VND) is pinned in src/lib/site-identity.test.ts.
 */
async function load(edition: 'marketplace' | 'services', free = true) {
  vi.resetModules()
  vi.stubEnv('NEXT_PUBLIC_ENO_EDITION', edition)
  vi.stubEnv('NEXT_PUBLIC_APP_URL', edition === 'marketplace' ? 'https://eno.vn' : 'https://www.eno.forum')
  vi.doMock('@/lib/site-identity', async (orig) => ({ ...(await orig<typeof import('@/lib/site-identity')>()), POSTING_IS_FREE: free }))
  return (await import('./route')).GET()
}

afterEach(() => { vi.unstubAllEnvs(); vi.doUnmock('@/lib/site-identity') })

describe('/pricing.md', () => {
  it('opens with its heading, as markdown: free for buyers and self-posters, 0 VND per row', async () => {
    const res = await load('marketplace')
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('text/markdown; charset=utf-8')
    expect(res.headers.get('cache-control')).toBe('public, max-age=0, s-maxage=3600')
    expect((await import('./route')).revalidate).toBe(3600)
    const body = await res.text()
    expect(body.startsWith('# eno.vn pricing\n')).toBe(true)
    for (const row of ['Browsing and searching listings', 'Creating an account', 'Posting your own listings', 'Contacting a seller']) {
      expect(body).toMatch(new RegExp(`\\| ${row} \\| 0 VND`))
    }
    // ⛔ never "every seller is in-app": a linked listing is answered on its source site (llms.txt says the same).
    expect(body).toContain('a linked listing is answered on its source site')
  })

  it('⛔ states the partner service fees and the commissions Art. 8 sets out — "free" is never the whole story', async () => {
    const body = await (await load('marketplace')).text()
    expect(body).toContain('## Partner service fees')
    expect(body).toContain('Buyers and tenants never pay these.')
    expect(body).toContain('The operator may earn a commission from some partners and linked shops')
    expect(body).toContain('at least 20 days before they apply')
  })

  it('⛔ every partner fee row is the Regulations\' own table, word for word (Art. 8, regulations/page.tsx)', async () => {
    const { PARTNER_FEES } = await import('@/lib/pricing-md')
    const regulations = readFileSync('src/app/[lang]/regulations/page.tsx', 'utf8')
    // Every rate cell of Art. 8's table, whatever its value (commit gate, opus): a new row there fails here.
    const fees = regulations.slice(regulations.indexOf("id: 'fees'"), regulations.indexOf("id: '", regulations.indexOf("id: 'fees'") + 10))
    expect(PARTNER_FEES).toHaveLength((fees.match(/en: '\d+(?:[.,]\d+)?%'/g) ?? []).length)
    for (const f of PARTNER_FEES) {
      const at = regulations.indexOf(`en: '${f.listing}'`)
      expect(at, f.listing).toBeGreaterThan(-1)
      const row = regulations.slice(at, regulations.indexOf('],', at))
      for (const cell of [f.rate, f.on, f.when]) expect(row, `${f.listing}: ${cell}`).toContain(`en: '${cell}'`)
    }
  })

  it('⛔ every sentence of substance is the Regulations\' or the Terms\' own words — present in BOTH the page and the legal text', async () => {
    const body = await (await load('marketplace')).text()
    const legal = readFileSync('src/app/[lang]/regulations/page.tsx', 'utf8') + readFileSync('src/app/[lang]/terms/page.tsx', 'utf8')
    for (const clause of [
      'Creating an account, browsing, posting and contacting sellers are currently free',
      'signed an agreement under Article 3', 'A deal that does not close incurs no fee',
      'pays none of these fees, including for apartments, houses and offices',
      'The operator collects no money from buyers for transactions on the platform, makes no payment on anyone’s behalf and holds no one’s money',
      'Where a service on the platform is provided by a licensed third party, what the operator receives is a commission under its contract with that provider',
      'The buyer pays the provider directly, by the method the provider publishes, not the platform',
      'The operator may earn a commission from some partners and linked shops when a buyer purchases through a link on the platform',
      'The buyer does not pay that commission, and it does not change the price the buyer pays',
      'labelled “Ad”', 'in Vietnamese dong at least 20 days before they apply',
    ]) {
      expect(legal, `legal text: ${clause}`).toContain(clause)
      expect(body, `pricing.md: ${clause}`).toContain(clause.replace('pays none of these fees, including', 'pays no partner service fee, including'))
    }
    expect(body).toContain('currently free') // never a permanent promise the legal text does not make
    expect(body).not.toMatch(/two ways|costs nothing/)
  })

  it('⛔ 404 on the services edition (it sells paid services) and the day posting stops being free', async () => {
    expect((await load('services')).status).toBe(404)
    expect((await load('marketplace', false)).status).toBe(404)
  })
})
