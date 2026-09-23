// @vitest-environment jsdom
import * as React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import { TrackView, markViewedOnce, VIEW_DEDUP_KEY } from './track-view'
import { setConsent } from '@/lib/consent'

/**
 * ⛔ THE VIEW-COUNT DEDUP USED TO SHARE localStorage `eno:viewed` WITH THE RECO HISTORY — an object
 * map and an array under one key. `map[id] = now` on a parsed array is dropped by JSON.stringify, so
 * the dedup never held an id and every view POSTed (measured: true on every call). It now has its own
 * key, in sessionStorage, and the history writer is untouched by it.
 */

function memoryStorage() {
  const m = new Map<string, string>()
  return {
    getItem: (k: string) => (m.has(k) ? m.get(k)! : null),
    setItem: (k: string, v: string) => { m.set(k, String(v)) },
    removeItem: (k: string) => { m.delete(k) },
    clear: () => m.clear(),
    key: (i: number) => [...m.keys()][i] ?? null,
    get length() { return m.size },
  }
}

let posts: string[] = []

beforeEach(() => {
  vi.stubGlobal('localStorage', memoryStorage())
  vi.stubGlobal('sessionStorage', memoryStorage())
  posts = []
  vi.stubGlobal('fetch', vi.fn(async (url: string) => { posts.push(String(url)); return new Response(null, { status: 204 }) }))
  Object.defineProperty(navigator, 'sendBeacon', { configurable: true, value: () => true })
  document.cookie.split(';').forEach((c) => { document.cookie = `${c.split('=')[0].trim()}=; max-age=0; path=/` })
})
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

const view = (id = 'l1') => render(
  <TrackView id={id} title="Phone" price={100} currency="VND" category="Phones" categorySlug="phones" brandSlug="apple" />,
)

describe('TrackView dedup', () => {
  it('the first view in the window counts; a re-open does not', () => {
    expect(markViewedOnce('l1')).toBe(true)
    expect(markViewedOnce('l1')).toBe(false)
    expect(markViewedOnce('l2')).toBe(true)
    expect(Object.keys(JSON.parse(sessionStorage.getItem(VIEW_DEDUP_KEY)!))).toEqual(['l1', 'l2'])
  })

  it('⛔ with Personalization ON (history written to eno:viewed) the second open is STILL deduped', () => {
    setConsent({ p: true, a: false, d: false }, { surface: 'banner', action: 'save', locale: 'en' })
    view('l1')
    cleanup()
    view('l1')
    expect(posts.filter((u) => u === '/api/listings/l1/view')).toHaveLength(1)
    // …and the history is an intact array, not clobbered by a dedup map.
    expect(JSON.parse(localStorage.getItem('eno:viewed')!)).toEqual([{ c: 'phones', b: 'apple' }])
  })

  it('writes NO lasting on-device record of the view without Personalization', () => {
    view('l1')
    expect(localStorage.getItem('eno:viewed')).toBeNull()
    expect(localStorage.getItem('eno:viewed_ids')).toBeNull()
    expect(posts).toContain('/api/listings/l1/view') // the counter itself still counts
  })

  it('a corrupt dedup entry is replaced, not trusted', () => {
    sessionStorage.setItem(VIEW_DEDUP_KEY, '[1,2,3]')
    expect(markViewedOnce('l1')).toBe(true)
    expect(markViewedOnce('l1')).toBe(false)
  })
})
