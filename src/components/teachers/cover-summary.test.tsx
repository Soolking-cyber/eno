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
})
