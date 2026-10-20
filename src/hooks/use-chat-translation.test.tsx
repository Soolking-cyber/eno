// @vitest-environment jsdom
import * as React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { useChatTranslation } from './use-chat-translation'

// ── App Store gate `app-ai-notice` on live chat translation (plan R8, Guideline 5.1.2(i), D14) ────────
// Off (the default) the hook is exactly what it was: a language mismatch starts translation ON and the
// counterpart's messages go to POST /api/messages/translate. On, inside either app, NOTHING is requested
// until the one-time notice is answered; "off" stops every request for that account on that device.
// The assertion that matters is on fetch — the request — not on what renders.

const IOS_APP = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 EnoNativeApp/1'
const ANDROID_APP = 'Mozilla/5.0 (Linux; Android 15; Pixel 9; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/140.0.0.0 Mobile Safari/537.36 EnoNativeApp/1'
const DESKTOP = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36'

const ME = '11111111-1111-4111-8111-111111111111'
const OTHER_USER = '22222222-2222-4222-8222-222222222222'
const CONVO = 'convo-1'
const MESSAGES = [
  { id: 'm1', mine: false, body: 'Xin chào, căn hộ còn trống không?', kind: 'text' },
  { id: 'm2', mine: true, body: 'Hi, yes it is', kind: 'text' },
]

let fetchMock: ReturnType<typeof vi.fn>
// Node 25 ships its own `localStorage` global that shadows jsdom's (no methods without a backing file),
// so each test gets an in-memory one — the same approach as src/context/theme-color.test.tsx.
let store: Map<string, string>
const memoryStorage = () => ({
  getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
  setItem: (k: string, v: string) => { store.set(k, String(v)) },
  removeItem: (k: string) => { store.delete(k) },
  clear: () => store.clear(),
  key: (i: number) => [...store.keys()][i] ?? null,
  get length() { return store.size },
})
const translateCalls = () => fetchMock.mock.calls.filter(([url]) => url === '/api/messages/translate')

function as(ua: string) {
  vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(ua)
}

function mount(opts: { userId?: string; counterpartLang?: string | null; conversationId?: string; messages?: typeof MESSAGES } = {}) {
  return renderHook(() =>
    useChatTranslation({
      conversationId: opts.conversationId ?? CONVO,
      userId: opts.userId ?? ME,
      myLang: 'en',
      counterpartLang: opts.counterpartLang === undefined ? 'vi' : opts.counterpartLang,
      messages: opts.messages ?? MESSAGES,
    }),
  )
}

/** Let the fetch effect run (or not) and its promise settle. */
const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 0)) })

