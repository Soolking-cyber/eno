import { afterEach, describe, expect, it, vi } from 'vitest'

/**
 * ⛔ THE FINISHED-VISA EMAIL MAY NOT BE SIGNED BY eno.vn.
 *
 * eno.vn is built with MARKETPLACE_HOSTS_SERVICES=true (infra/vn-node/eno-build.sh), so the desk's
 * result-upload route (`api/visa/admin/applications/[id]/result/route.svc.ts`) compiles there and the
 * partner desk uses it from /admin/visas/[id]. Until 2026-10-01 that build mailed the applicant "Thank
 * you for trusting eno.vn with your Vietnam e-Visa … write to support@eno.vn", under the eno.vn
 * wordmark and the Công ty TNHH ENO legal footer — the licensed sàn TMĐT named as the visa provider.
 *
 * The edition is switched for real (vi.stubEnv + vi.resetModules re-evaluate src/lib/edition.ts and
 * src/lib/site-legal.ts); only the storefront lookup is mocked, because it is a database read.
 */
const shop = vi.hoisted(() => ({
  seller: null as null | { id: string; name: string; ownerId: string; avatarUrl: string | null; avatarColor: string | null },
  // Mutated IN PLACE (never reassigned) so the mocked module's export stays the same array.
  owners: ['info@vietkite.com.vn'] as string[],
}))
vi.mock('@/lib/visa-shop', () => ({
  getVisaShopSeller: async () => shop.seller,
  VISA_SHOP_OWNER_EMAILS: shop.owners,
}))
const setOwners = (...emails: string[]) => { shop.owners.splice(0, shop.owners.length, ...emails) }

afterEach(() => {
  vi.unstubAllEnvs()
  shop.seller = null
  setOwners('info@vietkite.com.vn')
})

async function load(edition: 'marketplace' | 'services') {
  vi.resetModules()
  vi.stubEnv('NEXT_PUBLIC_ENO_EDITION', edition)
  const [brand, email, mail] = await Promise.all([
    import('./result-brand'),
    import('@/lib/emails/visa-result'),
    import('@/lib/mail'),
  ])
  return { brand, email, mail }
}
const seller = (name: string) => ({ id: 's1', name, ownerId: 'o1', avatarUrl: null, avatarColor: null })
const ORIGIN_VN = 'https://eno.vn'

describe('visa result email · who it speaks as', () => {
  it('services edition: unchanged — eno.forum and its own inbox', async () => {
    const { brand } = await load('services')
    expect(await brand.visaResultBrand()).toEqual({ siteName: 'eno.forum', supportEmail: 'support@eno.forum', providedVia: null, fromName: null })
  })

  it('marketplace edition: the visa storefront, carried "via eno.vn", with no inbox', async () => {
    shop.seller = seller('VietKite')
    const { brand } = await load('marketplace')
    expect(await brand.visaResultBrand()).toEqual({ siteName: 'VietKite', supportEmail: null, providedVia: 'eno.vn', fromName: 'VietKite via eno.vn' })
  })

  it('marketplace edition: FAILS CLOSED when the storefront is missing or is eno.vn itself', async () => {
    const { brand } = await load('marketplace')
    expect(await brand.visaResultBrand()).toBeNull()
    // The repo's own eno-run storefront names (e2e/guest/visa.spec.ts, scripts/seed-visa-shop.mjs)
    // carry the eno brand without "eno.vn" or the company name — refused all the same.
    for (const name of ['  ', 'eno.vn Visa Desk', 'Công ty TNHH ENO', 'ENO Company Limited', 'Eno Visa', 'eno Visa Services', 'eno.forum', 'ENO']) {
      shop.seller = seller(name)
      expect(await brand.visaResultBrand(), name).toBeNull()
    }
  })

  it('marketplace edition: a word that merely contains "eno" is not the eno brand', async () => {
    const { brand } = await load('marketplace')
    for (const name of ['VietKite', 'Xeno Travel', 'Enopa Visa']) {
      shop.seller = seller(name)
      expect(await brand.visaResultBrand(), name).toEqual({ siteName: name, supportEmail: null, providedVia: 'eno.vn', fromName: `${name} via eno.vn` })
    }
  })

  it('marketplace edition: FAILS CLOSED when the storefront owner list names an eno inbox, whatever the shop is called', async () => {
    shop.seller = seller('VietKite')
    const { brand } = await load('marketplace')
    // visa-shop.ts falls back to support@eno.forum when VISA_SHOP_OWNER_EMAIL is unset.
    for (const owners of [['support@eno.forum'], ['info@vietkite.com.vn', 'support@eno.vn'], ['Desk@Mail.ENO.vn']]) {
      setOwners(...owners)
      expect(await brand.visaResultBrand(), owners.join(',')).toBeNull()
    }
    setOwners('info@vietkite.com.vn', 'ops@xeno.vn')
    expect(await brand.visaResultBrand()).not.toBeNull()
  })
})

