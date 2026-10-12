import { describe, expect, it } from 'vitest'
import { quickChatOpener, teacherOpener } from './first-message'

// The one-tap first message (owner, 2026-10-12): a teacher is hired, never asked whether "this" is still available —
// from the profile's contact block and from every card, row and video-feed chat button that can face a teacher.
const en = (e: string) => e
const vi = (_e: string, v: string) => v

describe('quickChatOpener', () => {
  it('⛔ a teacher listing gets the hiring opener, never the product one', () => {
    expect(quickChatOpener('teacher', en)).toBe(teacherOpener(en))
    expect(quickChatOpener('teacher', en)).not.toMatch(/still available/i)
    expect(quickChatOpener('teacher', vi)).toContain('chúng tôi đang tuyển giáo viên')
  })

  it('anything else keeps the product opener', () => {
    for (const t of ['sell', 'rent', undefined, null]) expect(quickChatOpener(t, en)).toBe('Hi! Is this still available?')
  })
})

describe('teacherOpener', () => {
  it('hiring by default; the cover-lesson ask on request', () => {
    expect(teacherOpener(en)).toMatch(/^Hello, we are hiring a teacher/)
    expect(teacherOpener(en, 'cover')).toMatch(/cover teacher/)
  })
})
