import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { looksVietnamese } from '@/lib/detect-lang'
import { __resetMtMissesForTests, subscribeTr, trCache, translateText, waitForTranslation, wakeTranslationWaiters } from './mt-client'

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
    const hit = translateText(t, 'ja', true) // as tr() asks
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
    const miss = translateText(t, 'th', true) // as tr() asks: the repaint is for tr(), which asks again while it renders
    await vi.advanceTimersByTimeAsync(60)
    await miss
    expect(repaints).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(15_000)
    expect(repaints).toHaveBeenCalledTimes(1)
    off()
  })

  it('does not repaint the app for a text only promise readers asked (useTr, useMachineEn): a repaint never asks for it', async () => {
    // Wave-1 build, Vietnamese /c/rentals and /vi after one failed request: this repaint rendered 314 and 668 components.
    vi.useFakeTimers()
    const t = 'Weekday evenings, a card title'
    vi.stubGlobal('fetch', ok([t]))
    const repaints = vi.fn()
    const off = subscribeTr(repaints)
    const miss = translateText(t, 'th')
    await vi.advanceTimersByTimeAsync(60)
    await miss
    await vi.advanceTimersByTimeAsync(15_000)
    expect(repaints).not.toHaveBeenCalled()
    off()
  })

  it('does not repaint for a tr() text the UI dictionary has seeded since: tr() already shows it', async () => {
    vi.useFakeTimers()
    const t = 'Weekday evenings, a seeded label'
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 500 })))
    const repaints = vi.fn()
    const off = subscribeTr(repaints)
    const miss = translateText(t, 'th', true)
    await vi.advanceTimersByTimeAsync(60)
    await miss
    trCache.set(`th ${t}`, 'ตอนเย็นวันธรรมดา') // what language-context's seedFromMap does (and it repaints then)
    await vi.advanceTimersByTimeAsync(15_000)
    expect(repaints).not.toHaveBeenCalled()
    off()
  })
})

