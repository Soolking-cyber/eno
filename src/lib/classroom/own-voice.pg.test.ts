// @vitest-environment node
import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * ⛔ A TEACHER'S OWN VOICE AGAINST A REAL POSTGRES (own-voice.ts): the single-use script, the conditional state moves, the
 * slot count, and the reconcile that deletes at Soniox every voice no row holds. Soniox is a fake store here (these tests
 * are about OUR rows); the opt-in and the throwaway-database rule are flows.pg.test.ts's.
 */
const url = process.env.DATABASE_URL || ''
const parsed = (() => { try { return new URL(url) } catch { return null } })()
const loopback = ['127.0.0.1', 'localhost', '::1'].includes(parsed?.hostname ?? '')
const live = process.env.CLASSROOM_PG_TESTS === '1' && loopback && parsed?.port !== '5433' && /_it$/.test(parsed?.pathname ?? '')

type FakeVoice = { id: string; name: string; created_at: string; status: string }
const s = vi.hoisted(() => ({
  voices: new Map<string, FakeVoice>(),
  deleted: [] as string[],
  heard: '' as string,
  createStatus: 'ready',
  createFails: null as number | null,
  deleteFails: false,
  recomputed: [] as string[],
  /** Voices Soniox still has but leaves out of its list (a voice made after the list was read). */
  unlisted: new Map<string, FakeVoice>(),
  seq: 0,
}))
vi.mock('server-only', () => ({}))
vi.mock('@/lib/user-blocks', () => ({ isStaffProfile: async () => true }))
vi.mock('./soniox', async (orig) => ({
  ...(await orig<typeof import('./soniox')>()),
  sonioxConfig: () => ({ key: 'k'.repeat(40), rest: 'https://api.soniox.com', ws: 'wss://stt', model: 'stt-rt-v5', tts: 'wss://tts', ttsModel: 'tts-rt-v2' }),
}))
vi.mock('./voice-stt', () => ({ transcribePcm: async () => s.heard }))
vi.mock('./soniox-tts', () => ({ sonioxSpeakLine: async () => Buffer.alloc(3_000, 1) }))
vi.mock('./session-voice', () => ({ forgetVoiceLines: () => {} }))
vi.mock('./soniox-voices', async (orig) => {
  const real = await orig<typeof import('./soniox-voices')>()
  const { SonioxError } = await import('./soniox')
  const out = (v: FakeVoice) => ({ id: v.id, name: v.name, createdAt: new Date(v.created_at), status: v.status as 'ready', errorType: null })
  return {
    ...real,
    createVoice: async (_c: unknown, name: string) => {
      if (s.createFails) throw new SonioxError(s.createFails)
      const v = { id: `${String(++s.seq).padStart(8, '0')}-0000-4000-8000-000000000000`, name, created_at: new Date().toISOString(), status: s.createStatus }
      s.voices.set(v.id, v)
      return out(v)
    },
    getVoice: async (_c: unknown, id: string) => (s.voices.has(id) ? out(s.voices.get(id)!) : s.unlisted.has(id) ? out(s.unlisted.get(id)!) : null),
    listOurVoices: async (_c: unknown, prefix: string) => [...s.voices.values()].filter((v) => v.name.startsWith(prefix)).map(out),
    deleteVoice: async (_c: unknown, id: string) => { if (s.deleteFails) throw new SonioxError(503); s.voices.delete(id); s.deleted.push(id); return true },
    recomputeVoice: async (_c: unknown, id: string) => { s.recomputed.push(id); const v = s.voices.get(id); if (v) v.status = 'ready' },
  }
})

