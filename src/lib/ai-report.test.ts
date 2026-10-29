import { afterEach, describe, expect, it, vi } from 'vitest'
import { AI_REPORT_ANSWER_MAX, AI_REPORT_TIMEOUT_MS, aiReportMessage, sendAiReport } from '@/lib/ai-report'

// ── "Report" on an AI answer (Google Play, AI-Generated Content) → Feedback of kind 'ai' ────────────────

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('aiReportMessage — what Admin › Feedback shows', () => {
  it('where, why, the note, then the answer itself', () => {
    expect(aiReportMessage({ surface: 'assistant', reason: 'offensive', note: ' rude ', answer: ' You are stupid. ' }))
      .toBe('Reported in eno AI chat: offensive\n\nrude\n\nThe answer:\nYou are stupid.')
  })

  it("the voice guide's one-tap flag: no reason, no note", () => {
    expect(aiReportMessage({ surface: 'voice-guide', answer: 'Hi' })).toBe('Reported in the voice guide\n\nThe answer:\nHi')
  })

  it('never longer than the feedback route keeps (4,000), so the answer is never cut by it', () => {
    const m = aiReportMessage({ surface: 'assistant', reason: 'wrong', note: 'n'.repeat(5000), answer: 'a'.repeat(9000) })
    expect(m.length).toBeLessThanOrEqual(4000)
    expect(m.endsWith(`\n${'a'.repeat(AI_REPORT_ANSWER_MAX)}`)).toBe(true)
  })
})

describe('sendAiReport', () => {
  it('files Feedback of kind "ai" with the page, and says whether the server took it — never throws', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 })
    vi.stubGlobal('fetch', fetchMock)
    await expect(sendAiReport({ surface: 'assistant', reason: 'other', answer: 'x', url: 'https://eno.vn/messages/ai' })).resolves.toBe(true)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/feedback')
    expect((init as RequestInit).signal).toBeInstanceOf(AbortSignal)
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({
      kind: 'ai',
      message: 'Reported in eno AI chat: other\n\nThe answer:\nx',
      url: 'https://eno.vn/messages/ai',
    })
    fetchMock.mockResolvedValueOnce({ ok: false, status: 429 })
    await expect(sendAiReport({ surface: 'assistant', answer: 'x', url: '/' })).resolves.toBe(false)
    fetchMock.mockRejectedValueOnce(new TypeError('offline'))
    await expect(sendAiReport({ surface: 'assistant', answer: 'x', url: '/' })).resolves.toBe(false)
  })

  it('a report that stalls gives up after the timeout (false), so no control waits on it for good', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    vi.stubGlobal('fetch', vi.fn((_: string, init: RequestInit) => new Promise((_resolve, reject) => {
      init.signal!.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
    })))
    const sent = sendAiReport({ surface: 'voice-guide', answer: 'x', url: '/' })
    vi.advanceTimersByTime(AI_REPORT_TIMEOUT_MS)
    await expect(sent).resolves.toBe(false)
  })
})
