import { afterEach, describe, expect, it, vi } from 'vitest'

// The suite runs as the services edition (vitest.config.ts); these strings are the marketplace's.
const edition = vi.hoisted(() => ({ services: false }))
vi.mock('@/lib/edition', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/lib/edition')>()
  return {
    ...real,
    get IS_SERVICES() { return edition.services },
    get IS_MARKETPLACE() { return !edition.services },
    get SITE_NAME() { return edition.services ? 'eno.forum' : 'eno.vn' },
  }
})
const { HOME_DESCRIPTION_VI, HOME_TITLE_VI, homeMetadata } = await import('./home-metadata')
afterEach(() => { edition.services = false })

/** SEO wave B, V2 — copy sheet CS-3 V2-1 / V2-2 (approved by the owner 2026-10-01), verbatim. */
describe('homeMetadata (marketplace)', () => {
  it('the vi variant gets the Vietnamese title and description, the canonical kept', () => {
    expect(homeMetadata('vi')).toEqual({
      alternates: { canonical: '/' },
      title: 'eno.vn — rao vặt miễn phí cho người nước ngoài và người Việt',
      description: 'eno.vn là chợ rao vặt miễn phí cho người nước ngoài và người Việt tại Việt Nam: nhà cho thuê, việc làm, nội thất, đồ điện tử và nhiều hơn nữa.',
    })
  })

  it('the en variant sets only the canonical — the layout keeps the English title and description', () => {
    expect(homeMetadata('en')).toEqual({ alternates: { canonical: '/' } })
  })

  it('stays within the lengths CS-3 measured (title 60, description 142) and claims no trust', () => {
    expect([...HOME_TITLE_VI.normalize('NFC')].length).toBeLessThanOrEqual(60)
    expect([...HOME_DESCRIPTION_VI.normalize('NFC')].length).toBeLessThanOrEqual(160)
    expect(`${HOME_TITLE_VI} ${HOME_DESCRIPTION_VI}`).not.toMatch(/uy tín|tin cậy|trusted/i)
  })

  it('eno.forum keeps the layout title and description on both variants', () => {
    edition.services = true
    for (const lang of ['en', 'vi']) expect(homeMetadata(lang)).toEqual({ alternates: { canonical: '/' } })
  })
})
