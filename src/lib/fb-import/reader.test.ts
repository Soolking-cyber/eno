import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { findSeller, open, parseItem, sha, Walled } from '../../../scripts/fb-import-worker/reader.mjs'

const page = (o: unknown) => `<html><script type="application/json" data-sjs>${JSON.stringify(o)}</script></html>`
const me = {
  id: '111111', marketplace_listing_title: 'My chair', is_sold: false, is_live: true, is_hidden: false, is_pending: false,
  listing_price: { amount: '500000.00', currency: 'VND' }, marketplace_listing_seller: { id: '999' },
  redacted_description: { text: 'Solid wood' }, location_text: { text: 'Thu Duc' }, attribute_data: [{ attribute_name: 'Condition', value: 'used', label: 'Used' }],
  listing_photos: [{ image: { uri: 'https://scontent.fbcdn.net/1.jpg' } }, { image: { uri: 'https://scontent.fbcdn.net/2.jpg' } }],
}
const stranger = { id: '222222', marketplace_listing_title: 'Their sofa', listing_price: { amount: '1.00', currency: 'VND' }, marketplace_listing_seller: { id: '777' }, redacted_description: { text: 'Not mine' }, listing_photos: [{ image: { uri: 'https://scontent.fbcdn.net/9.jpg' } }] }

describe('parseItem', () => {
  it('reads every field of THIS item', () => {
    expect(parseItem(page({ a: { b: [me] } }), '111111')).toEqual({ title: 'My chair', price: { amount: '500000.00', currency: 'VND', formatted: null }, isSold: false, isLive: true, isHidden: false, isPending: false, sellerId: '999', description: 'Solid wood', location: 'Thu Duc', photos: ['https://scontent.fbcdn.net/1.jpg', 'https://scontent.fbcdn.net/2.jpg'], attributes: [{ name: 'Condition', value: 'used', label: 'Used' }] })
  })
  // ⛔ An item page carries similar items beside it.
  it('never takes a field from a similar item on the same page', () => {
    const r = parseItem(page({ similar: [stranger], main: me, more: [stranger] }), '111111')
    expect(r.title).toBe('My chair')
    expect(r.sellerId).toBe('999')
    expect(r.photos).not.toContain('https://scontent.fbcdn.net/9.jpg')
  })
  it('a page without the item answers nothing', () => {
    expect(parseItem(page({ similar: [stranger] }), '111111')).toEqual({})
    expect(parseItem('<html>login</html>', '111111')).toEqual({})
  })
  it('survives broken JSON', () => {
    expect(parseItem('<script type="application/json">{"marketplace_listing_title":111111,,}</script>', '111111')).toEqual({})
  })
})

describe('open: a wall stops the run', () => {
  const at = (url: string, cookies: { name: string }[] | null = [{ name: 'c_user' }]) => ({ goto: async () => {}, url: () => url, ...(cookies ? { context: () => ({ cookies: async () => cookies }) } : {}) })
  beforeEach(() => { vi.spyOn(globalThis, 'setTimeout').mockImplementation(((fn: () => void) => { fn(); return 0 }) as never) })
  afterEach(() => { vi.restoreAllMocks() })
  it.each(['login', 'checkpoint/123', 'two_step_verification/two_factor', 'two_factor/x', 'recover/initiate'])('/%s', async (path) => {
    await expect(open(at(`https://www.facebook.com/${path}`), 'https://www.facebook.com/x')).rejects.toBeInstanceOf(Walled)
  })
  it('logged out on an ordinary address', async () => {
    await expect(open(at('https://www.facebook.com/search/people/', []), 'https://www.facebook.com/x')).rejects.toBeInstanceOf(Walled)
  })
  it('a logged-in page is no wall', async () => {
    await expect(open(at('https://www.facebook.com/search/people/'), 'https://www.facebook.com/x')).resolves.toBeUndefined()
  })
})

describe('findSeller', () => {
  const PICTURE = Buffer.from('their picture')
  const OTHER = Buffer.from('someone else')
  /** Search results, then each profile's id and avatars. */
  const fakePage = (people: Record<string, { id: string; avatars: string[] }>) => {
    let at = ''
    return {
      goto: async (u: string) => { at = u },
      url: () => at,
      content: async () => `"userID":"${Object.entries(people).find(([path]) => at.endsWith(`/${path}`))?.[1].id ?? ''}"`,
      evaluate: async () => (at.includes('/search/') ? Object.keys(people).map((path) => ({ path, thumb: null })) : Object.entries(people).find(([path]) => at.endsWith(`/${path}`))?.[1].avatars ?? []),
    }
  }
  const bytes = async (u: string) => (u === 'mine' ? PICTURE : OTHER)
  const wanted = { name: 'An', pictureShas: [sha(PICTURE)] }
  beforeEach(() => { vi.spyOn(globalThis, 'setTimeout').mockImplementation(((fn: () => void) => { fn(); return 0 }) as never) })
  afterEach(() => { vi.restoreAllMocks() })

  it('one profile with those bytes: that is the seller', async () => {
    const r = await findSeller(fakePage({ stranger: { id: '11111', avatars: ['theirs'] }, seller: { id: '22222', avatars: ['theirs', 'mine'] } }), wanted, bytes)
    expect(r).toMatchObject({ sellerId: '22222', opened: 2, matches: 1 })
  })
  it('⛔ a same-named account with a copied photo: nothing is imported, whichever came first', async () => {
    const r = await findSeller(fakePage({ copycat: { id: '33333', avatars: ['mine'] }, seller: { id: '22222', avatars: ['mine'] } }), wanted, bytes)
    expect(r).toMatchObject({ sellerId: null, opened: 2, matches: 2 })
  })
  it('the same profile found twice is one seller', async () => {
    const r = await findSeller(fakePage({ 'an.tran': { id: '22222', avatars: ['mine'] }, 'profile.php?id=22222': { id: '22222', avatars: ['mine'] } }), wanted, bytes)
    expect(r).toMatchObject({ sellerId: '22222', matches: 1 })
  })
  it('⛔ a match whose id could not be read still counts as a second profile', async () => {
    const r = await findSeller(fakePage({ seller: { id: '22222', avatars: ['mine'] }, copycat: { id: '', avatars: ['mine'] } }), wanted, bytes)
    expect(r).toMatchObject({ sellerId: null, matches: 2 })
  })
  it('the only match has no readable id: nobody, because there is nothing safe to read', async () => {
    expect((await findSeller(fakePage({ seller: { id: '', avatars: ['mine'] } }), wanted, bytes)).sellerId).toBeNull()
  })
  it('no bytes in common: nobody', async () => {
    expect((await findSeller(fakePage({ stranger: { id: '11111', avatars: ['theirs'] } }), wanted, bytes)).sellerId).toBeNull()
  })
})