beforeEach(() => {
  store = new Map()
  vi.stubGlobal('localStorage', memoryStorage())
  fetchMock = vi.fn(() =>
    Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ items: [{ id: 'm1', text: 'Hello, is the flat still free?', translated: true }] }) }),
  )
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => {
  cleanup()
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('gate OFF (the shipped default) — unchanged everywhere', () => {
  it.each([['iOS app', IOS_APP], ['Android app', ANDROID_APP], ['web', DESKTOP]])('%s: a mismatch translates at once, no notice', async (_, ua) => {
    vi.stubEnv('NEXT_PUBLIC_APP_REVIEW_GATES', '')
    as(ua)
    const { result } = mount()
    await waitFor(() => expect(translateCalls()).toHaveLength(1))
    expect(JSON.parse(String(translateCalls()[0][1].body))).toEqual({ conversationId: CONVO, messageIds: ['m1'], target: 'en', v: 2 })
    expect(result.current.available).toBe(true)
    expect(result.current.enabled).toBe(true)
    expect(result.current.needsNotice).toBe(false)
    expect(result.current.showToggle).toBe(true)
    await waitFor(() => expect(result.current.translationFor('m1')).toBe('Hello, is the flat still free?'))
    // Nothing about the gate is written to the device.
    expect(localStorage.getItem(`chat-tr:consent:${ME}`)).toBeNull()
  })

  it('ignores a stored "off" answer while the gate is off', async () => {
    vi.stubEnv('NEXT_PUBLIC_APP_REVIEW_GATES', '')
    as(IOS_APP)
    localStorage.setItem(`chat-tr:consent:${ME}`, 'off')
    mount()
    await waitFor(() => expect(translateCalls()).toHaveLength(1))
  })

  it('other gates on do not switch the notice on', async () => {
    vi.stubEnv('NEXT_PUBLIC_APP_REVIEW_GATES', 'ios-hide-google,ios-hide-wallet,app-signin-tidy,app-no-gtm,site-brand-copy,ugc-safety')
    as(IOS_APP)
    const { result } = mount()
    await waitFor(() => expect(translateCalls()).toHaveLength(1))
    expect(result.current.needsNotice).toBe(false)
  })
})

describe('gate ON, on the web — unchanged', () => {
  it('translates at once and never asks', async () => {
    vi.stubEnv('NEXT_PUBLIC_APP_REVIEW_GATES', 'app-ai-notice')
    as(DESKTOP)
    const { result } = mount()
    await waitFor(() => expect(translateCalls()).toHaveLength(1))
    expect(result.current.needsNotice).toBe(false)
  })
})

describe.each([['iOS app', IOS_APP], ['Android app', ANDROID_APP]])('gate ON, in the %s', (_, ua) => {
  beforeEach(() => {
    vi.stubEnv('NEXT_PUBLIC_APP_REVIEW_GATES', 'app-ai-notice')
    as(ua)
  })

  it('asks first and sends NOTHING until answered', async () => {
    const { result } = mount()
    await settle()
    expect(result.current.needsNotice).toBe(true)
    expect(result.current.available).toBe(true)
    expect(translateCalls()).toHaveLength(0)
    expect(result.current.translationFor('m1')).toBeUndefined()
  })

  it('OK → requests start, and the answer is remembered for the account', async () => {
    const { result } = mount()
    await settle()
    act(() => result.current.answerNotice('on'))
    await waitFor(() => expect(translateCalls()).toHaveLength(1))
    expect(result.current.needsNotice).toBe(false)
    expect(localStorage.getItem(`chat-tr:consent:${ME}`)).toBe('on')
    await waitFor(() => expect(result.current.translationFor('m1')).toBe('Hello, is the flat still free?'))
  })

  it('"Turn off translation" → no request, no strip, and it stays off on the next visit', async () => {
    const first = mount()
    await settle()
    act(() => first.result.current.answerNotice('off'))
    await settle()
    expect(translateCalls()).toHaveLength(0)
    expect(first.result.current.available).toBe(false)
    expect(first.result.current.needsNotice).toBe(false)
    expect(localStorage.getItem(`chat-tr:consent:${ME}`)).toBe('off')
    first.unmount()

    const again = mount()
    await settle()
    expect(again.result.current.available).toBe(false)
    expect(again.result.current.needsNotice).toBe(false)
    expect(translateCalls()).toHaveLength(0)
  })

  it('a stored "on" (OK earlier, or Settings) translates without asking', async () => {
    localStorage.setItem(`chat-tr:consent:${ME}`, 'on')
    const { result } = mount()
    await waitFor(() => expect(translateCalls()).toHaveLength(1))
    expect(result.current.needsNotice).toBe(false)
  })

  it('the answer belongs to ONE account — another account on the device is asked', async () => {
    localStorage.setItem(`chat-tr:consent:${OTHER_USER}`, 'on')
    const { result } = mount()
    await settle()
    expect(result.current.needsNotice).toBe(true)
    expect(translateCalls()).toHaveLength(0)
  })

  it('a conversation already unticked asks nothing until it is ticked — and still sends nothing then', async () => {
    localStorage.setItem(`chat-tr:${ME}:${CONVO}`, 'off')
    const { result } = mount()
    await settle()
    expect(result.current.enabled).toBe(false)
    expect(result.current.needsNotice).toBe(false)
    act(() => result.current.setEnabled(true))
    await settle()
    expect(result.current.needsNotice).toBe(true)
    expect(translateCalls()).toHaveLength(0)
  })

  it('no language mismatch → nothing to ask about', async () => {
    // same stored language AND the incoming line reads as mine
    const { result } = mount({ counterpartLang: 'en', messages: [{ id: 'm1', mine: false, body: 'Is the flat still free next month?', kind: 'text' }, MESSAGES[1]] })
    await settle()
    expect(result.current.available).toBe(false)
    expect(result.current.needsNotice).toBe(false)
    expect(translateCalls()).toHaveLength(0)
  })

  it('nothing incoming yet → nothing to translate, so nothing is asked, nothing sent, and no ticked strip', async () => {
    const { result } = mount({ messages: [MESSAGES[1]] })
    await settle()
    expect(result.current.available).toBe(true)
    expect(result.current.needsNotice).toBe(false)
    expect(result.current.showToggle).toBe(false)
    expect(translateCalls()).toHaveLength(0)
  })

  it('the strip: hidden while asking, shown once allowed; an unticked thread keeps it (ticking it then asks)', async () => {
    const asking = mount()
    await settle()
    expect(asking.result.current.showToggle).toBe(false)
    act(() => asking.result.current.answerNotice('on'))
    expect(asking.result.current.showToggle).toBe(true)
    asking.unmount()
    store.clear()
    store.set(`chat-tr:${ME}:${CONVO}`, 'off')
    const unticked = mount()
    await settle()
    expect(unticked.result.current.showToggle).toBe(true)
    expect(unticked.result.current.enabled).toBe(false)
  })

  it('an answer changed elsewhere (Settings) applies to a MOUNTED thread at once', async () => {
    const { result, rerender } = mount()
    await settle()
    act(() => result.current.answerNotice('on'))
    await waitFor(() => expect(translateCalls()).toHaveLength(1))
    // Settings writes "off" while the thread is still mounted.
    const { writeChatTranslationConsent } = await import('@/lib/chat-translation-consent')
    act(() => writeChatTranslationConsent(ME, 'off'))
    rerender()
    expect(result.current.available).toBe(false)
    expect(result.current.translationFor('m1')).toBeUndefined()
  })

  it('ONE answer for the account: OK in one chat lets another translate without asking — the notice says so', async () => {
    const first = mount()
    await settle()
    act(() => first.result.current.answerNotice('on'))
    first.unmount()
    fetchMock.mockClear()
    const other = mount({ conversationId: 'convo-2' })
    await waitFor(() => expect(translateCalls()).toHaveLength(1))
    expect(other.result.current.needsNotice).toBe(false)
  })

  it('blocked storage counts as "not asked" — still nothing is sent', async () => {
    const blocked = () => { throw new Error('blocked') }
    vi.stubGlobal('localStorage', { getItem: blocked, setItem: blocked, removeItem: blocked, clear: blocked, key: blocked, length: 0 })
    const { result } = mount()
    await settle()
    expect(result.current.needsNotice).toBe(true)
    expect(translateCalls()).toHaveLength(0)
  })
})

describe('retries are per message, and bounded', () => {
  type Props = { messages: typeof MESSAGES }
  const mountWith = (initial: Props, wrapper?: React.ComponentType<{ children: React.ReactNode }>) =>
    renderHook((p: Props) => useChatTranslation({ conversationId: CONVO, userId: ME, myLang: 'en', counterpartLang: 'vi', messages: p.messages }), { initialProps: initial, wrapper })
  const answer = (item: Record<string, unknown>) =>
    fetchMock.mockImplementation(() => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ items: [item] }) }))

  it('a message the server marks `retry` is asked again on the next refetch — and given up after 4 tries', async () => {
    vi.stubEnv('NEXT_PUBLIC_APP_REVIEW_GATES', '')
    as(DESKTOP)
    answer({ id: 'm1', text: MESSAGES[0].body, translated: false, retry: true })
    const { rerender } = mountWith({ messages: MESSAGES })
    await waitFor(() => expect(translateCalls()).toHaveLength(1))
    // each refetch (the 15s poll) hands the hook a NEW array — the retry rides it
    for (let n = 2; n <= 4; n++) {
      rerender({ messages: [...MESSAGES] })
      await waitFor(() => expect(translateCalls()).toHaveLength(n))
    }
    rerender({ messages: [...MESSAGES] })
    await settle()
    expect(translateCalls()).toHaveLength(4)
  })

  it('a definite answer is never asked again', async () => {
    vi.stubEnv('NEXT_PUBLIC_APP_REVIEW_GATES', '')
    as(DESKTOP)
    const { rerender, result } = mountWith({ messages: MESSAGES })
    await waitFor(() => expect(result.current.translationFor('m1')).toBe('Hello, is the flat still free?'))
    rerender({ messages: [...MESSAGES] })
    await settle()
    expect(translateCalls()).toHaveLength(1)
  })

  it('⛔ keeps working after its effects re-run without a remount (Next\'s back/forward state cache, <Activity>)', async () => {
    vi.stubEnv('NEXT_PUBLIC_APP_REVIEW_GATES', '')
    as(DESKTOP)
    // Hidden ⇒ React runs every effect cleanup but keeps the state; shown ⇒ it re-runs the effects. A thread you
    // navigate away from and back to goes through exactly this.
    let setMode: (m: 'visible' | 'hidden') => void = () => {}
    const Host = ({ children }: { children: React.ReactNode }) => {
      const [mode, set] = React.useState<'visible' | 'hidden'>('visible')
      setMode = set
      return <React.Activity mode={mode}>{children}</React.Activity>
    }
    const { rerender } = mountWith({ messages: [] }, Host)
    await settle()
    act(() => setMode('hidden'))
    await settle()
    act(() => setMode('visible'))
    await settle()
    // A message arrives after coming back: it must still be sent.
    rerender({ messages: MESSAGES })
    await waitFor(() => expect(translateCalls()).toHaveLength(1))
  })
})

