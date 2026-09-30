import { afterEach, describe, expect, it, vi } from 'vitest'

import { looksVietnamese } from '@/lib/detect-lang'
import { trCache, translateText } from './mt-client'

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
