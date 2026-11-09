import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('@/lib/db', () => ({ db: {} }))
const { avatarData, validateAvatar } = await import('./avatar')
const { VOICES } = await import('./voices')

// A tutor's uploaded room (2026-11-09): the id's SHAPE here; its ownership is the tutors routes' (backgroundOfTeacher).
describe('a tutor\'s backgroundId on save', () => {
  const raw = (o: Record<string, unknown> = {}) => ({ name: 'Ms Anna', persona: '', greeting: '', voice: VOICES[0].id, look: 'photo', traits: {}, ...o })
  it('⛔ left out = LEFT AS IT IS: a client that never sends it never wipes the room (commit gate, opus)', () => {
    const v = validateAvatar(raw(), 'none')
    expect(v.ok && v.value.backgroundId).toBeUndefined()
    expect(v.ok && avatarData(v.value)).not.toHaveProperty('backgroundId')
  })
  it('null = back to the library room; an id is passed on for the route to check', () => {
    const none = validateAvatar(raw({ backgroundId: null }), 'none')
    expect(none.ok && avatarData(none.value)).toMatchObject({ backgroundId: null })
    const some = validateAvatar(raw({ backgroundId: 'b1' }), 'none')
    expect(some.ok && avatarData(some.value)).toMatchObject({ backgroundId: 'b1' })
  })
  it('anything else is refused', () => {
    for (const bad of [42, '', 'x'.repeat(65), {}]) expect(validateAvatar(raw({ backgroundId: bad }), 'none')).toMatchObject({ ok: false })
  })
})
