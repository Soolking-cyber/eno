// @vitest-environment node
import { randomUUID } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

/**
 * scripts/classroom-ddl.mjs AGAINST A REAL POSTGRES — what source-text tests cannot show (round 9, opus): the shape check,
 * the likeness trigger (an id given out at most once, the per-id lock, the 'request:' markers) and the erasure cascade
 * into the deletion queue. No application code: only the database this script builds.
 *
 * ⛔ OPT-IN, AND ONLY ON A THROWAWAY DATABASE — flows.pg.test.ts's rule and setup: CLASSROOM_PG_TESTS=1, a loopback host,
 * never port 5433 (this repo's SSH tunnel to production), a database NAME ending in `_it`, checked again with
 * current_database() before the first write.
 */
const url = process.env.DATABASE_URL || ''
const parsed = (() => { try { return new URL(url) } catch { return null } })()
const loopback = ['127.0.0.1', 'localhost', '::1'].includes(parsed?.hostname ?? '')
const live = process.env.CLASSROOM_PG_TESTS === '1' && loopback && parsed?.port !== '5433' && /_it$/.test(parsed?.pathname ?? '')

describe.skipIf(!live)('the classroom DDL against a real Postgres', () => {
  let db: typeof import('@/lib/db').db
  const owners: string[] = []

  /** A teacher (Profile + TeacherProfile) and their avatar — the rows the trigger sits on. */
  const teacherWithAvatar = async (avatar: Record<string, unknown> = {}) => {
    const profileId = randomUUID()
    owners.push(profileId)
    await db.profile.create({ data: { id: profileId, email: `${profileId}@example.test`, accountType: 'individual' } })
    const tp = await db.teacherProfile.create({ data: { profileId, fullName: 'Test Teacher', headline: 'Teacher', nationality: 'GB', currentCity: 'hcmc', consentPublicAt: new Date(), updatedAt: new Date() } })
    const a = await db.classroomAvatar.create({ data: { teacherProfileId: tp.id, name: 'Avatar', voice: 'en-GB-SoniaNeural', ...avatar } })
    return { profileId, avatarId: a.id }
  }
  const queued = async (ids: string[]) => db.$queryRaw<{ id: string; reason: string; done: boolean }[]>`
    SELECT spatius_avatar_id AS id, reason, done_at IS NOT NULL AS done FROM public.classroom_likeness_deletion
     WHERE spatius_avatar_id = ANY(${ids}::text[]) ORDER BY spatius_avatar_id`

  beforeAll(async () => {
    db = (await import('@/lib/db')).db
    const [{ name }] = await db.$queryRaw<{ name: string }[]>`SELECT current_database() AS name`
    if (!/_it$/.test(name)) throw new Error(`refusing to write to ${name}`)
  }, 120_000)

  afterAll(async () => {
    await db.profile.deleteMany({ where: { id: { in: owners } } })
    await db.$executeRaw`DELETE FROM public.classroom_likeness_deletion WHERE spatius_avatar_id LIKE 'sp-ddl-%' OR spatius_avatar_id LIKE 'request:%'`
  })

  it('⛔ --check passes on this database, and names a CHECK whose body drifted (the "IF NOT EXISTS" trap)', async () => {
    const run = () => spawnSync(process.execPath, [join(__dirname, '../../../scripts/classroom-ddl.mjs'), '--check'], { env: { ...process.env, DIRECT_URL: url }, encoding: 'utf8' })
    expect(run().status).toBe(0)
    await db.$executeRawUnsafe(`alter table "ClassroomSession" drop constraint "ClassroomSession_mode_check", add constraint "ClassroomSession_mode_check" check ("mode" in ('avatar', 'voice', 'video'))`)
    try {
      const r = run()
      expect(r.status).toBe(3)
      expect(r.stdout).toMatch(/constraint ClassroomSession_mode_check is .*video/)
    } finally {
      await db.$executeRawUnsafe(`alter table "ClassroomSession" drop constraint "ClassroomSession_mode_check", add constraint "ClassroomSession_mode_check" check ("mode" in ('avatar', 'voice'))`)
    }
    expect(run().status).toBe(0)
  })

  it('⛔ a re-run repairs a stray grant — a COLUMN grant included (a table REVOKE takes it: round 10, codex said it would not)', () => {
    return (async () => {
      await db.$executeRawUnsafe(`grant select ("learnerText") on "ClassroomTurn" to authenticated`)
      const col = () => db.$queryRaw<{ n: number }[]>`SELECT count(*)::int AS n FROM pg_attribute WHERE attrelid = '"ClassroomTurn"'::regclass AND attacl IS NOT NULL`
      expect((await col())[0].n).toBe(1)
      const check = spawnSync(process.execPath, [join(__dirname, '../../../scripts/classroom-ddl.mjs'), '--check'], { env: { ...process.env, DIRECT_URL: url }, encoding: 'utf8' })
      expect(check.status).toBe(3)
      expect(check.stdout).toMatch(/ClassroomTurn\.learnerText grants SELECT to authenticated/)
      const apply = spawnSync(process.execPath, [join(__dirname, '../../../scripts/classroom-ddl.mjs')], { env: { ...process.env, DIRECT_URL: url }, encoding: 'utf8' })
      expect(apply.status).toBe(0)
      expect((await col())[0].n).toBe(0)
    })()
  })

  it('⛔ a Spatius id is given out at most once: let go → queued, and refused forever — for any avatar', async () => {
    const a = await teacherWithAvatar({ customStatus: 'ready', spatiusAvatarId: 'sp-ddl-one' })
    const b = await teacherWithAvatar()
    // an id the queue could not hold never reaches the avatar (so it can never block an erasure)
    await expect(db.classroomAvatar.update({ where: { id: b.avatarId }, data: { customStatus: 'ready', spatiusAvatarId: 'abc' } })).rejects.toThrow()
    await expect(db.classroomAvatar.update({ where: { id: b.avatarId }, data: { customStatus: 'ready', spatiusAvatarId: 'request:x' } })).rejects.toThrow()
    await db.classroomAvatar.update({ where: { id: a.avatarId }, data: { customStatus: 'removed', spatiusAvatarId: null, photoWithdrawnAt: new Date() } })
    expect(await queued(['sp-ddl-one'])).toEqual([{ id: 'sp-ddl-one', reason: 'withdrawn', done: false }])
    for (const avatarId of [a.avatarId, b.avatarId]) {
      await expect(db.classroomAvatar.update({ where: { id: avatarId }, data: { customStatus: 'ready', spatiusAvatarId: 'sp-ddl-one', photoWithdrawnAt: null } }))
        .rejects.toThrow(/never given out again/)
    }
  })

  it('⛔ a release and a give-out of one id never interleave (the per-id advisory lock): the give-out waits, then is refused', async () => {
    const pg = (await import('pg')).default
    const a = await teacherWithAvatar({ customStatus: 'ready', spatiusAvatarId: 'sp-ddl-race' })
    const b = await teacherWithAvatar()
    const one = new pg.Client({ connectionString: url })
    const two = new pg.Client({ connectionString: url })
    await Promise.all([one.connect(), two.connect()])
    try {
      await one.query('begin')
      await one.query(`update "ClassroomAvatar" set "spatiusAvatarId" = null, "customStatus" = 'removed' where id = $1`, [a.avatarId])
      await two.query('begin')
      let settled = false
      const give = two.query(`update "ClassroomAvatar" set "spatiusAvatarId" = 'sp-ddl-race', "customStatus" = 'ready' where id = $1`, [b.avatarId]).finally(() => { settled = true })
      give.catch(() => {})
      await new Promise((r) => setTimeout(r, 300))
      expect(settled).toBe(false) // waiting on the id's lock, not deciding on a stale view of the queue
      await one.query('commit')
      await expect(give).rejects.toThrow(/never given out again/)
      await two.query('rollback')
    } finally {
      await Promise.all([one.end(), two.end()])
    }
  })

  it('⛔ a request withdrawn before its id was pasted leaves a marker; no new request until it is done', async () => {
    const a = await teacherWithAvatar({ customStatus: 'requested', photoConsentAt: new Date() })
    await db.classroomAvatar.update({ where: { id: a.avatarId }, data: { customStatus: 'removed', photoWithdrawnAt: new Date() } })
    const marker = `request:${a.avatarId}`
    expect(await queued([marker])).toEqual([{ id: marker, reason: 'withdrawn', done: false }])
    // a new request clears the withdrawal, as the photo route does — and waits for the marker
    await expect(db.classroomAvatar.update({ where: { id: a.avatarId }, data: { customStatus: 'requested', photoWithdrawnAt: null } })).rejects.toThrow(/still being deleted/)
    await db.$executeRaw`UPDATE public.classroom_likeness_deletion SET done_at = now(), done_by = 'test' WHERE spatius_avatar_id = ${marker}`
    await db.classroomAvatar.update({ where: { id: a.avatarId }, data: { customStatus: 'requested', photoWithdrawnAt: null } })
    // erased while requested: the same marker reopens, as 'erased'
    await db.profile.delete({ where: { id: a.profileId } })
    expect(await queued([marker])).toEqual([{ id: marker, reason: 'erased', done: false }])
  })

  it('⛔ erasing an account cascades to the avatar and queues its likeness — whatever path deletes the row', async () => {
    const a = await teacherWithAvatar({ customStatus: 'ready', spatiusAvatarId: 'sp-ddl-erase' })
    await db.profile.delete({ where: { id: a.profileId } })
    expect(await db.classroomAvatar.count({ where: { id: a.avatarId } })).toBe(0)
    expect(await queued(['sp-ddl-erase'])).toEqual([{ id: 'sp-ddl-erase', reason: 'erased', done: false }])
  })
})