describe('visa result email · rendered as eno.vn now sends it', () => {
  it('names the partner, never eno.vn as provider or contact — both languages', async () => {
    shop.seller = seller('VietKite')
    const { brand, email } = await load('marketplace')
    const b = await brand.visaResultBrand()
    expect(b).not.toBeNull()
    for (const locale of ['en', 'vi'] as const) {
      const m = email.renderVisaResultEmail({
        givenName: 'Minh', reference: 'EV-1042', origin: ORIGIN_VN, locale,
        siteName: b!.siteName, supportEmail: b!.supportEmail, providedVia: b!.providedVia,
      })
      const all = `${m.subject}\n${m.html}\n${m.text}`
      // The licensed company and its inbox are gone entirely…
      for (const word of ['Công ty TNHH ENO', 'ENO Company Limited', 'support@eno.vn', 'alt="eno.vn"', 'wordmark-eno-vn']) {
        expect(all, `${locale}: ${word}`).not.toContain(word)
      }
      // …eno.vn is never the one being trusted, used or written to…
      expect(all).not.toMatch(/trusting eno\.vn|using eno\.vn|tin tưởng eno\.vn|dịch vụ của eno\.vn|your eno\.vn chat|trò chuyện eno\.vn/)
      // …no inbox is named at all…
      expect(all.match(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/gi) ?? []).toEqual([])
      // …and eno.vn appears only as the channel, in the footer.
      const footer = locale === 'en' ? 'Provided by VietKite via eno.vn.' : 'Dịch vụ do VietKite cung cấp qua eno.vn.'
      expect(m.html).toContain(footer)
      expect(m.text.trim().endsWith(footer)).toBe(true)
      expect(m.html).toContain('>VietKite</div>')
      // The chat-only line names the partner as the one to message, inside the customer's own chat.
      const chatLine = locale === 'en'
        ? 'reply in your VietKite chat with your case reference and VietKite will pick it up.'
        : 'vui lòng nhắn tin cho VietKite trong cuộc trò chuyện của bạn và ghi kèm mã hồ sơ, VietKite sẽ tiếp nhận và xử lý.'
      expect(m.text).toContain(chatLine)
      expect(m.text).not.toMatch(/nhắn trong cuộc trò chuyện VietKite/)
    }
  })

  it('the services rendering keeps its wordmark, legal footer and inbox (no providedVia)', async () => {
    const { email } = await load('services')
    const m = email.renderVisaResultEmail({ givenName: 'Minh', reference: 'EV-1042', origin: 'https://www.eno.forum', locale: 'en', siteName: 'eno.forum', supportEmail: 'support@eno.forum' })
    expect(m.html).toContain('alt="eno.forum"')
    expect(m.html).toContain('eno.forum · support@eno.forum')
    expect(m.html).not.toContain('Provided by')
    expect(m.text).toContain('write to support@eno.forum')
  })
})

describe('visa result email · From display name', () => {
  it('replaces only the display name, keeps the verified address, and strips header metacharacters', async () => {
    const { mail } = await load('marketplace')
    expect(mail.fromHeader('VietKite via eno.vn')).toBe('"VietKite via eno.vn" <no-reply@eno.vn>')
    expect(mail.fromHeader('Evil"\r\nBcc: x@y.z <a>')).toBe('"EvilBcc: x@y.z a" <no-reply@eno.vn>')
    expect(mail.fromHeader(undefined)).toBe('eno.vn <no-reply@eno.vn>')
    expect(mail.fromHeader('  ')).toBe('eno.vn <no-reply@eno.vn>')
  })
})