describe('the messages decide, not only the stored language', () => {
  it('⛔ a STALE stored language (says mine) no longer hides a Vietnamese line from an English reader', async () => {
    vi.stubEnv('NEXT_PUBLIC_APP_REVIEW_GATES', '')
    as(DESKTOP)
    const { result } = mount({ counterpartLang: 'en' }) // stored 'en', but they wrote Vietnamese
    await waitFor(() => expect(translateCalls()).toHaveLength(1))
    expect(result.current.available).toBe(true)
    expect(JSON.parse(String(translateCalls()[0][1].body)).messageIds).toEqual(['m1'])
  })

  it('⛔ an UNKNOWN stored language (an unowned desk, a never-synced account) does too — unaccented Vietnamese included', async () => {
    vi.stubEnv('NEXT_PUBLIC_APP_REVIEW_GATES', '')
    as(DESKTOP)
    const { result } = mount({ counterpartLang: null, messages: [{ id: 'm1', mine: false, body: 'xin chao, ban khoe khong', kind: 'text' }] })
    await waitFor(() => expect(translateCalls()).toHaveLength(1))
    expect(result.current.showToggle).toBe(true)
  })

  it('asks only about the lines that read as another language — not greetings, not my language', async () => {
    vi.stubEnv('NEXT_PUBLIC_APP_REVIEW_GATES', '')
    as(DESKTOP)
    mount({ messages: [
      { id: 'g', mine: false, body: 'hi', kind: 'text' },
      { id: 'e', mine: false, body: 'Is parking included?', kind: 'text' },
      { id: 'v', mine: false, body: 'Bạn khỏe không', kind: 'text' },
    ] })
    await waitFor(() => expect(translateCalls()).toHaveLength(1))
    expect(JSON.parse(String(translateCalls()[0][1].body)).messageIds).toEqual(['v'])
  })
})

