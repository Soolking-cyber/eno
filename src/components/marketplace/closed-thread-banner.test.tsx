// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { LanguageProvider } from '@/context/language-context'
import { ClosedThreadBanner } from './closed-thread-banner'

// ── <ClosedThreadBanner> — the composer's stand-in on a thread closed by a block (gate `ugc-safety`) ──

afterEach(cleanup)

function mount(closed: 'you_blocked' | 'blocked', lang: 'en' | 'vi' = 'en') {
  return render(
    <LanguageProvider initialLang={lang} initialViDict={{}}>
      <ClosedThreadBanner closed={closed} />
    </LanguageProvider>,
  )
}

describe('ClosedThreadBanner', () => {
  it('the blocker is told the thread is shut both ways and given the way back to Settings › Privacy', () => {
    mount('you_blocked')
    expect(screen.getByRole('status').textContent).toMatch(/neither of you can send messages or offers/)
    expect(screen.getByRole('link', { name: 'Manage blocked users' }).getAttribute('href')).toBe('/dashboard/settings?tab=privacy')
  })

  it('the other side learns only that the conversation is closed — no link, pointed at Report', () => {
    mount('blocked')
    expect(screen.getByRole('status').textContent).toBe('This conversation is closed. You can’t send messages or offers here. If something is wrong, use Report.')
    expect(screen.queryByRole('link')).toBeNull()
  })

  it('speaks Vietnamese in a Vietnamese thread', () => {
    mount('blocked', 'vi')
    expect(screen.getByRole('status').textContent).toMatch(/^Cuộc trò chuyện này đã đóng\./)
  })
})
