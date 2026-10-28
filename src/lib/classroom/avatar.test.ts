import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('@/lib/db', () => ({ db: {} }))

const { validateAvatar } = await import('./avatar')
const { VOICES } = await import('./voices')

/** What the teacher's wizard sends is what is saved: the room behind the avatar included (review, codex + opus). */
describe('validateAvatar — the background survives the save', () => {
  const raw = (traits: unknown) => ({ name: 'Alex', persona: '', greeting: '', voice: VOICES[0].id, look: 'photo', traits })
  it('a picked room is kept', () => {
    const r = validateAvatar(raw({ tone: 'warm', pace: 'natural', topics: ['food'], background: 'library' }), 'none')
    expect(r.ok && r.value.traits.background).toBe('library')
  })
  it('an unknown room, or none sent, is the classroom', () => {
    for (const background of ['../../x', 42, undefined]) {
      const r = validateAvatar(raw({ tone: 'warm', pace: 'natural', topics: [], background }), 'none')
      expect(r.ok && r.value.traits.background, String(background)).toBe('classroom')
    }
  })
})