describe('one foreign line does not flip a same-language thread', () => {
  it('a Vietnamese reader, a Vietnamese counterpart (stored vi), and one "Thanks" → no strip, no request', async () => {
    vi.stubEnv('NEXT_PUBLIC_APP_REVIEW_GATES', '')
    as(DESKTOP)
    const { result } = renderHook(() =>
      useChatTranslation({
        conversationId: CONVO, userId: ME, myLang: 'vi', counterpartLang: 'vi',
        messages: [
          { id: 'a', mine: false, body: 'Phòng còn trống anh nhé', kind: 'text' },
          { id: 'b', mine: false, body: 'Thanks', kind: 'text' },
        ],
      }),
    )
    await settle()
    expect(result.current.available).toBe(false)
    expect(translateCalls()).toHaveLength(0)
  })

  it('a recalled message keeps no translation', async () => {
    vi.stubEnv('NEXT_PUBLIC_APP_REVIEW_GATES', '')
    as(DESKTOP)
    const { result, rerender } = renderHook((p: { deleted: boolean }) =>
      useChatTranslation({ conversationId: CONVO, userId: ME, myLang: 'en', counterpartLang: 'vi', messages: [{ ...MESSAGES[0], deleted: p.deleted }] }),
      { initialProps: { deleted: false } })
    await waitFor(() => expect(result.current.translationFor('m1')).toBe('Hello, is the flat still free?'))
    rerender({ deleted: true })
    expect(result.current.translationFor('m1')).toBeUndefined()
  })
})

