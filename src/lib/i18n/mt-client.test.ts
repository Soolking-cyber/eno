import { afterEach, describe, expect, it, vi } from 'vitest'

import { looksVietnamese } from '@/lib/detect-lang'
import { __resetMtMissesForTests, subscribeTr, trCache, translateText } from './mt-client'

/**
 * THE CLIENT MACHINE-TRANSLATION BATCHER — what reaches POST /api/translate.
 *
 * Measured on a Vietnamese home view (2026-09-29): category names, districts and "Hồ Chí Minh" were
 * posted with target 'vi' to be handed back unchanged, and one request carried the same location
 * dozens of times. These pin the two fixes: Vietnamese is never sent for Vietnamese, and a text is
 * sent once per request however many cards ask for it.
 */
const ok = (translations: string[]) =>
  vi.fn(async (_url: string, _init?: RequestInit) => new Response(JSON.stringify({ translations }), { status: 200 }))
const bodyOf = (call: unknown[]) => JSON.parse(String((call[1] as RequestInit).body)) as { texts: string[]; target: string }

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
  __resetMtMissesForTests()
})

describe('translateText', () => {
  it('⛔ answers Vietnamese asked for in Vietnamese at once, with no request, and caches the identity', async () => {
    const fetchMock = ok([])
    vi.stubGlobal('fetch', fetchMock)
    vi.useFakeTimers()
    for (const text of ['Hồ Chí Minh', 'Hà Nội', 'Việc làm', 'Quận Tân Bình (P. Tân Hòa mới)', 'Mẹ & Bé']) {
      await expect(translateText(text, 'vi')).resolves.toBe(text)
      expect(trCache.get(`vi ${text}`)).toBe(text)
    }
    await vi.advanceTimersByTimeAsync(200)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('still sends English, and an English title that only NAMES a Vietnamese place', async () => {
    const title = 'Office / shopfront · 65 m² for rent — Tây Thạnh Ward, Tân Phú District'
    expect(looksVietnamese(title)).toBe(false)
    const fetchMock = ok(['Văn phòng', 'Cho thuê mặt bằng'])
    vi.stubGlobal('fetch', fetchMock)
    const out = Promise.all([translateText('Online — nationwide', 'vi'), translateText(title, 'vi')])
    await expect(out).resolves.toEqual(['Văn phòng', 'Cho thuê mặt bằng'])
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(bodyOf(fetchMock.mock.calls[0])).toEqual({ texts: ['Online — nationwide', title], target: 'vi' })
  })

  it('⚠️ still sends a short string whose only accent is a French/Spanish one — that is not Vietnamese', async () => {
    // Any diacritic used to be enough to skip the request, so a Vietnamese reader got these in English.
    const texts = ['Pokémon cards', 'Café for rent', 'Crème brûlée']
    const fetchMock = ok(['Thẻ Pokémon', 'Cho thuê quán cà phê', 'Bánh crème brûlée'])
    vi.stubGlobal('fetch', fetchMock)
    await expect(Promise.all(texts.map((t) => translateText(t, 'vi')))).resolves.toEqual(['Thẻ Pokémon', 'Cho thuê quán cà phê', 'Bánh crème brûlée'])
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(bodyOf(fetchMock.mock.calls[0])).toEqual({ texts, target: 'vi' })
  })

  it('⛔ posts each text ONCE per request, and answers every caller that asked for it', async () => {
    const fetchMock = ok(['Mũi Né', 'Đà Lạt'])
    vi.stubGlobal('fetch', fetchMock)
    const asks = ['Mui Ne beach', 'Da Lat hills', 'Mui Ne beach', 'Mui Ne beach', 'Da Lat hills'].map((t) => translateText(t, 'vi'))
    await expect(Promise.all(asks)).resolves.toEqual(['Mũi Né', 'Đà Lạt', 'Mũi Né', 'Mũi Né', 'Đà Lạt'])
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(bodyOf(fetchMock.mock.calls[0])).toEqual({ texts: ['Mui Ne beach', 'Da Lat hills'], target: 'vi' })
    expect(trCache.get('vi Mui Ne beach')).toBe('Mũi Né')
  })

  it('batches English targets the same way (the EN fallback for Vietnamese-script titles)', async () => {
    const fetchMock = ok(['Business Lecturer — Swinburne Vietnam'])
    vi.stubGlobal('fetch', fetchMock)
    const t = 'Giảng viên kinh doanh — Swinburne Việt Nam'
    await expect(Promise.all([translateText(t, 'en'), translateText(t, 'en')])).resolves.toEqual([
      'Business Lecturer — Swinburne Vietnam',
      'Business Lecturer — Swinburne Vietnam',
    ])
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(bodyOf(fetchMock.mock.calls[0])).toEqual({ texts: [t], target: 'en' })
  })

  it('never pins a provider-down passthrough, for any of the duplicate callers', async () => {
    const t = 'Fresh durian, delivered today'
    vi.stubGlobal('fetch', ok([t]))
    await expect(Promise.all([translateText(t, 'ko'), translateText(t, 'ko')])).resolves.toEqual([t, t])
    expect(trCache.has(`ko ${t}`)).toBe(false)
  })
})

describe('a passthrough is not re-asked on every repaint (the 15-requests-a-second loop, 2026-10-07)', () => {
  it('does not repaint for an English passthrough, and waits before asking for it again', async () => {
    vi.useFakeTimers()
    const t = 'Saturday morning, in a loop'
    const fetchMock = ok([t])
    vi.stubGlobal('fetch', fetchMock)
    const repaints = vi.fn()
    const off = subscribeTr(repaints)
    const first = translateText(t, 'ko')
    await vi.advanceTimersByTimeAsync(60)
    await expect(first).resolves.toBe(t)
    expect(repaints).not.toHaveBeenCalled()
    // Asked again at once (what a repaint used to do): answered with no request.
    await expect(translateText(t, 'ko')).resolves.toBe(t)
    await vi.advanceTimersByTimeAsync(60)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    // After the wait it is asked again.
    await vi.advanceTimersByTimeAsync(15_000)
    const again = translateText(t, 'ko')
    await vi.advanceTimersByTimeAsync(60)
    await again
    expect(fetchMock).toHaveBeenCalledTimes(2)
    off()
  })

  it('repaints when a translation lands, and a success clears the wait', async () => {
    vi.useFakeTimers()
    const t = 'Sunday afternoon, translated'
    vi.stubGlobal('fetch', ok([t]))
    const miss = translateText(t, 'ja')
    await vi.advanceTimersByTimeAsync(60)
    await miss
    await vi.advanceTimersByTimeAsync(15_000)
    vi.stubGlobal('fetch', ok(['日曜日の午後']))
    const repaints = vi.fn()
    const off = subscribeTr(repaints)
    const hit = translateText(t, 'ja')
    await vi.advanceTimersByTimeAsync(60)
    await expect(hit).resolves.toBe('日曜日の午後')
    expect(repaints).toHaveBeenCalledTimes(1)
    expect(trCache.get(`ja ${t}`)).toBe('日曜日の午後')
    off()
  })
})

describe('the wait ends on its own (gate review, 2026-10-07)', () => {
  it('repaints once when the earliest wait runs out, so a page that never re-renders still asks again', async () => {
    vi.useFakeTimers()
    const t = 'Weekday evenings, still English'
    vi.stubGlobal('fetch', ok([t]))
    const repaints = vi.fn()
    const off = subscribeTr(repaints)
    const miss = translateText(t, 'th')
    await vi.advanceTimersByTimeAsync(60)
    await miss
    expect(repaints).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(15_000)
    expect(repaints).toHaveBeenCalledTimes(1)
    off()
  })
})

describe('every waiting string gets its retry (gate review, 2026-10-07)', () => {
  it('re-arms for the next pending miss after the first timer fires', async () => {
    vi.useFakeTimers()
    const a = 'Monday evening, first miss'
    vi.stubGlobal('fetch', ok([a]))
    const first = translateText(a, 'fr')
    await vi.advanceTimersByTimeAsync(60)
    await first
    await vi.advanceTimersByTimeAsync(5_000)
    const b = 'Tuesday evening, a later miss'
    vi.stubGlobal('fetch', ok([b]))
    const second = translateText(b, 'fr')
    await vi.advanceTimersByTimeAsync(60)
    await second
    const repaints = vi.fn()
    const off = subscribeTr(repaints)
    await vi.advanceTimersByTimeAsync(10_000) // a's wait ends
    expect(repaints).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(5_100) // b's wait ends — still re-armed
    expect(repaints).toHaveBeenCalledTimes(2)
    off()
  })
})

describe('a string that lands before its timer (gate review, 2026-10-07)', () => {
  it('is not repainted again when the timer fires', async () => {
    vi.useFakeTimers()
    const t = 'Thursday morning, lands early'
    vi.stubGlobal('fetch', ok([t]))
    const first = translateText(t, 'fr')
    await vi.advanceTimersByTimeAsync(60)
    await first // a miss: its retry is due in 15 s
    await vi.advanceTimersByTimeAsync(13_500) // inside the 2 s slack: a render may ask again
    vi.stubGlobal('fetch', ok(['Jeudi matin']))
    const repaints = vi.fn()
    const off = subscribeTr(repaints)
    const again = translateText(t, 'fr')
    await vi.advanceTimersByTimeAsync(60)
    expect(await again).toBe('Jeudi matin')
    expect(repaints).toHaveBeenCalledTimes(1) // the landing
    await vi.advanceTimersByTimeAsync(2_000) // the old timer fires: nothing is waiting any more
    expect(repaints).toHaveBeenCalledTimes(1)
    off()
  })
})

describe('a string the provider never translates is left alone (gate review, 2026-10-07)', () => {
  it('stops asking — and stops repainting — after five misses', async () => {
    vi.useFakeTimers()
    const t = 'Zalo'
    const fetchMock = ok([t])
    vi.stubGlobal('fetch', fetchMock)
    for (let i = 0; i < 5; i++) {
      const p = translateText(t, 'hi')
      await vi.advanceTimersByTimeAsync(60)
      await p
      await vi.advanceTimersByTimeAsync(600_000)
    }
    expect(fetchMock).toHaveBeenCalledTimes(5)
    const repaints = vi.fn()
    const off = subscribeTr(repaints)
    await expect(translateText(t, 'hi')).resolves.toBe(t)
    await vi.advanceTimersByTimeAsync(3_600_000)
    expect(fetchMock).toHaveBeenCalledTimes(5)
    expect(repaints).not.toHaveBeenCalled()
    off()
  })
})

describe('only a definite passthrough counts toward giving up (gate review, 2026-10-07)', () => {
  it('keeps retrying through failures and `partial` (rate-limited) replies', async () => {
    vi.useFakeTimers()
    const t = 'Weekend mornings, behind a busy carrier'
    const partialFetch = vi.fn(async () => new Response(JSON.stringify({ translations: [t], partial: true }), { status: 200 }))
    vi.stubGlobal('fetch', partialFetch)
    for (let i = 0; i < 6; i++) {
      const p = translateText(t, 'ko')
      await vi.advanceTimersByTimeAsync(60)
      await p
      await vi.advanceTimersByTimeAsync(600_000)
    }
    expect(partialFetch).toHaveBeenCalledTimes(6)
    vi.stubGlobal('fetch', ok(['주말 아침']))
    const after = translateText(t, 'ko')
    await vi.advanceTimersByTimeAsync(60)
    await expect(after).resolves.toBe('주말 아침')
  })
})
