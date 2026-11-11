// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'

const answer = vi.hoisted(() => ({ next: null as null | (() => unknown) }))
vi.mock('@/context/language-context', () => ({ useLanguage: () => ({ lang: 'en', tr: (en: string) => en }), Tr: ({ en }: { en: string }) => en }))
vi.mock('./api', () => ({ api: vi.fn(async () => (answer.next ? answer.next() : new Promise(() => {}))) }))
const { ReportView } = await import('./report-view')
afterEach(() => { cleanup(); answer.next = null })

const report = (over: Record<string, unknown> = {}) => ({
  id: 's1', startedAt: '2026-11-11T03:00:00.000Z', endedAt: '2026-11-11T03:10:00.000Z', status: 'ended', feedbackStatus: 'pending', talkSeconds: 248,
  teacher: { name: 'Emma Clarke', photoUrl: null, avatarName: 'Ms Nora' }, learner: { name: 'Gia Huy', seatId: 'seat-1' },
  feedback: null, transcript: [], heardAs: [], previous: null, celebrate: { done: 2, of: 3, streak: 3 }, ...over,
})
const home = () => screen.getByRole('link', { name: 'Back' })

// ⛔ A report page has no classroom bar (gap 10): the arrow home is there in every state (commit review round 2, opus).
describe('the report — a way back in every state', () => {
  it('while it loads', () => {
    render(<ReportView sessionId="s1" />)
    expect(home().getAttribute('href')).toBe('/classroom')
  })
  it('when it cannot load', async () => {
    answer.next = () => ({ ok: false, status: 404, error: 'session_not_found', body: {} })
    render(<ReportView sessionId="s1" />)
    await screen.findByRole('button', { name: 'Try again' })
    expect(home().getAttribute('href')).toBe('/classroom')
  })
})

// Gap 4: the celebration after a lesson — asked for by the URL, granted by the server, and only on the family's side.
describe('the celebration', () => {
  it('shows for the family right after the lesson the server granted it for', async () => {
    answer.next = () => ({ ok: true, data: { viewer: 'learner', report: report() } })
    render(<ReportView sessionId="s1" justEnded />)
    expect(await screen.findByText('Well done!')).toBeTruthy()
    expect(screen.getByText('3 weeks in a row', { exact: false })).toBeTruthy()
  })
  it('never without the lesson asking, never when the server says no, never on the teacher\'s side', async () => {
    answer.next = () => ({ ok: true, data: { viewer: 'learner', report: report() } })
    const a = render(<ReportView sessionId="s1" />)
    await screen.findByText('Session report')
    expect(screen.queryByText('Well done!')).toBeNull()
    a.unmount()
    answer.next = () => ({ ok: true, data: { viewer: 'learner', report: report({ celebrate: null }) } })
    const b = render(<ReportView sessionId="s1" justEnded />)
    await screen.findByText('Session report')
    expect(screen.queryByText('Well done!')).toBeNull()
    b.unmount()
    answer.next = () => ({ ok: true, data: { viewer: 'teacher', report: report() } })
    render(<ReportView sessionId="s1" justEnded />)
    await screen.findByText('Session report')
    expect(screen.queryByText('Well done!')).toBeNull()
  })
})

describe('the celebration stays with its own report (commit review, codex + opus)', () => {
  it('given another session, the view lets go of the grant AT ONCE — before the new report has even answered', async () => {
    answer.next = () => ({ ok: true, data: { viewer: 'learner', report: report() } })
    const view = render(<ReportView sessionId="s1" justEnded />)
    expect(await screen.findByText('Well done!')).toBeTruthy()
    // s2 never answers: s1's report is still the one on screen, so only the reset on the new id can take the card away
    // (the id check alone would keep it — s1's grant matches s1's report).
    answer.next = () => new Promise(() => {})
    view.rerender(<ReportView sessionId="s2" justEnded />)
    await waitFor(() => expect(screen.queryByText('Well done!')).toBeNull())
    // …and back to s1, which now grants nothing (its 15 minutes are over): no grant from before comes back. Waited for on
    // something only that NEW answer carries (commit review, codex + opus: the old s1 report was still on screen).
    answer.next = () => ({ ok: true, data: { viewer: 'learner', report: report({ celebrate: null, learner: { name: 'Gia Huy, later', seatId: 'seat-1' } }) } })
    view.rerender(<ReportView sessionId="s1" justEnded />)
    await screen.findByText('Gia Huy, later', { exact: false })
    expect(screen.queryByText('Well done!')).toBeNull()
  })
})

describe('the scale', () => {
  const scored = (pronunciation: number | null, previous: number | null) => report({
    feedbackStatus: 'ready', celebrate: null, previous: { pronunciation: previous, fluency: null },
    feedback: { summary: '', summaryVi: '', wins: [], mistakes: [], pronunciation: [], vocabulary: {}, scores: { pronunciation, fluency: null, grammarFixes: 2, talkSeconds: 248 } },
  })
  it('a change of 3 or more is said; a smaller one is noise and is not', async () => {
    answer.next = () => ({ ok: true, data: { viewer: 'learner', report: scored(78, 72) } })
    const a = render(<ReportView sessionId="s1" />)
    expect(await screen.findByText('since last time', { exact: false })).toBeTruthy()
    expect(screen.getByText('+6', { exact: false })).toBeTruthy()
    a.unmount()
    answer.next = () => ({ ok: true, data: { viewer: 'learner', report: scored(78, 76) } })
    render(<ReportView sessionId="s1" />)
    await screen.findByText('Session report')
    expect(screen.queryByText('since last time', { exact: false })).toBeNull()
  })
  it('⛔ both ends on the 0–100 scale: an out-of-range earlier score never inflates the change', async () => {
    answer.next = () => ({ ok: true, data: { viewer: 'learner', report: scored(96, 140) } })
    render(<ReportView sessionId="s1" />)
    expect(await screen.findByText('since last time', { exact: false })).toBeTruthy()
    expect(screen.getByText('−4', { exact: false })).toBeTruthy() // 96 − 100, not 96 − 140
  })
})