describe('long messages are packed under the route\'s character cap', () => {
  it('three 2,000-character introductions go as separate requests, not one refused batch', async () => {
    vi.stubEnv('NEXT_PUBLIC_APP_REVIEW_GATES', '')
    as(DESKTOP)
    const long = (n: number) => `Tôi là giáo viên tiếng Anh có nhiều năm kinh nghiệm ${n} `.repeat(40).slice(0, 2000)
    mount({ messages: [1, 2, 3].map((n) => ({ id: `l${n}`, mine: false, body: long(n), kind: 'text' })) })
    await waitFor(() => expect(translateCalls().length).toBeGreaterThanOrEqual(2))
    const sizes = translateCalls().map(([, init]) => (JSON.parse(String(init.body)).messageIds as string[]).length)
    expect(sizes.reduce((a, b) => a + b, 0)).toBe(3)
    expect(Math.max(...sizes)).toBeLessThanOrEqual(2) // 2 × 2,000 ≤ 4,500 < 3 × 2,000
  })
})

describe('a stale stored language no longer raises the strip alone', () => {
  it('stored "en" for a counterpart who clearly writes Vietnamese, read by a Vietnamese reader → no strip, nothing sent', async () => {
    vi.stubEnv('NEXT_PUBLIC_APP_REVIEW_GATES', '')
    as(DESKTOP)
    const { result } = renderHook(() =>
      useChatTranslation({
        conversationId: CONVO, userId: ME, myLang: 'vi', counterpartLang: 'en',
        messages: [
          { id: 'a', mine: false, body: 'Phòng còn trống không anh?', kind: 'text' },
          { id: 'b', mine: false, body: 'Em muốn xem phòng chiều mai', kind: 'text' },
        ],
      }),
    )
    await settle()
    expect(result.current.available).toBe(false)
    expect(result.current.needsNotice).toBe(false)
    expect(translateCalls()).toHaveLength(0)
  })

  it('a message longer than one request may carry is never sent (the route would refuse it whole, every time)', async () => {
    vi.stubEnv('NEXT_PUBLIC_APP_REVIEW_GATES', '')
    as(DESKTOP)
    mount({ messages: [{ id: 'huge', mine: false, body: 'Tôi là giáo viên tiếng Anh. '.repeat(200), kind: 'text' }, MESSAGES[0]] })
    await waitFor(() => expect(translateCalls()).toHaveLength(1))
    expect(JSON.parse(String(translateCalls()[0][1].body)).messageIds).toEqual(['m1'])
  })
})

describe('nothing stored about the other side — one line is enough', () => {
  it('⛔ the owner\'s case: a support thread (no stored language) that opens with just "xin chao" shows the strip and asks', async () => {
    vi.stubEnv('NEXT_PUBLIC_APP_REVIEW_GATES', '')
    as(DESKTOP)
    const { result } = mount({ counterpartLang: null, messages: [{ id: 'x', mine: false, body: 'xin chao', kind: 'text' }] })
    await waitFor(() => expect(translateCalls()).toHaveLength(1))
    expect(result.current.showToggle).toBe(true)
  })

  it('a Vietnamese reader of a support desk that wrote just "good" sees it translated', async () => {
    vi.stubEnv('NEXT_PUBLIC_APP_REVIEW_GATES', '')
    as(DESKTOP)
    renderHook(() => useChatTranslation({ conversationId: CONVO, userId: ME, myLang: 'vi', counterpartLang: null,
      messages: [{ id: 'g', mine: false, body: 'good', kind: 'text' }, { id: 'h', mine: false, body: 'hi', kind: 'text' }] }))
    await waitFor(() => expect(translateCalls()).toHaveLength(1))
    expect(JSON.parse(String(translateCalls()[0][1].body)).messageIds).toEqual(['g'])
  })

  it('a message up to the route\'s own cap is still sent, alone', async () => {
    vi.stubEnv('NEXT_PUBLIC_APP_REVIEW_GATES', '')
    as(DESKTOP)
    const body = 'Tôi là giáo viên tiếng Anh. '.repeat(170).slice(0, 4_800)
    mount({ messages: [{ id: 'big', mine: false, body, kind: 'text' }] })
    await waitFor(() => expect(translateCalls()).toHaveLength(1))
    expect(JSON.parse(String(translateCalls()[0][1].body)).messageIds).toEqual(['big'])
  })
})

describe('French for an English reader, with nothing stored about the writer', () => {
  it('a support thread that opens in French is translated', async () => {
    vi.stubEnv('NEXT_PUBLIC_APP_REVIEW_GATES', '')
    as(DESKTOP)
    mount({ counterpartLang: null, messages: [{ id: 'f', mine: false, body: 'Bonjour, merci beaucoup', kind: 'text' }] })
    await waitFor(() => expect(translateCalls()).toHaveLength(1))
    expect(JSON.parse(String(translateCalls()[0][1].body)).messageIds).toEqual(['f'])
  })
})
