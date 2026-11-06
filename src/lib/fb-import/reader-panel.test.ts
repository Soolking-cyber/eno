// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { listSellerItems } from '../../../scripts/fb-import-worker/reader.mjs'

// The reader's own page.evaluate callbacks, run against a real DOM: which dialog is the seller's panel (measured 2026-11-06: not always the first).
const item = (id: string) => `<a href="https://www.facebook.com/marketplace/item/${id}/?ref=x">item</a>`
// `later` runs before the Nth evaluate: what Facebook adds while the reader waits and scrolls.
const page = (later: Record<number, () => void> = {}) => {
  let n = 0
  return { goto: async () => {}, url: () => 'https://www.facebook.com/marketplace/profile/100/', context: () => ({ cookies: async () => [{ name: 'c_user' }] }), evaluate: async (fn: (a?: unknown) => unknown, arg?: unknown) => { later[++n]?.(); return fn(arg) } }
}

beforeEach(() => { vi.spyOn(globalThis, 'setTimeout').mockImplementation(((fn: () => void) => { fn(); return 0 }) as never) })
afterEach(() => { vi.restoreAllMocks(); document.body.innerHTML = '' })

describe('listSellerItems: the seller\'s panel', () => {
  it('⛔ a notice dialog before the panel: the panel\'s listing is read, the feed behind never', async () => {
    document.body.innerHTML = `<main>${item('900001')}${item('900002')}</main><div role="dialog">A Marketplace notice about your listings</div><div role="dialog">Shanazar's listings ${item('1418437580372624')}</div>`
    expect(await listSellerItems(page(), '100', { patience: 1 })).toEqual({ ids: ['1418437580372624'], panel: true })
  })
  it('one dialog, the usual page: as before', async () => {
    document.body.innerHTML = `<main>${item('900001')}</main><div role="dialog">${item('1')}${item('2')}${item('1')}</div>`
    expect(await listSellerItems(page(), '100', { patience: 1 })).toEqual({ ids: ['1', '2'], panel: true })
  })
  it('a panel with nothing for sale is still a panel (no soft block), and no dialog at all is none', async () => {
    document.body.innerHTML = `<main>${item('900001')}</main><div role="dialog">No listings</div>`
    expect(await listSellerItems(page(), '100', { patience: 1 })).toEqual({ ids: [], panel: true })
    document.body.innerHTML = `<main>${item('900001')}</main>`
    expect(await listSellerItems(page(), '100', { patience: 1 })).toEqual({ ids: [], panel: false })
  })
  it('a panel still loading when first read: what loads later is read from it, with a notice after it', async () => {
    document.body.innerHTML = `<main>${item('900001')}</main><div role="dialog" id="panel">Loading</div><div role="dialog">A notice</div>`
    const p = page({ 3: () => { document.getElementById('panel')!.innerHTML += item('7') }, 6: () => { document.getElementById('panel')!.innerHTML += item('8') } })
    expect(await listSellerItems(p, '100', { patience: 2 })).toEqual({ ids: ['7', '8'], panel: true })
  })
  it('a stranger\'s links in the feed never join, however long it scrolls', async () => {
    document.body.innerHTML = `<div role="dialog" id="panel">${item('1')}</div>`
    const p = page({ 3: () => { document.body.insertAdjacentHTML('afterbegin', `<main>${item('900001')}${item('900002')}</main>`) } })
    expect(await listSellerItems(p, '100', { patience: 2 })).toEqual({ ids: ['1'], panel: true })
  })
  it('a notice linking one of the listings, before or after the panel: every listing once', async () => {
    document.body.innerHTML = `<div role="dialog">${item('1')}${item('2')}${item('3')}</div><div role="dialog">Your listing needs attention ${item('2')}</div>`
    expect(await listSellerItems(page(), '100', { patience: 1 })).toEqual({ ids: ['1', '2', '3'], panel: true })
    document.body.innerHTML = `<div role="dialog">Your listing needs attention ${item('2')}</div><div role="dialog">${item('1')}${item('2')}</div>`
    expect((await listSellerItems(page(), '100', { patience: 1 })).ids.sort()).toEqual(['1', '2'])
  })
  it('⛔ a notice with a link that loads before the panel: the panel\'s listings still arrive', async () => {
    document.body.innerHTML = `<div role="dialog" id="panel">Loading</div><div role="dialog">Your listing needs attention ${item('2')}</div>`
    const p = page({ 3: () => { document.getElementById('panel')!.innerHTML = `${item('1')}${item('2')}${item('3')}` } })
    expect((await listSellerItems(p, '100', { patience: 2 })).ids.sort()).toEqual(['1', '2', '3'])
  })
  it('another dialog\'s items are candidates only: each item page must name this seller (worker.mjs, THE SECOND LINE)', async () => {
    document.body.innerHTML = `<div role="dialog">${item('1')}</div><div role="dialog">Suggested ${item('900001')}</div>`
    expect((await listSellerItems(page(), '100', { patience: 1 })).ids.sort()).toEqual(['1', '900001'])
  })
  it('nested dialogs: every listing once', async () => {
    document.body.innerHTML = `<div role="dialog">${item('1')}<div role="dialog">${item('2')}</div>${item('3')}</div>`
    expect((await listSellerItems(page(), '100', { patience: 1 })).ids.sort()).toEqual(['1', '2', '3'])
  })

})
