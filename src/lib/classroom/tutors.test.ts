import { beforeEach, describe, expect, it, vi } from 'vitest'

// Several tutors per teacher (owner, 2026-11-09: "teachers assign and manage ai tutor for each of their students").
const h = vi.hoisted(() => {
  const tx = {
    $executeRaw: vi.fn(async () => 1),
    classroomAvatar: { count: vi.fn(), create: vi.fn(), findFirst: vi.fn(), update: vi.fn() },
    classroomEnrollment: { count: vi.fn() },
    classroomSession: { groupBy: vi.fn() },
  }
  return {
    tx,
    db: {
      $transaction: vi.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)),
      classroomAvatar: { findFirst: vi.fn(), findMany: vi.fn(), updateMany: vi.fn(), findUniqueOrThrow: vi.fn() },
    },
  }
})
vi.mock('server-only', () => ({}))
vi.mock('@/lib/db', () => ({ db: h.db }))

const { archiveTutor, createTutor, teacherLock, tutorOfTeacher, updateTutor } = await import('./tutors')
const { validateAvatar } = await import('./avatar')
const { LIMITS } = await import('./constants')
const { VOICES } = await import('./voices')

const input = () => {
  const v = validateAvatar({ name: 'Ms Anna', bestFor: 'Shy beginners', persona: '', greeting: '', voice: VOICES[0].id, look: 'photo', traits: {} }, 'none')
  if (!v.ok) throw new Error(v.code)
  return v.value
}
const lockSql = () => (h.tx.$executeRaw.mock.calls as unknown as [TemplateStringsArray, ...unknown[]][]).map((c) => c.slice(1).join(','))

beforeEach(() => { vi.clearAllMocks() })

describe('making a tutor', () => {
  it('counts the teacher\'s tutors under the teacher\'s lock and refuses past the cap', async () => {
    h.tx.classroomAvatar.count.mockResolvedValue(LIMITS.tutorsPerTeacher)
    await expect(createTutor('tp1', input())).rejects.toMatchObject({ code: 'tutor_limit', status: 409 })
    expect(lockSql()).toEqual([teacherLock('tp1')])
    expect(h.tx.classroomAvatar.count).toHaveBeenCalledWith({ where: { teacherProfileId: 'tp1', archivedAt: null } })
    expect(h.tx.classroomAvatar.create).not.toHaveBeenCalled()
  })
  it('under the cap it is made for that teacher, with its "best for" line', async () => {
    h.tx.classroomAvatar.count.mockResolvedValue(LIMITS.tutorsPerTeacher - 1)
    h.tx.classroomAvatar.create.mockResolvedValue({ id: 't9' })
    await createTutor('tp1', input())
    expect(h.tx.classroomAvatar.create.mock.calls[0][0].data).toMatchObject({ teacherProfileId: 'tp1', name: 'Ms Anna', bestFor: 'Shy beginners' })
  })
})

describe('a tutor is always looked up through its teacher', () => {
  it('a missing, odd or too-long id never reaches the database', async () => {
    for (const id of [undefined, 42, '', 'x'.repeat(65)]) expect(await tutorOfTeacher(id, 'tp1')).toBeNull()
    expect(h.db.classroomAvatar.findFirst).not.toHaveBeenCalled()
  })
  it('the lookup names the teacher and leaves archived tutors out', async () => {
    await tutorOfTeacher('t1', 'tp1')
    expect(h.db.classroomAvatar.findFirst).toHaveBeenCalledWith({ where: { id: 't1', teacherProfileId: 'tp1', archivedAt: null } })
  })
  it('a save writes only the teacher\'s own tutor that is not archived; anything else is "not found"', async () => {
    h.db.classroomAvatar.updateMany.mockResolvedValue({ count: 0 })
    await expect(updateTutor('tp1', 't-of-someone-else', input())).rejects.toMatchObject({ code: 'tutor_not_found', status: 404 })
    expect(h.db.classroomAvatar.updateMany.mock.calls[0][0].where).toEqual({ id: 't-of-someone-else', teacherProfileId: 'tp1', archivedAt: null })
  })
})

describe('archiving a tutor (never deleting: its seats would cascade)', () => {
  it('is refused while a student still has it', async () => {
    h.tx.classroomAvatar.findFirst.mockResolvedValue({ id: 't1', customStatus: 'none' })
    h.tx.classroomEnrollment.count.mockResolvedValue(2)
    await expect(archiveTutor('tp1', 't1')).rejects.toMatchObject({ code: 'tutor_has_students', status: 409 })
    expect(h.tx.classroomEnrollment.count).toHaveBeenCalledWith({ where: { avatarId: 't1', status: { not: 'removed' } } })
    expect(h.tx.classroomAvatar.update).not.toHaveBeenCalled()
  })
  it('is refused while it holds the teacher\'s own face (withdraw it first — that queues its deletion)', async () => {
    for (const customStatus of ['requested', 'ready']) {
      h.tx.classroomAvatar.findFirst.mockResolvedValue({ id: 't1', customStatus })
      await expect(archiveTutor('tp1', 't1')).rejects.toMatchObject({ code: 'tutor_has_likeness' })
    }
    expect(h.tx.classroomAvatar.update).not.toHaveBeenCalled()
  })
  it('another teacher\'s tutor, or one already archived, is "not found"', async () => {
    h.tx.classroomAvatar.findFirst.mockResolvedValue(null)
    await expect(archiveTutor('tp1', 't1')).rejects.toMatchObject({ code: 'tutor_not_found', status: 404 })
    expect(h.tx.classroomAvatar.findFirst.mock.calls[0][0].where).toEqual({ id: 't1', teacherProfileId: 'tp1', archivedAt: null })
  })
  it('with no students it is archived — under the same lock a seat move takes', async () => {
    h.tx.classroomAvatar.findFirst.mockResolvedValue({ id: 't1', customStatus: 'removed' })
    h.tx.classroomEnrollment.count.mockResolvedValue(0)
    await archiveTutor('tp1', 't1')
    expect(lockSql()).toEqual([teacherLock('tp1')])
    expect(h.tx.classroomAvatar.update.mock.calls[0][0]).toMatchObject({ where: { id: 't1' }, data: { archivedAt: expect.any(Date) } })
  })
})
