// @vitest-environment jsdom
import * as React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

/**
 * <SaleQuestions> — the buyer's "did you buy this?" in their thread with the seller, wired to the server.
 * The prompt's own rules (copy, the one-way answer lock, the live region) are pinned in
 * sale-confirm-prompt.test.tsx; THIS file pins the wiring: what it asks the server, what ONE tap sends,
 * and that every server answer lands as the right card — in English and in Vietnamese.
 *
 * ⚠️ EXPLICIT `cleanup` — no vitest globals, so Testing Library registers no afterEach of its own.
 */

const toasts = vi.hoisted(() => ({ error: [] as string[] }))
vi.mock('sonner', () => ({ toast: { error: (m: string) => { toasts.error.push(m) }, success: () => {} } }))
// A stable identity per language (the real provider's is stable too): a fresh tr() per render would
// re-run effects that list it.
const langs = vi.hoisted(() => ({
  en: { lang: 'en', tr: (en: string) => en, t: (k: string) => k, setLang: () => {} },
  vi: { lang: 'vi', tr: (_en: string, vi: string) => vi, t: (k: string) => k, setLang: () => {} },
  current: 'en' as 'en' | 'vi',
}))
vi.mock('@/context/language-context', () => ({ useLanguage: () => langs[langs.current], useTr: () => langs[langs.current].tr }))

import { SaleQuestions } from './sale-questions'

type Reply = { status: number; body: unknown }
const Q = { saleId: 'L1:1000', listingId: 'L1', title: 'Honda Vision 2021', price: 11_200_000, currency: '₫' }

let questionReplies: Reply[] = []
let answerReplies: (Reply | 'hold')[] = []
let held: ((r: Reply) => void) | null = null
let calls: { url: string; method: string; body?: unknown }[] = []

beforeEach(() => {
  langs.current = 'en'
  toasts.error.length = 0
  calls = []
  held = null
  questionReplies = [{ status: 200, body: { questions: [Q] } }]
  answerReplies = [{ status: 200, body: { ok: true, status: 'confirmed' } }]
  vi.stubGlobal('fetch', vi.fn((input: string, init?: RequestInit) => {
    const url = String(input)
    const method = init?.method ?? 'GET'
    calls.push({ url, method, body: init?.body ? JSON.parse(String(init.body)) : undefined })
    const json = (r: Reply) => ({ ok: r.status >= 200 && r.status < 300, status: r.status, json: () => Promise.resolve(r.body) }) as Response
    if (url === '/api/conversations/c1/sale-question') {
      const r = questionReplies.length > 1 ? questionReplies.shift()! : questionReplies[0]
      return Promise.resolve(json(r))
    }
    if (url === '/api/listings/L1/sale-confirmation' && method === 'POST') {
      const r = answerReplies.length > 1 ? answerReplies.shift()! : answerReplies[0]
      if (r === 'hold') return new Promise<Response>((resolve) => { held = (x) => resolve(json(x)) })
      return Promise.resolve(json(r))
    }
    return Promise.resolve(json({ status: 404, body: {} }))
  }))
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 0)) })
async function mount(props: Partial<React.ComponentProps<typeof SaleQuestions>> = {}) {
  const onStateChange = vi.fn()
  const view = render(<SaleQuestions conversationId="c1" sellerName="Minh" onStateChange={onStateChange} {...props} />)
  await settle()
  return { ...view, onStateChange }
}
const answers = () => calls.filter((c) => c.url.endsWith('/sale-confirmation'))

