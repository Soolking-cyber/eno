// @vitest-environment jsdom
/**
 * The /teachers/edit cover card. After a stale-window refusal (409 cover_changed) the form re-reads the saved cover
 * itself and the card only SAYS so — no button, no state to strand (gate reviews, 2026-10-07).
 */
import React from 'react'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/context/language-context', () => ({ useLanguage: () => ({ lang: 'en', tr: (en: string) => en }) }))

import { CoverSummary } from './cover-summary'

afterEach(cleanup)

const base = { savedOpen: true, slots: 3, areas: 2, rateVnd: 300_000, confirmedAt: '2026-10-07', dirty: false, status: '' as const, onConfirm: () => {}, onEdit: () => {} }

describe('CoverSummary', () => {
  it('offers "Still available" and "Change" while cover is on', () => {
    render(<CoverSummary {...base} />)
    expect(screen.getByRole('button', { name: /still available/i })).toBeTruthy()
    expect(screen.getByRole('button', { name: /change/i })).toBeTruthy()
  })
  it('shows the stale-window notice with cover on — and with cover off, never a dead end', () => {
    const notice = 'Your cover lessons were changed in another window.'
    render(<CoverSummary {...base} notice={notice} />)
    expect(screen.getAllByRole('status').some((n) => n.textContent === notice)).toBe(true)
    cleanup()
    render(<CoverSummary {...base} savedOpen={false} notice={notice} />)
    expect(screen.getByRole('status').textContent).toBe(notice)
    expect(screen.getByRole('button', { name: /set up cover lessons/i })).toBeTruthy()
  })
  // ⛔ Saved is not shown (gate review, 2026-10-09): a save that left the profile hidden says so, with the way back.
  it('saved over a HIDDEN profile: says schools can’t see the cover, and "Show my profile to schools" is right there', () => {
    const onShow = vi.fn()
    render(<CoverSummary {...base} status="saved" hidden={{ onShow, showing: false }} />)
    expect(screen.getByText('Your profile is hidden, so schools can’t see your cover lessons.')).toBeTruthy()
    screen.getByRole('button', { name: 'Show my profile to schools' }).click()
    expect(onShow).toHaveBeenCalledTimes(1)
  })
  it('held by moderation (the teacher’s switch already on): said, with no button no tap of theirs can make work', () => {
    render(<CoverSummary {...base} status="saved" hidden={{ onShow: null, showing: false }} />)
    expect(screen.getByText(/Your profile is under review and not visible right now/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Show my profile to schools' })).toBeNull()
  })
  it('shown: nothing about hidden', () => {
    render(<CoverSummary {...base} status="saved" />)
    expect(screen.queryByText(/Your profile is/)).toBeNull()
  })
})
