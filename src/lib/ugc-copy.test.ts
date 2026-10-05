import { describe, expect, it } from 'vitest'
import { OBJECTIONABLE_CONTENT, composerFreeForRefused, objectionableCopy } from './ugc-copy'

// ── the refusal sentence the UGC filter's 400 turns into (ugc-safety, plan R5) ────────────────────────

describe('objectionableCopy', () => {
  const en = (e: string) => e
  const vi = (_e: string, v: string) => v
  it('matches the wire code and says what was refused on each surface, in both languages', () => {
    expect(OBJECTIONABLE_CONTENT).toBe('objectionable_content')
    expect(objectionableCopy('message', en)).toMatch(/^Your message wasn’t sent/)
    expect(objectionableCopy('review', en)).toMatch(/^Your review wasn’t posted/)
    expect(objectionableCopy('reply', en)).toMatch(/^Your reply wasn’t posted/)
    expect(objectionableCopy('message', vi)).toMatch(/^Tin nhắn chưa được gửi/)
    expect(objectionableCopy('review', vi)).toMatch(/^Đánh giá chưa được đăng/)
    expect(objectionableCopy('reply', vi)).toMatch(/^Phản hồi chưa được đăng/)
  })

  it('names the kind of language — all four categories the filter refuses — never a word from the list', () => {
    for (const s of ['message', 'review', 'reply'] as const) {
      expect(objectionableCopy(s, en)).toContain('slurs, threats of violence, sexual solicitation or sexual content involving minors')
      expect(objectionableCopy(s, vi)).toContain('miệt thị, đe dọa bạo lực, gạ gẫm tình dục hoặc nội dung tình dục liên quan đến trẻ em')
    }
  })
})

describe('composerFreeForRefused — when a refused message may come back into the composer', () => {
  it('an empty composer with no other reply armed: yes, with its own quote or none', () => {
    expect(composerFreeForRefused('', null, 'm-q1')).toBe(true)
    expect(composerFreeForRefused('  ', undefined, undefined)).toBe(true)
    expect(composerFreeForRefused('', 'm-q1', 'm-q1')).toBe(true) // the same quote is still armed
  })

  it('something typed since: no — the refused message stays as a failed bubble', () => {
    expect(composerFreeForRefused('new words', null, 'm-q1')).toBe(false)
  })

  it('⛔ ANOTHER reply armed since, nothing typed: no — restoring would send it as a reply to the wrong message (gate round 10)', () => {
    expect(composerFreeForRefused('', 'm-q2', 'm-q1')).toBe(false)
    expect(composerFreeForRefused('', 'm-q2', undefined)).toBe(false) // the refused one was no reply at all
  })
})