describe('what it asks the server, and what it shows', () => {
  it('asks for THIS thread\'s questions and shows the seller\'s one, Yes / No', async () => {
    const { onStateChange } = await mount()
    expect(calls).toEqual([{ url: '/api/conversations/c1/sale-question', method: 'GET', body: undefined }])
    expect(screen.getByRole('group').textContent).toContain('Minh says you bought Honda Vision 2021 for 11,200,000 đ.')
    expect(screen.getAllByRole('button').map((b) => b.textContent)).toEqual(['Yes, I bought it', 'No, I did not'])
    // 'unknown' while the lookup was out, then 'open': the page holds its own review card back throughout.
    expect(onStateChange.mock.calls.map((c) => c[0])).toEqual(['unknown', 'open'])
  })

  it('nothing asked → nothing rendered, and the page is told it is KNOWN to be none', async () => {
    questionReplies = [{ status: 200, body: { questions: [] } }]
    const { container, onStateChange } = await mount()
    expect(container.textContent).toBe('')
    expect(onStateChange.mock.calls.map((c) => c[0])).toEqual(['unknown', 'none'])
  })

  it('⛔ a FAILED lookup is never "none" — the state stays unknown, so the page keeps its review card back', async () => {
    questionReplies = [{ status: 500, body: { error: 'internal_error' } }]
    const { container, onStateChange } = await mount()
    expect(container.textContent).toBe('')
    expect(onStateChange.mock.calls.map((c) => c[0])).toEqual(['unknown'])
  })

  it('⛔ a REFRESH starts unknown again — an earlier "none" never outlives a lookup that then fails (gate, 2026-10-05)', async () => {
    questionReplies = [{ status: 200, body: { questions: [] } }, { status: 500, body: { error: 'internal_error' } }]
    const onStateChange = vi.fn()
    const view = render(<SaleQuestions conversationId="c1" sellerName="Minh" refreshKey="a" onStateChange={onStateChange} />)
    await settle()
    expect(onStateChange).toHaveBeenLastCalledWith('none')
    view.rerender(<SaleQuestions conversationId="c1" sellerName="Minh" refreshKey="b" onStateChange={onStateChange} />)
    await settle()
    expect(onStateChange).toHaveBeenLastCalledWith('unknown')
  })

  it('…and a lookup that throws (offline) is the same', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new TypeError('Failed to fetch'))))
    const { onStateChange } = await mount()
    expect(onStateChange).toHaveBeenLastCalledWith('unknown')
  })
})

