// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

const calls = vi.hoisted(() => [] as { path: string; init?: { method?: string; body?: unknown } }[])
vi.mock('@/context/language-context', () => ({ useLanguage: () => ({ lang: 'en', tr: (en: string) => en }), Tr: ({ en }: { en: string }) => en }))
vi.mock('./api', () => ({
  api: vi.fn(async (path: string, init?: { method?: string; body?: unknown }) => {
    calls.push({ path, init })
    return { ok: true, data: { id: 'seat-9', seats: [{ id: 'seat-9', invite: { code: 'abcdefghjkmn' } }] } }
  }),
}))
vi.mock('./invite-share', () => ({ InviteShare: ({ code }: { code: string }) => <p>{code}</p> }))
const { SeatSheet } = await import('./seat-sheet')
afterEach(() => { cleanup(); calls.splice(0) })

const tutors = () => [{ id: 't1', name: 'Ms Anna' }, { id: 't2', name: 'Mr Ben' }]

// Several tutors per teacher (owner, 2026-11-09): the student's tutor is picked when the student is added.
describe('Add a student — the tutor', () => {
  it('the picked tutor is sent with the new seat', async () => {
    render(<SeatSheet open onOpenChange={() => {}} onSaved={() => {}} tutors={tutors()} />)
    fireEvent.change(screen.getByPlaceholderText('e.g. Minh — Grade 3'), { target: { value: 'Minh' } })
    fireEvent.click(screen.getByRole('button', { name: 'Mr Ben' }))
    fireEvent.click(screen.getByRole('button', { name: 'Create invite' }))
    await waitFor(() => expect(calls).toHaveLength(1))
    expect(calls[0].init?.body).toMatchObject({ seatName: 'Minh', tutorId: 't2' })
  })
  it('⛔ the class refreshing after the save (a new tutors array) never wipes the new seat\'s invite (commit gate, codex + opus)', async () => {
    const view = render(<SeatSheet open onOpenChange={() => {}} onSaved={() => {}} tutors={tutors()} />)
    fireEvent.change(screen.getByPlaceholderText('e.g. Minh — Grade 3'), { target: { value: 'Minh' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create invite' }))
    await screen.findByText('abcdefghjkmn')
    view.rerender(<SeatSheet open onOpenChange={() => {}} onSaved={() => {}} tutors={tutors()} />)
    expect(screen.getByText('abcdefghjkmn')).toBeTruthy()
  })
  it('one tutor: no picker, and no tutor sent (the server gives the seat the teacher\'s tutor)', async () => {
    render(<SeatSheet open onOpenChange={() => {}} onSaved={() => {}} tutors={[{ id: 't1', name: 'Ms Anna' }]} />)
    expect(screen.queryByRole('button', { name: 'Ms Anna' })).toBeNull()
    fireEvent.change(screen.getByPlaceholderText('e.g. Minh — Grade 3'), { target: { value: 'Minh' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create invite' }))
    await waitFor(() => expect(calls).toHaveLength(1))
    expect(calls[0].init?.body).not.toHaveProperty('tutorId')
  })
})
