import { afterEach, describe, expect, it, vi } from 'vitest'
import { escapeXml, replySsml, trimPron } from './azure-speech'
import { mintSessionToken, spatiusConfig, tokenExpireAt, SpatiusError } from './spatius'
import { budgetRefusal } from './budget'
import { estimateCostMicroUsd } from './costs'
import { parseJoin } from './join'
import { ADULT_ATTESTATION, ADULT_NOTICE_VERSION, ASSENT_TEXT, ASSENT_YES, GUARDIAN_ATTESTATION, PERSONA_AI_NOTICE, PHOTO_NOTICE, PRACTICE_NOTICE, TEACHER_VIEW_NOTICE, PRACTICE_NOTICE_VERSION, TEACHER_VIEW_NOTICE_VERSION, GUARDIAN_NOTICE_VERSION, ASSENT_VERSION } from './notices'
import { VOICES, defaultVoice, voiceById } from './voices'

vi.mock('server-only', () => ({}))
afterEach(() => vi.unstubAllEnvs())

describe('Azure speech, parsed', () => {
  it('keeps the scores and the words, and phonemes only where a word went wrong', () => {
    const p = trimPron({
      PronunciationAssessment: { AccuracyScore: 71.4, FluencyScore: 88, CompletenessScore: 100, ProsodyScore: 64.6 },
      Words: [
        { Word: 'think', PronunciationAssessment: { AccuracyScore: 42, ErrorType: 'Mispronunciation' }, Phonemes: [{ Phoneme: 'θ', PronunciationAssessment: { AccuracyScore: 10 } }] },
        { Word: 'so', PronunciationAssessment: { AccuracyScore: 98, ErrorType: 'None' }, Phonemes: [{ Phoneme: 's', PronunciationAssessment: { AccuracyScore: 99 } }] },
        { Word: '', PronunciationAssessment: { AccuracyScore: 5 } },
      ],
    })
    expect(p).toEqual({
      accuracy: 71, fluency: 88, completeness: 100, prosody: 65,
      words: [{ word: 'think', score: 42, error: 'Mispronunciation', phonemes: [{ p: 'θ', score: 10 }] }, { word: 'so', score: 98, error: null }],
    })
  })
  it('⛔ SSML: an allowlisted voice and escaped text — nothing else enters', () => {
    const ssml = replySsml(`Tom's <tag> & "quote"`, 'en-GB-SoniaNeural', 'slow')
    expect(ssml).toContain('<voice name="en-GB-SoniaNeural">')
    expect(ssml).toContain('xml:lang="en-GB"')
    expect(ssml).toContain('Tom&apos;s &lt;tag&gt; &amp; &quot;quote&quot;')
    expect(ssml).toContain('rate="-12%"')
    expect(replySsml('x', 'evil"><voice name="x', 'natural')).toContain('<voice name="en-US-AvaMultilingualNeural">')
    expect(escapeXml('<&>')).toBe('&lt;&amp;&gt;')
  })
  it('voices: unique Azure-shaped ids; the teacher’s own accent first', () => {
    expect(new Set(VOICES.map((v) => v.id)).size).toBe(VOICES.length)
    for (const v of VOICES) expect(v.id).toMatch(/^en-[A-Z]{2}-[A-Za-z]+Neural$/)
    expect(defaultVoice('GB').accent).toBe('UK')
    expect(defaultVoice('ph').accent).toBe('PH')
    expect(defaultVoice('VN').accent).toBe('US')
    expect(voiceById('nope')).toBeNull()
  })
})

describe('Spatius session tokens', () => {
  it('expire at the session’s end + 2 min, never past Spatius’s 24 h ceiling', () => {
    const now = new Date('2026-10-25T00:00:00Z')
    expect(tokenExpireAt(new Date('2026-10-25T00:10:00Z'), now)).toBe(Date.parse('2026-10-25T00:12:00Z') / 1000)
    expect(tokenExpireAt(new Date('2026-10-27T00:00:00Z'), now)).toBe(Date.parse('2026-10-26T00:00:00Z') / 1000 - 60)
  })
  it('not configured → null (the session runs voice-only); Tokyo by default', () => {
    expect(spatiusConfig()).toBeNull()
    vi.stubEnv('SPATIUS_API_KEY', 'k'); vi.stubEnv('SPATIUS_APP_ID', 'a')
    expect(spatiusConfig()).toMatchObject({ region: 'ap-northeast', console: 'https://console.ap-northeast.spatius.ai' })
    vi.stubEnv('SPATIUS_REGION', 'nowhere')
    expect(spatiusConfig()).toBeNull()
  })
  it('mints with the key in a header and seconds in the body; any failure is a SpatiusError', async () => {
    const calls: { url: string; init: RequestInit }[] = []
    const ok = (async (url: string, init: RequestInit) => { calls.push({ url, init }); return new Response(JSON.stringify({ sessionToken: 'tok' })) }) as unknown as typeof fetch
    const cfg = { apiKey: 'KEY', appId: 'APP', region: 'ap-northeast', console: 'https://console.ap-northeast.spatius.ai' }
    expect(await mintSessionToken(cfg, 123, ok)).toBe('tok')
    expect(calls[0].url).toBe('https://console.ap-northeast.spatius.ai/v1/console/session-tokens')
    expect((calls[0].init.headers as Record<string, string>)['X-API-Key']).toBe('KEY')
    expect(JSON.parse(String(calls[0].init.body))).toEqual({ expireAt: 123 })
    const bad = (async () => new Response('{}', { status: 402 })) as unknown as typeof fetch
    await expect(mintSessionToken(cfg, 1, bad)).rejects.toBeInstanceOf(SpatiusError)
    const empty = (async () => new Response('{"sessionToken":""}')) as unknown as typeof fetch
    await expect(mintSessionToken(cfg, 1, empty)).rejects.toBeInstanceOf(SpatiusError)
  })
})