describe.skipIf(!live)('a teacher\'s own voice against a real Postgres', () => {
  let db: typeof import('@/lib/db').db
  let ov: typeof import('./own-voice')
  let script: typeof import('./own-voice-script')
  let wav: typeof import('./wav')
  let notices: typeof import('./notices')
  let voices: typeof import('./soniox-voices')
  const accountId = randomUUID()
  let teacher = { id: '', profileId: accountId }
  let tutorId = ''

  /** 25 s of a tone at 24 kHz — long and loud enough; what it SAYS is the fake STT's (s.heard). */
  const recording = () => {
    const pcm = new Int16Array(24_000 * 25)
    for (let i = 0; i < pcm.length; i++) pcm[i] = Math.round(Math.sin(i / 9) * 9000)
    return wav.encodeWav(pcm, 24_000)
  }
  const consent = () => ({ version: notices.VOICE_NOTICE_VERSION, ownVoice: true })
  const readScript = async () => {
    const view = await ov.issueScript(teacher.id)
    if (view.status !== 'script') throw new Error('no script')
    s.heard = view.sentences.join(' ')
    return view
  }

  beforeAll(async () => {
    db = (await import('@/lib/db')).db
    const [{ name }] = await db.$queryRaw<{ name: string }[]>`SELECT current_database() AS name`
    if (!/_it$/.test(name)) throw new Error(`refusing to write to ${name}`)
    ov = await import('./own-voice')
    script = await import('./own-voice-script')
    wav = await import('./wav')
    notices = await import('./notices')
    voices = await import('./soniox-voices')
    await db.profile.create({ data: { id: accountId, email: `${accountId}@example.test`, accountType: 'individual' } })
    const tp = await db.teacherProfile.create({ data: { profileId: accountId, fullName: 'Anna Smith', headline: 'Teacher', nationality: 'GB', currentCity: 'hcmc', consentPublicAt: new Date(), updatedAt: new Date() } })
    teacher = { id: tp.id, profileId: accountId }
    tutorId = (await db.classroomAvatar.create({ data: { teacherProfileId: tp.id, name: 'Ms Anna', voice: 'Harper' } })).id
  }, 60_000)

  beforeEach(async () => {
    await db.classroomVoice.deleteMany({ where: { teacherProfileId: teacher.id } })
    await db.classroomAvatar.update({ where: { id: tutorId }, data: { ownVoiceId: null } })
    await db.$executeRaw`DELETE FROM rl_window WHERE name = 'classroom-voice'`
    await db.$executeRaw`DELETE FROM public.classroom_voice_deletion`
    Object.assign(s, { heard: '', createStatus: 'ready', createFails: null, deleteFails: false, deleted: [], recomputed: [] })
    s.voices.clear()
    s.unlisted.clear()
  })

  afterAll(async () => {
    await db?.profile.deleteMany({ where: { id: accountId } })
  })

  it('read the script → checked, made, ready with its sample; the consent on the row AND on the audit chain', async () => {
    const view = await readScript()
    const done = await ov.submitRecording(teacher, view.id, recording(), consent())
    expect(done.status).toBe('ready')
    const row = await db.classroomVoice.findUniqueOrThrow({ where: { id: view.id } })
    expect(row).toMatchObject({ status: 'ready', consentVersion: notices.VOICE_NOTICE_VERSION })
    expect(row.sonioxVoiceId).toBeTruthy()
    expect(row.sample?.length).toBe(3_000)
    expect([...s.voices.values()][0].name).toBe(voices.voiceName(view.id))
    const audit = await db.$queryRaw<{ n: bigint }[]>`SELECT count(*)::bigint AS n FROM compliance_audit WHERE action = 'classroom.voice.consent' AND detail->>'voiceId' = ${view.id}`
    expect(Number(audit[0].n)).toBe(1)
  })

  it('⛔ a script is good ONCE: a second upload of the same one is refused, and nothing more is made', async () => {
    const view = await readScript()
    await ov.submitRecording(teacher, view.id, recording(), consent())
    await expect(ov.submitRecording(teacher, view.id, recording(), consent())).rejects.toMatchObject({ code: 'voice_script_expired' })
    expect(s.voices.size).toBe(1)
  })

  it('⛔ two uploads of one script at once: exactly one is checked', async () => {
    const view = await readScript()
    const r = await Promise.allSettled([ov.submitRecording(teacher, view.id, recording(), consent()), ov.submitRecording(teacher, view.id, recording(), consent())])
    expect(r.filter((x) => x.status === 'fulfilled')).toHaveLength(1)
    expect(s.voices.size).toBe(1)
  })

  it('⛔ other words (an old recording of another script): refused, the attempt failed, nothing sent to be cloned', async () => {
    const view = await readScript()
    s.heard = script.SENTENCES.slice(0, 6).join(' ') === s.heard ? script.SENTENCES.slice(10, 16).join(' ') : script.SENTENCES.slice(0, 6).join(' ')
    await expect(ov.submitRecording(teacher, view.id, recording(), consent())).rejects.toMatchObject({ code: 'voice_not_script' })
    expect(await db.classroomVoice.findUnique({ where: { id: view.id } })).toMatchObject({ status: 'failed', failReason: 'not_script' })
    expect(s.voices.size).toBe(0)
  })

  it('⛔ an expired script, another notice version, or a recording too short: refused before anything leaves', async () => {
    const view = await readScript()
    await expect(ov.submitRecording(teacher, view.id, recording(), { version: 'old', ownVoice: true })).rejects.toMatchObject({ code: 'notice_changed' })
    const short = wav.encodeWav(new Int16Array(24_000 * 5).fill(9000), 24_000)
    await expect(ov.submitRecording(teacher, view.id, short, consent())).rejects.toMatchObject({ code: 'voice_too_short' })
    await db.classroomVoice.update({ where: { id: view.id }, data: { expiresAt: new Date(Date.now() - 1000) } })
    await expect(ov.submitRecording(teacher, view.id, recording(), consent())).rejects.toMatchObject({ code: 'voice_script_expired' })
    expect(s.voices.size).toBe(0)
  })

  it('⛔ a ready voice is not replaced by a new script (the teacher deletes it first)', async () => {
    const view = await readScript()
    await ov.submitRecording(teacher, view.id, recording(), consent())
    await expect(ov.issueScript(teacher.id)).rejects.toMatchObject({ code: 'voice_exists' })
  })

  it('⛔ Soniox\'s organisation full (429): the attempt fails as slots_full, nothing is held', async () => {
    const view = await readScript()
    s.createFails = 429
    await expect(ov.submitRecording(teacher, view.id, recording(), consent())).rejects.toMatchObject({ code: 'voice_slots_full' })
    expect(await db.classroomVoice.findUnique({ where: { id: view.id } })).toMatchObject({ status: 'failed', failReason: 'slots_full' })
  })

  it('still processing after the wait: making; the next view asks Soniox and finishes it — the sample made once', async () => {
    const view = await readScript()
    s.createStatus = 'processing'
    // No wait (the route's is READY_WAIT_MS): still processing when it answers.
    expect((await ov.submitRecording(teacher, view.id, recording(), consent(), new Date(), 0)).status).toBe('making')
    for (const v of s.voices.values()) v.status = 'ready'
    expect((await ov.voiceView(teacher.id, new Date(Date.now() + 10_000))).status).toBe('ready')
  })

  it('⛔ the tutor speaks the clone only while it is ready and the tutor names it; a delete takes it back, queues it, and deletes it at Soniox', async () => {
    const view = await readScript()
    await ov.submitRecording(teacher, view.id, recording(), consent())
    const avatar = () => db.classroomAvatar.findUniqueOrThrow({ where: { id: tutorId }, select: { voice: true, ownVoiceId: true, teacherProfileId: true } })
    expect((await ov.tutorVoice(await avatar())).own).toBeNull() // not switched on for this tutor
    await db.classroomAvatar.update({ where: { id: tutorId }, data: { ownVoiceId: await ov.readyVoiceId(teacher.id) } })
    const own = (await ov.tutorVoice(await avatar())).own
    expect(own).toBe((await db.classroomVoice.findUniqueOrThrow({ where: { id: view.id } })).sonioxVoiceId)
    await ov.deleteOwnVoice(teacher.id, accountId, 'teacher')
    expect(await ov.tutorVoice(await avatar())).toEqual({ stock: 'Harper', own: null })
    expect((await avatar()).ownVoiceId).toBeNull()
    expect(s.deleted).toEqual([own])
    expect(await ov.pendingVoiceDeletions()).toMatchObject({ count: 0 }) // queued by the trigger, ticked off at once
  })

  it('⛔ a voice that FAILED and a new one made after it: the tutor that named the old one does not speak the new one', async () => {
    const first = await readScript()
    await ov.submitRecording(teacher, first.id, recording(), consent())
    await db.classroomAvatar.update({ where: { id: tutorId }, data: { ownVoiceId: first.id } })
    for (const v of s.voices.values()) v.status = 'failed'
    await ov.reconcileVoices()
    expect(await db.classroomVoice.findUnique({ where: { id: first.id } })).toMatchObject({ status: 'failed', failReason: 'unusable' })
    const second = await readScript()
    expect((await ov.submitRecording(teacher, second.id, recording(), consent())).status).toBe('ready')
    const avatar = await db.classroomAvatar.findUniqueOrThrow({ where: { id: tutorId }, select: { voice: true, ownVoiceId: true, teacherProfileId: true } })
    expect(await ov.tutorVoice(avatar)).toEqual({ stock: 'Harper', own: null })
  })

  it('⛔ erasing the teacher (the TeacherProfile cascade) queues their voice at Soniox — no caller involved', async () => {
    const other = randomUUID()
    await db.profile.create({ data: { id: other, email: `${other}@example.test`, accountType: 'individual' } })
    const tp = await db.teacherProfile.create({ data: { profileId: other, fullName: 'B', headline: 'T', nationality: 'GB', currentCity: 'hcmc', consentPublicAt: new Date(), updatedAt: new Date() } })
    const view = await ov.issueScript(tp.id)
    if (view.status !== 'script') throw new Error('no script')
    s.heard = view.sentences.join(' ')
    await ov.submitRecording({ id: tp.id, profileId: other }, view.id, recording(), consent())
    const id = [...s.voices.keys()][0]
    await db.profile.delete({ where: { id: other } })
    expect(await ov.pendingVoiceDeletions()).toMatchObject({ count: 1 })
    expect((await ov.reconcileVoices()).deleted).toBe(1)
    expect(s.voices.has(id)).toBe(false)
  })

  describe('⛔ the reconcile: only voices THIS database held, or its own lost creates, are ever deleted', () => {
    const old = () => new Date(Date.now() - ov.STUCK_MS - 60_000).toISOString()
    it('⛔ a voice no row of this database names (a restored copy, another database, a stranger) is never touched', async () => {
      s.voices.set('o1', { id: 'o1', name: voices.voiceName('a-row-of-another-database'), created_at: old(), status: 'ready' })
      s.voices.set('o2', { id: 'o2', name: 'not-ours', created_at: old(), status: 'ready' })
      expect((await ov.reconcileVoices()).deleted).toBe(0)
      expect([...s.voices.keys()].sort()).toEqual(['o1', 'o2'])
    })

    it('a failed attempt whose create answer was lost: its own voice (made after the row) is deleted', async () => {
      const view = await readScript()
      await db.classroomVoice.update({ where: { id: view.id }, data: { status: 'failed', failReason: 'soniox' } })
      s.voices.set('lost', { id: 'lost', name: voices.voiceName(view.id), created_at: new Date(Date.now() + 1000).toISOString(), status: 'ready' })
      expect((await ov.reconcileVoices()).deleted).toBe(1)
      expect(s.voices.has('lost')).toBe(false)
    })

    it('⛔ a create in flight is spared: a making row with no id yet', async () => {
      const view = await readScript()
      await db.classroomVoice.update({ where: { id: view.id }, data: { status: 'making', consentVersion: 'v', consentSha: '0123456789abcdef', consentAt: new Date() } })
      s.voices.set('inflight', { id: 'inflight', name: voices.voiceName(view.id), created_at: new Date(Date.now() + 1000).toISOString(), status: 'processing' })
      await ov.reconcileVoices()
      expect(s.voices.has('inflight')).toBe(true)
    })

    it('⛔ a stuck attempt (its request died) is failed, and its lost voice let go', async () => {
      const view = await readScript()
      await db.$executeRaw`UPDATE "ClassroomVoice" SET status = 'making', "consentVersion" = 'v', "consentSha" = '0123456789abcdef', "consentAt" = (now() AT TIME ZONE 'UTC'), "updatedAt" = (now() AT TIME ZONE 'UTC') - interval '1 hour' WHERE id = ${view.id}`
      s.voices.set('lost', { id: 'lost', name: voices.voiceName(view.id), created_at: new Date(Date.now() + 1000).toISOString(), status: 'ready' })
      const r = await ov.reconcileVoices()
      expect(r.stuck).toBe(1)
      expect(await db.classroomVoice.findUnique({ where: { id: view.id } })).toMatchObject({ status: 'failed', failReason: 'timeout' })
      expect(s.voices.has('lost')).toBe(false)
    })

    it('a ready voice Soniox failed: the row fails (queued by the trigger) and the next run deletes it', async () => {
      const view = await readScript()
      await ov.submitRecording(teacher, view.id, recording(), consent())
      for (const v of s.voices.values()) v.status = 'failed'
      await ov.reconcileVoices()
      expect(await db.classroomVoice.findUnique({ where: { id: view.id } })).toMatchObject({ status: 'failed', failReason: 'unusable', sample: null })
      await ov.reconcileVoices()
      expect(s.voices.size).toBe(0)
    })

    it('⛔ "gone" only on Soniox\'s own word: a voice left out of the list but still there is kept; one Soniox no longer has fails its row', async () => {
      const view = await readScript()
      await ov.submitRecording(teacher, view.id, recording(), consent())
      const [v] = [...s.voices.values()]
      s.voices.delete(v.id)
      s.unlisted.set(v.id, v)
      await ov.reconcileVoices()
      expect(await db.classroomVoice.findUnique({ where: { id: view.id } })).toMatchObject({ status: 'ready' })
      s.unlisted.clear()
      await ov.reconcileVoices()
      expect(await db.classroomVoice.findUnique({ where: { id: view.id } })).toMatchObject({ status: 'failed', failReason: 'gone' })
    })

    it('a voice made before our TTS model could prepare it (not_computed): asked to recompute, then ready', async () => {
      const view = await readScript()
      s.createStatus = 'not_computed'
      // No wait of the route's own: the recompute is asked at once, and the view that follows finds it prepared.
      expect((await ov.submitRecording(teacher, view.id, recording(), consent(), new Date(), 0)).status).toBe('ready')
      expect(s.recomputed).toHaveLength(1)
    })

    it('⛔ Soniox refusing deletes: counted on the queue and retried next run — the row is gone at once', async () => {
      const view = await readScript()
      await ov.submitRecording(teacher, view.id, recording(), consent())
      s.deleteFails = true
      await ov.deleteOwnVoice(teacher.id, accountId, 'teacher')
      expect(await db.classroomVoice.findUnique({ where: { id: view.id } })).toBeNull()
      expect((await ov.reconcileVoices()).deleteFailed).toBe(1)
      expect(await ov.pendingVoiceDeletions()).toMatchObject({ count: 1, attempts: 1 })
      s.deleteFails = false
      expect((await ov.reconcileVoices()).deleted).toBe(1)
      expect(s.voices.size).toBe(0)
      expect(await ov.pendingVoiceDeletions()).toMatchObject({ count: 0 })
    })
  })
})