describe('ONE TAP answers', () => {
  it('"Yes, I bought it" → one POST with the answer AND the price shown → the confirmed card, no buttons left', async () => {
    const user = userEvent.setup()
    const { onStateChange } = await mount()
    await user.click(screen.getByRole('button', { name: 'Yes, I bought it' }))
    await settle()
    expect(answers()).toEqual([{ url: '/api/listings/L1/sale-confirmation', method: 'POST', body: { answer: 'confirm', price: 11_200_000 } }])
    expect(screen.getByText('Confirmed — this deal is now on record for both of you.')).toBeTruthy()
    expect(screen.queryAllByRole('button')).toHaveLength(0)
    // Both sides have spoken: nothing is open any more.
    expect(onStateChange).toHaveBeenLastCalledWith('none')
  })

  it('"No, I did not" → one POST → the declined card: accuses nobody, will not ask again, no buttons', async () => {
    const user = userEvent.setup()
    answerReplies = [{ status: 200, body: { ok: true, status: 'declined' } }]
    await mount()
    await user.click(screen.getByRole('button', { name: 'No, I did not' }))
    await settle()
    expect(answers().map((c) => c.body)).toEqual([{ answer: 'decline', price: 11_200_000 }])
    expect(screen.getByText('Noted. Nobody was reported, and we will not ask about this one again.')).toBeTruthy()
    expect(screen.queryAllByRole('button')).toHaveLength(0)
  })

  it('both buttons lock the moment the tap lands — a fumbled double tap sends ONE answer, never Yes AND No', async () => {
    const user = userEvent.setup()
    answerReplies = ['hold']
    await mount()
    await user.click(screen.getByRole('button', { name: 'Yes, I bought it' }))
    for (const b of screen.getAllByRole('button')) expect((b as HTMLButtonElement).disabled).toBe(true)
    await user.click(screen.getByRole('button', { name: 'No, I did not' }))
    expect(answers()).toHaveLength(1)
    await act(async () => { held!({ status: 200, body: { ok: true, status: 'confirmed' } }) })
    await settle()
    expect(screen.getByText('Confirmed — this deal is now on record for both of you.')).toBeTruthy()
  })

  it('a failure is SAID on the card, which re-arms — and the retry starts with the message cleared', async () => {
    const user = userEvent.setup()
    answerReplies = [{ status: 500, body: { error: 'internal_error' } }, 'hold']
    await mount()
    await user.click(screen.getByRole('button', { name: 'Yes, I bought it' }))
    await settle()
    expect(screen.getByRole('alert').textContent).toBe('Could not send your answer — please try again.')
    expect((screen.getByRole('button', { name: 'Yes, I bought it' }) as HTMLButtonElement).disabled).toBe(false)
    await user.click(screen.getByRole('button', { name: 'Yes, I bought it' }))
    expect(screen.queryByRole('alert')).toBeNull()
    expect(answers()).toHaveLength(2)
  })

  it('already answered elsewhere (409 already_resolved) → shows what IS on record, never asks again', async () => {
    const user = userEvent.setup()
    answerReplies = [{ status: 409, body: { error: 'already_resolved', status: 'declined' } }]
    await mount()
    await user.click(screen.getByRole('button', { name: 'Yes, I bought it' }))
    await settle()
    expect(screen.getByText('Noted. Nobody was reported, and we will not ask about this one again.')).toBeTruthy()
    expect(screen.queryAllByRole('button')).toHaveLength(0)
  })

  it('⛔ the seller changed the price (409 not_actionable) → says so, fetches the question again, shows the NEW price', async () => {
    const user = userEvent.setup()
    questionReplies = [{ status: 200, body: { questions: [Q] } }, { status: 200, body: { questions: [{ ...Q, price: 10_500_000 }] } }]
    answerReplies = [{ status: 409, body: { error: 'not_actionable' } }]
    await mount()
    await user.click(screen.getByRole('button', { name: 'Yes, I bought it' }))
    await settle()
    expect(calls.filter((c) => c.url.endsWith('/sale-question'))).toHaveLength(2)
    expect(screen.getByRole('group').textContent).toContain('10,500,000 đ')
    expect(screen.getByRole('alert').textContent).toBe('This changed since you opened it — check it again.')
    expect((screen.getByRole('button', { name: 'Yes, I bought it' }) as HTMLButtonElement).disabled).toBe(false)
  })

  it('no longer theirs to answer (403 — re-attributed, relisted) → the card goes, and a toast says why', async () => {
    const user = userEvent.setup()
    answerReplies = [{ status: 403, body: { error: 'forbidden' } }]
    const { container } = await mount()
    await user.click(screen.getByRole('button', { name: 'Yes, I bought it' }))
    await settle()
    expect(container.textContent).toBe('')
    expect(toasts.error).toEqual(['This question is no longer open.'])
  })

  it('a settled card STAYS when a refetch no longer lists the question — its acknowledgement is the proof the tap landed', async () => {
    const user = userEvent.setup()
    questionReplies = [{ status: 200, body: { questions: [Q] } }, { status: 200, body: { questions: [] } }]
    const view = await mount({ refreshKey: 'a' })
    await user.click(screen.getByRole('button', { name: 'Yes, I bought it' }))
    await settle()
    view.rerender(<SaleQuestions conversationId="c1" sellerName="Minh" refreshKey="b" />)
    await settle()
    expect(calls.filter((c) => c.url.endsWith('/sale-question'))).toHaveLength(2)
    expect(screen.getByText('Confirmed — this deal is now on record for both of you.')).toBeTruthy()
  })
})

describe('in Vietnamese', () => {
  it('the question, the đồng amount with DOT thousands, the reason and both answers — and one tap still sends it', async () => {
    langs.current = 'vi'
    const user = userEvent.setup()
    await mount()
    expect(screen.getByRole('group').textContent).toContain('Minh nói bạn đã mua Honda Vision 2021 với giá 11.200.000 đ.')
    expect(screen.getByText('Xác nhận để giao dịch được ghi nhận cho cả hai bên.')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Đúng, tôi đã mua' }))
    await settle()
    expect(answers().map((c) => c.body)).toEqual([{ answer: 'confirm', price: 11_200_000 }])
    expect(screen.getByText('Đã xác nhận — giao dịch này đã được ghi nhận cho cả hai bên.')).toBeTruthy()
  })

  it('a failure is said in Vietnamese too', async () => {
    langs.current = 'vi'
    const user = userEvent.setup()
    answerReplies = [{ status: 500, body: {} }]
    await mount()
    await user.click(screen.getByRole('button', { name: 'Không, tôi không mua' }))
    await settle()
    expect(screen.getByRole('alert').textContent).toBe('Chưa gửi được câu trả lời — vui lòng thử lại.')
  })
})