describe('budget and cost', () => {
  const caps = { dayMinutes: 300, monthMinutes: 3000, teacherMonthMinutes: 600 }
  it('names the first cap a start would break', () => {
    expect(budgetRefusal({ dayMinutes: 290, monthMinutes: 0, teacherMonthMinutes: 0 }, caps, 10)).toBeNull()
    expect(budgetRefusal({ dayMinutes: 291, monthMinutes: 0, teacherMonthMinutes: 0 }, caps, 10)).toBe('day')
    expect(budgetRefusal({ dayMinutes: 0, monthMinutes: 2995, teacherMonthMinutes: 0 }, caps, 10)).toBe('month')
    expect(budgetRefusal({ dayMinutes: 0, monthMinutes: 0, teacherMonthMinutes: 595 }, caps, 10)).toBe('teacher')
  })
  it('estimates Spatius only in avatar mode', () => {
    const base = { usedSeconds: 600, learnerSpeechMs: 240_000, avatarChars: 2_000, aiCalls: 20 }
    expect(estimateCostMicroUsd({ ...base, mode: 'avatar' }) - estimateCostMicroUsd({ ...base, mode: 'voice' })).toBe(100_000)
  })
})

describe('joining', () => {
  const v = { practice: PRACTICE_NOTICE_VERSION, teacherView: TEACHER_VIEW_NOTICE_VERSION }
  it('needs both purposes at the versions shown; a child needs the guardian line', () => {
    expect(parseJoin({ who: 'self', adult: ADULT_NOTICE_VERSION, ...v })).toMatchObject({ who: 'self', adult: ADULT_NOTICE_VERSION })
    expect(parseJoin({ who: 'self', ...v })).toEqual({ error: 'notice_changed' }) // "Me (18+)" is a statement, recorded
    expect(parseJoin({ who: 'self', adult: ADULT_NOTICE_VERSION, practice: 'old', teacherView: v.teacherView })).toEqual({ error: 'notice_changed' })
    expect(parseJoin({ who: 'child', ...v, displayName: 'Minh', birthYear: 2016 })).toEqual({ error: 'notice_changed' })
    expect(parseJoin({ who: 'child', ...v, displayName: ' Minh ', birthYear: '2016', guardian: GUARDIAN_NOTICE_VERSION, assent: ASSENT_VERSION }))
      .toMatchObject({ who: 'child', displayName: 'Minh', birthYear: 2016, assent: ASSENT_VERSION })
    expect(parseJoin({ who: 'child', ...v, displayName: '', birthYear: 2016, guardian: GUARDIAN_NOTICE_VERSION })).toEqual({ error: 'bad_request' })
    expect(parseJoin({ who: 'existing', ...v, learnerId: 'abc' })).toMatchObject({ who: 'existing', learnerId: 'abc' })
    // an existing learner carries the statement that fits it — checked against the learner's kind in claimSeat
    expect(parseJoin({ who: 'existing', learnerId: 'l-1', guardian: GUARDIAN_NOTICE_VERSION, ...v })).toMatchObject({ who: 'existing', guardian: GUARDIAN_NOTICE_VERSION })
    expect(parseJoin({ who: 'existing', learnerId: 'l-1', ...v })).not.toHaveProperty('guardian')
    expect(parseJoin({ who: 'self', adult: ADULT_NOTICE_VERSION, ...v, assent: 'wrong' })).toEqual({ error: 'notice_changed' })
  })
})

describe('notices', () => {
  it('every English part fits the ui-strings harvest (≤ 200 characters) and has its Vietnamese', () => {
    for (const part of [...PERSONA_AI_NOTICE, ...PHOTO_NOTICE, ...PRACTICE_NOTICE, ...TEACHER_VIEW_NOTICE, GUARDIAN_ATTESTATION, ADULT_ATTESTATION, ...ASSENT_TEXT, ASSENT_YES]) {
      expect(part.en.length, part.en).toBeLessThanOrEqual(200)
      expect(part.vi.trim().length).toBeGreaterThan(0)
      expect(part.en).not.toMatch(/[{}]/)
    }
  })
})
