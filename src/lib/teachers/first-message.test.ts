import { describe, expect, it } from 'vitest'
import { openerVoice, quickChatOpener, teacherOpener } from './first-message'

// The one-tap first message (owner, 2026-10-12): a teacher is hired, never asked whether "this" is still available —
// from the profile's contact block and from every card, row and video-feed chat button that can face a teacher. Since
// the DM ladder (owner, 2026-10-13) anyone may write, so the opener speaks in the writer's own voice: a business as the
// school, anyone else as a person.
const en = (e: string) => e
const vi = (_e: string, v: string) => v

describe('quickChatOpener', () => {
  it('⛔ a teacher listing gets the teacher opener, never the product one — in the voice it is given', () => {
    expect(quickChatOpener('teacher', en)).toBe(teacherOpener(en))
    expect(quickChatOpener('teacher', en)).not.toMatch(/still available/i)
    expect(quickChatOpener('teacher', vi, 'school')).toContain('chúng tôi đang tuyển giáo viên')
    expect(quickChatOpener('teacher', vi, 'person')).toContain('mình đang tìm giáo viên')
  })

  it('anything else keeps the product opener', () => {
    for (const t of ['sell', 'rent', undefined, null]) expect(quickChatOpener(t, en)).toBe('Hi! Is this still available?')
  })
})

describe('teacherOpener', () => {
  it('⛔ the PERSON\'s voice by default (gate review, 2026-10-13): a caller that forgets the voice never puts "we are hiring" in a person\'s mouth', () => {
    expect(teacherOpener(en)).toMatch(/^Hello, I am looking for a teacher/)
    expect(teacherOpener(en, 'cover')).toMatch(/^Hello, I am looking for a teacher/) // no person-voice cover ask
  })

  it('the school\'s voice when asked: hiring, and the cover-lesson ask', () => {
    expect(teacherOpener(en, 'hire', 'school')).toMatch(/^Hello, we are hiring a teacher/)
    expect(teacherOpener(en, 'cover', 'school')).toMatch(/cover teacher/)
  })

  it('openerVoice: a business account is the school; anyone else — or an account not known yet — a person', () => {
    expect(openerVoice('business')).toBe('school')
    for (const t of ['individual', null, undefined, '']) expect(openerVoice(t)).toBe('person')
  })
})