describe('every waiting string gets its retry (gate review, 2026-10-07)', () => {
  it('re-arms for the next pending miss after the first timer fires', async () => {
    vi.useFakeTimers()
    const a = 'Monday evening, first miss'
    vi.stubGlobal('fetch', ok([a]))
    const first = translateText(a, 'fr', true) // as tr() asks
    await vi.advanceTimersByTimeAsync(60)
    await first
    await vi.advanceTimersByTimeAsync(5_000)
    const b = 'Tuesday evening, a later miss'
    vi.stubGlobal('fetch', ok([b]))
    const second = translateText(b, 'fr', true)
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
    const again = translateText(t, 'fr', true) // as tr() asks
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

/** A fetch whose answers wait until the test gives them, by request number. */
function heldFetch() {
  const answers: ((translations: string[], partial?: boolean) => void)[] = []
  const fetchMock = vi.fn(() => new Promise<Response>((resolve) => {
    answers.push((translations, partial = false) => resolve(new Response(JSON.stringify({ translations, partial }), { status: 200 })))
  }))
  return { fetchMock, answer: (i: number, translations: string[], partial?: boolean) => answers[i](translations, partial) }
}

describe('⛔ a landing repaints the app only for a text tr() asked for (speed audit, 2026-11-10)', () => {
  it('does not repaint for texts only promise readers asked for (useTr, useMachineEn), and still answers them', async () => {
    // Vietnamese /c/rentals: 2 card titles landing re-rendered 1,203 components in one ~175 ms task (4x), to draw nothing.
    vi.useFakeTimers()
    vi.stubGlobal('fetch', ok(['Căn hộ hai phòng ngủ, Quận 2', 'Studio gần sông']))
    const repaints = vi.fn()
    const off = subscribeTr(repaints)
    const asks = [translateText('Two-bedroom flat, District 2', 'vi'), translateText('Studio near the river', 'vi')]
    await vi.advanceTimersByTimeAsync(60)
    await expect(Promise.all(asks)).resolves.toEqual(['Căn hộ hai phòng ngủ, Quận 2', 'Studio gần sông'])
    expect(trCache.get('vi Studio near the river')).toBe('Studio gần sông')
    expect(repaints).not.toHaveBeenCalled()
    off()
  })

  it('repaints once for a batch in which tr() asked one of the texts', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('fetch', ok(['Bán xe máy', 'Tìm phòng']))
    const repaints = vi.fn()
    const off = subscribeTr(repaints)
    const asks = [translateText('Motorbike for sale', 'vi'), translateText('Find a room', 'vi', true)]
    await vi.advanceTimersByTimeAsync(60)
    await expect(Promise.all(asks)).resolves.toEqual(['Bán xe máy', 'Tìm phòng'])
    expect(repaints).toHaveBeenCalledTimes(1)
    off()
  })

  it("repaints when another caller's batch lands a text tr() still waits on after its own ask missed", async () => {
    vi.useFakeTimers()
    const t = 'Garden view, quiet street'
    const { fetchMock, answer } = heldFetch()
    vi.stubGlobal('fetch', fetchMock)
    const repaints = vi.fn()
    const off = subscribeTr(repaints)
    const fromTr = translateText(t, 'ko', true)
    await vi.advanceTimersByTimeAsync(60) // request 0 is out
    const fromCard = translateText(t, 'ko') // a card's useTr, while it is out
    await vi.advanceTimersByTimeAsync(60) // request 1
    expect(fetchMock).toHaveBeenCalledTimes(2)
    answer(0, [t], true) // rate-limited: a miss
    await expect(fromTr).resolves.toBe(t)
    expect(repaints).not.toHaveBeenCalled()
    answer(1, ['정원 전망, 조용한 거리'])
    await expect(fromCard).resolves.toBe('정원 전망, 조용한 거리')
    expect(repaints).toHaveBeenCalledTimes(1)
    off()
  })

  it('a tr() ask answered from the wait still repaints when a request already out lands the text', async () => {
    vi.useFakeTimers()
    const t = 'Pet friendly, balcony'
    const { fetchMock, answer } = heldFetch()
    vi.stubGlobal('fetch', fetchMock)
    const repaints = vi.fn()
    const off = subscribeTr(repaints)
    const cardA = translateText(t, 'ko')
    await vi.advanceTimersByTimeAsync(60) // request 0
    const cardB = translateText(t, 'ko') // a second card, mounted a moment later
    await vi.advanceTimersByTimeAsync(60) // request 1
    answer(0, [t]) // a miss: the text now waits
    await expect(cardA).resolves.toBe(t)
    // tr() asks during the wait: English at once, no request.
    await expect(translateText(t, 'ko', true)).resolves.toBe(t)
    await vi.advanceTimersByTimeAsync(60)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    answer(1, ['반려동물 가능, 발코니'])
    await expect(cardB).resolves.toBe('반려동물 가능, 발코니')
    expect(repaints).toHaveBeenCalledTimes(1)
    off()
  })

  it('forgetting an old miss (past the miss cap) does not forget that tr() still waits on the text', async () => {
    // Commit-gate review: the miss cache drops its oldest entries past 1,000. If that also dropped tr()'s wait, a
    // request already out could land the text with no repaint and the label would stay English.
    vi.useFakeTimers()
    const t = 'Rooftop terrace, river view'
    const { fetchMock, answer } = heldFetch()
    vi.stubGlobal('fetch', fetchMock)
    const repaints = vi.fn()
    const off = subscribeTr(repaints)
    const fromTr = translateText(t, 'ko', true)
    await vi.advanceTimersByTimeAsync(60) // request 0 carries tr()'s ask
    const fromCard = translateText(t, 'ko') // a card's useTr asks for the same text while it is out
    await vi.advanceTimersByTimeAsync(60) // request 1
    answer(0, [t], true) // a miss: the text waits, and its miss is now the oldest on record
    await expect(fromTr).resolves.toBe(t)
    const others = Array.from({ length: 1001 }, (_, i) => `Other listing title ${i}`)
    const otherAsks = Promise.all(others.map((o) => translateText(o, 'ko')))
    await vi.advanceTimersByTimeAsync(60) // request 2: one request, every text once
    expect(fetchMock).toHaveBeenCalledTimes(3)
    answer(2, others, true) // all of them miss, which pushes the first miss out of the cache
    await expect(otherAsks).resolves.toEqual(others)
    expect(repaints).not.toHaveBeenCalled()
    answer(1, ['옥상 테라스, 강 전망'])
    await expect(fromCard).resolves.toBe('옥상 테라스, 강 전망')
    expect(repaints).toHaveBeenCalledTimes(1)
    off()
  })

  it('past its own cap a forgotten wait still gets its repaint: every landing repaints again', async () => {
    // Commit-gate review: 5,000 newer tr() asks push the oldest wait out while its request is still out.
    vi.useFakeTimers()
    const t = 'Furnished studio, monthly'
    const { fetchMock, answer } = heldFetch()
    vi.stubGlobal('fetch', fetchMock)
    const repaints = vi.fn()
    const off = subscribeTr(repaints)
    const label = translateText(t, 'ko', true)
    await vi.advanceTimersByTimeAsync(60) // request 0: the label's own ask, still out
    const others = Array.from({ length: 5000 }, (_, i) => `Interface text ${i}`)
    const otherAsks = Promise.all(others.map((o) => translateText(o, 'ko', true)))
    await vi.advanceTimersByTimeAsync(60) // request 1
    answer(1, others, true) // they miss; the label's wait is the one the cap dropped
    await expect(otherAsks).resolves.toEqual(others)
    expect(repaints).not.toHaveBeenCalled()
    answer(0, ['가구 완비 스튜디오, 월세'])
    await expect(label).resolves.toBe('가구 완비 스튜디오, 월세')
    expect(repaints).toHaveBeenCalledTimes(1)
    off()
  })

  it('repaints again when a second answer for the same text replaces the first', async () => {
    // Commit-gate review: two requests carrying one text can come back worded differently. A tr() label showing the
    // first wording must not be left behind when the cache takes the second.
    vi.useFakeTimers()
    const t = 'Quiet lane, near the market'
    const { fetchMock, answer } = heldFetch()
    vi.stubGlobal('fetch', fetchMock)
    const repaints = vi.fn()
    const off = subscribeTr(repaints)
    const label = translateText(t, 'ko', true)
    await vi.advanceTimersByTimeAsync(60) // request 0
    const card = translateText(t, 'ko') // a card's useTr, while it is out
    await vi.advanceTimersByTimeAsync(60) // request 1
    answer(0, ['조용한 골목, 시장 근처'])
    await expect(label).resolves.toBe('조용한 골목, 시장 근처')
    expect(repaints).toHaveBeenCalledTimes(1)
    answer(1, ['시장 근처의 조용한 골목'])
    await expect(card).resolves.toBe('시장 근처의 조용한 골목')
    expect(trCache.get(`ko ${t}`)).toBe('시장 근처의 조용한 골목')
    expect(repaints).toHaveBeenCalledTimes(2)
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

/** A fetch answering 500 for every request listed in `failing` (by request number), and `translations` otherwise. */
function scriptedFetch(failing: (i: number) => boolean, translations: (texts: string[]) => string[]) {
  let i = 0
  return vi.fn(async (_url: string, init?: RequestInit) => {
    const { texts } = JSON.parse(String(init?.body)) as { texts: string[] }
    return failing(i++) ? new Response('{"error":"Translation failed"}', { status: 500 }) : new Response(JSON.stringify({ translations: translations(texts) }), { status: 200 })
  })
}

describe('⛔ a text a failed request left in English is asked again for whoever still shows it (2026-11-11)', () => {
  beforeEach(() => trCache.clear())
  // Wave-1 build, one 500 on the first per-string batch: 0/12 card titles translated on Korean / and on /vi for the rest
  // of the visit, and the <Tr> labels of that batch ("Listings", "Other categories") stayed English on Korean /c/rentals.
  it('asks again when the wait ends and hands the translation to the waiter alone — no app repaint', async () => {
    vi.useFakeTimers()
    const t = 'Two-bedroom flat near the river'
    const fetchMock = scriptedFetch((i) => i === 0, () => ['강 근처 방 두 개 아파트'])
    vi.stubGlobal('fetch', fetchMock)
    const repaints = vi.fn()
    const off = subscribeTr(repaints)
    const first = translateText(t, 'ko') // a card's useTr
    await vi.advanceTimersByTimeAsync(60)
    await expect(first).resolves.toBe(t) // the 500: English for now
    const got = vi.fn()
    waitForTranslation(t, 'ko', got)
    await vi.advanceTimersByTimeAsync(14_900)
    expect(fetchMock).toHaveBeenCalledTimes(1) // not before its wait ends
    await vi.advanceTimersByTimeAsync(200)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(bodyOf(fetchMock.mock.calls[1])).toEqual({ texts: [t], target: 'ko' })
    expect(got).toHaveBeenCalledExactlyOnceWith('강 근처 방 두 개 아파트')
    expect(repaints).not.toHaveBeenCalled()
    off()
  })

  it('a `partial` reply (rate limit, provider down) counts as a failure: asked again', async () => {
    vi.useFakeTimers()
    const t = 'Studio with balcony'
    let n = 0
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(n++ === 0 ? { translations: [t], partial: true } : { translations: ['발코니가 있는 스튜디오'] }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const first = translateText(t, 'ko')
    await vi.advanceTimersByTimeAsync(60)
    await first
    const got = vi.fn()
    waitForTranslation(t, 'ko', got)
    await vi.advanceTimersByTimeAsync(15_100)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(got).toHaveBeenCalledExactlyOnceWith('발코니가 있는 스튜디오')
  })

  it('a Vietnamese reader too: the same retry for target vi', async () => {
    vi.useFakeTimers()
    const t = 'Fixture imported flat'
    const fetchMock = scriptedFetch((i) => i === 0, () => ['Căn hộ nhập khẩu'])
    vi.stubGlobal('fetch', fetchMock)
    const first = translateText(t, 'vi')
    await vi.advanceTimersByTimeAsync(60)
    await first
    const got = vi.fn()
    waitForTranslation(t, 'vi', got)
    await vi.advanceTimersByTimeAsync(15_100)
    expect(bodyOf(fetchMock.mock.calls[1])).toEqual({ texts: [t], target: 'vi' })
    expect(got).toHaveBeenCalledExactlyOnceWith('Căn hộ nhập khẩu')
  })

  it('⛔ a DEFINITE passthrough (a name) is never asked again for a waiter: in a visit with no failure the waiter adds no request', async () => {
    vi.useFakeTimers()
    const t = 'Zalo OA'
    const fetchMock = ok([t])
    vi.stubGlobal('fetch', fetchMock)
    const repaints = vi.fn()
    const off = subscribeTr(repaints)
    const first = translateText(t, 'ko')
    await vi.advanceTimersByTimeAsync(60)
    await first
    const got = vi.fn()
    waitForTranslation(t, 'ko', got)
    await vi.advanceTimersByTimeAsync(3_600_000)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(got).not.toHaveBeenCalled()
    expect(repaints).not.toHaveBeenCalled()
    off()
  })

  it('⛔ bounded against a server that keeps failing: one request per wait (15 s, ×4, at most 10 min), none once the reader is gone', async () => {
    vi.useFakeTimers()
    const texts = ['Scooter for rent, monthly', 'Desk lamp, barely used']
    const fetchMock = scriptedFetch(() => true, (x) => x)
    vi.stubGlobal('fetch', fetchMock)
    const asks = texts.map((t) => translateText(t, 'ja'))
    await vi.advanceTimersByTimeAsync(60)
    await Promise.all(asks)
    const stops = texts.map((t) => waitForTranslation(t, 'ja', () => {}))
    await vi.advanceTimersByTimeAsync(3_600_000 - 60)
    // One request per wave, both texts in it: at 0 s, 15 s, 75 s, 315 s, 915 s, then every 600 s — 9 in the first hour.
    expect(fetchMock).toHaveBeenCalledTimes(9)
    for (const call of fetchMock.mock.calls) expect(bodyOf(call).texts).toEqual(texts)
    stops.forEach((stop) => stop())
    await vi.advanceTimersByTimeAsync(3_600_000)
    expect(fetchMock).toHaveBeenCalledTimes(9)
  })

  it('⛔ never twice in flight: a retry still out (a hanging 524) is not posted again by the next wave; once it fails, it is asked again', async () => {
    vi.useFakeTimers()
    const A = 'Card title A'
    const B = 'Card title B'
    const calls: string[][] = []
    let failHungA: (() => void) | undefined
    // #0 (A) and #1 (B) fail at once; #2 (A's retry) hangs until the test fails it; later requests succeed.
    const fetchMock = vi.fn((_url: string, init?: RequestInit) => {
      const { texts } = JSON.parse(String(init?.body)) as { texts: string[] }
      const n = calls.push(texts) - 1
      if (n < 2) return Promise.resolve(new Response('{}', { status: 500 }))
      if (n === 2) return new Promise<Response>((resolve) => { failHungA = () => resolve(new Response('{}', { status: 524 })) })
      return Promise.resolve(new Response(JSON.stringify({ translations: texts.map((t) => `[ko] ${t}`) }), { status: 200 }))
    })
    vi.stubGlobal('fetch', fetchMock)
    const a = translateText(A, 'ko')
    await vi.advanceTimersByTimeAsync(60)
    await a
    const gotA = vi.fn()
    waitForTranslation(A, 'ko', gotA)
    await vi.advanceTimersByTimeAsync(5_000) // B's card scrolls in 5 s later: its own failure, its own wait
    const b = translateText(B, 'ko')
    await vi.advanceTimersByTimeAsync(60)
    await b
    const gotB = vi.fn()
    waitForTranslation(B, 'ko', gotB)
    await vi.advanceTimersByTimeAsync(10_100) // A's wait ends: its retry goes, and hangs
    await vi.advanceTimersByTimeAsync(5_100) // B's wait ends: B goes, A (still out) does not
    expect(calls).toEqual([[A], [B], [A], [B]])
    expect(gotB).toHaveBeenCalledExactlyOnceWith(`[ko] ${B}`)
    expect(gotA).not.toHaveBeenCalled()
    failHungA!() // the hanging retry ends in a 524: a new miss, a new wait (60 s), then A is asked again
    await vi.advanceTimersByTimeAsync(59_000)
    expect(calls).toHaveLength(4)
    await vi.advanceTimersByTimeAsync(2_100)
    expect(calls).toEqual([[A], [B], [A], [B], [A]])
    expect(gotA).toHaveBeenCalledExactlyOnceWith(`[ko] ${A}`)
  })

  it('an unmounted reader is not asked for: unsubscribing before the wait ends sends nothing', async () => {
    vi.useFakeTimers()
    const t = 'Bicycle, city size'
    const fetchMock = scriptedFetch((i) => i === 0, () => ['도시형 자전거'])
    vi.stubGlobal('fetch', fetchMock)
    const first = translateText(t, 'ko')
    await vi.advanceTimersByTimeAsync(60)
    await first
    const got = vi.fn()
    const stop = waitForTranslation(t, 'ko', got)
    stop()
    await vi.advanceTimersByTimeAsync(600_000)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(got).not.toHaveBeenCalled()
  })

  it('the UI dictionary wakes a waiter; an English passthrough in it (a failed chunk) does not', async () => {
    const t = 'Other categories'
    const got = vi.fn()
    waitForTranslation(t, 'ko', got)
    trCache.set(`ko ${t}`, t) // a dictionary chunk that failed seeds the English
    wakeTranslationWaiters()
    expect(got).not.toHaveBeenCalled()
    trCache.set(`ko ${t}`, '다른 카테고리')
    wakeTranslationWaiters()
    expect(got).toHaveBeenCalledExactlyOnceWith('다른 카테고리')
    wakeTranslationWaiters() // once only
    expect(got).toHaveBeenCalledTimes(1)
  })

  it('another batch landing the text wakes the waiter, and a translation already cached answers at once', async () => {
    vi.useFakeTimers()
    const t = 'Listings'
    vi.stubGlobal('fetch', ok(['목록']))
    const got = vi.fn()
    waitForTranslation(t, 'ko', got)
    const fromTr = translateText(t, 'ko', true) // tr() asks for the same text
    await vi.advanceTimersByTimeAsync(60)
    await fromTr
    expect(got).toHaveBeenCalledExactlyOnceWith('목록')
    const later = vi.fn()
    waitForTranslation(t, 'ko', later)
    expect(later).toHaveBeenCalledExactlyOnceWith('목록')
  })
})

describe('a text the cache got while it waited for its batch (repeat Korean visit, 2026-11-11)', () => {
  beforeEach(() => trCache.clear())
  // Wave-1 build, Chromium: the stored UI dictionary was read 30-200 ms before the first batch left (every run), and 125 of
  // its 127 texts on Korean /c/rentals were dictionary labels — posted anyway, every repeat visit. In WebKit the
  // dictionary is read 3-8 ms after the batch left (12 of 12 runs), so there this changes nothing.
  it('is answered from the cache and not posted; only the rest of the batch goes', async () => {
    vi.useFakeTimers()
    const label = 'Other categories'
    const title = 'Fixture imported flat'
    const fetchMock = ok(['수입 아파트'])
    vi.stubGlobal('fetch', fetchMock)
    const repaints = vi.fn()
    const off = subscribeTr(repaints)
    const fromTr = translateText(label, 'ko', true) // the first Korean render, before the dictionary is read
    const fromCard = translateText(title, 'ko')
    trCache.set(`ko ${label}`, '다른 카테고리') // seedFromMap, inside the 60 ms window
    await vi.advanceTimersByTimeAsync(60)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(bodyOf(fetchMock.mock.calls[0])).toEqual({ texts: [title], target: 'ko' })
    await expect(fromTr).resolves.toBe('다른 카테고리')
    await expect(fromCard).resolves.toBe('수입 아파트')
    expect(repaints).not.toHaveBeenCalled() // the dictionary's own seeding repainted tr(); the title is a promise reader's
    off()
  })

  it('sends nothing at all when the cache holds every text', async () => {
    vi.useFakeTimers()
    const fetchMock = ok([])
    vi.stubGlobal('fetch', fetchMock)
    const ask = translateText('Listings', 'ko', true)
    trCache.set('ko Listings', '목록')
    await vi.advanceTimersByTimeAsync(200)
    expect(fetchMock).not.toHaveBeenCalled()
    await expect(ask).resolves.toBe('목록')
  })

  it('⛔ wakes a waiter whose re-ask is answered from the cache: its reader does not stay in English (commit-gate review)', async () => {
    // A failed request left the reader with the English and a waiter. Before its retry leaves, the cache gets the text
    // from a writer that wakes nobody (seedViDict, a server-sent title). The retry is then answered here, with no request,
    // and nobody reads its promise: without the wake the reader kept the English for the visit.
    vi.useFakeTimers()
    const t = 'Flat with a balcony'
    const fetchMock = scriptedFetch(() => true, () => [])
    vi.stubGlobal('fetch', fetchMock)
    const first = translateText(t, 'vi')
    await vi.advanceTimersByTimeAsync(60)
    await expect(first).resolves.toBe(t) // the failure
    const got = vi.fn()
    waitForTranslation(t, 'vi', got)
    await vi.advanceTimersByTimeAsync(15_010) // the wait is over: the timer re-asks, the text sits in its 60 ms batch
    trCache.set(`vi ${t}`, 'Căn hộ có ban công') // written meanwhile, no waiter woken
    await vi.advanceTimersByTimeAsync(100)
    expect(fetchMock).toHaveBeenCalledTimes(1) // answered from the cache: no second request
    expect(got).toHaveBeenCalledExactlyOnceWith('Căn hộ có ban công')
  })

  it('still posts a text the cache holds only as its English (a dictionary chunk that failed)', async () => {
    vi.useFakeTimers()
    const t = 'Show more'
    const fetchMock = ok(['더 보기'])
    vi.stubGlobal('fetch', fetchMock)
    const ask = translateText(t, 'ko', true)
    trCache.set(`ko ${t}`, t)
    await vi.advanceTimersByTimeAsync(60)
    expect(bodyOf(fetchMock.mock.calls[0])).toEqual({ texts: [t], target: 'ko' })
    await expect(ask).resolves.toBe('더 보기')
  })
})
