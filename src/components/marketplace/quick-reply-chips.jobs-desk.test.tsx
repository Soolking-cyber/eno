// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render } from '@testing-library/react'

/**
 * THE JOBS DESK'S TWO REPLIES, TAPPED (teacher job DMs, 2026-10-20): each chip SENDS its fixed words on one tap — the
 * words the server reads (src/lib/teachers/job-dms/replies.ts) — and only those; it never fills the composer.
 */

let LANG = 'en'
vi.mock('@/context/language-context', () => ({
  useLanguage: () => ({ lang: LANG, tr: (en: string, vi?: string) => (LANG === 'vi' && vi != null ? vi : LANG === 'en' ? en : `[${LANG}] ${en}`) }),
}))
vi.mock('@/lib/haptics', () => ({ haptic: () => {} }))

import { JobsDeskReplyChips } from './quick-reply-chips'

afterEach(cleanup)

describe('JobsDeskReplyChips — one tap sends', () => {
  it.each([
    ['en', 'Keep sending jobs', 'Keep sending jobs'],
    ['en', 'Stop job messages', 'Stop job messages'],
    ['vi', 'Gửi tiếp việc làm', 'Gửi tiếp việc làm'],
    ['vi', 'Dừng tin nhắn việc làm', 'Dừng tin nhắn việc làm'],
    // An MT language: a translated label, the English words sent.
    ['ko', '[ko] Stop job messages', 'Stop job messages'],
  ])('%s: tapping "%s" sends "%s"', (lang, label, sent) => {
    LANG = lang
    const onSend = vi.fn()
    const { getByRole } = render(<JobsDeskReplyChips onSend={onSend} />)
    fireEvent.click(getByRole('button', { name: label }))
    expect(onSend).toHaveBeenCalledTimes(1)
    expect(onSend).toHaveBeenCalledWith(sent)
  })
})
