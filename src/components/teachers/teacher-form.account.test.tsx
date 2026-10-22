// @vitest-environment jsdom
// The join form's account rule (gate review, 2026-10-08): a sign-in keeps the form; a signed-in account LEAVING — a
// sign-out, another account — is a new form (TeacherForm keys join mode by this count).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderHook } from '@testing-library/react'
import { readStoredDraft, useAccountLeaves, writeStoredDraft } from './teacher-form'
import { EMPTY_TEACHER, type TeacherInput } from '@/lib/teachers/profile'

describe('useAccountLeaves', () => {
  const run = (first: string | null) => renderHook(({ uid }: { uid: string | null }) => useAccountLeaves(uid), { initialProps: { uid: first } })

  it('a sign-in mid-flow is not a leave — the teacher keeps their place', () => {
    const h = run(null)
    expect(h.result.current).toBe(0)
    h.rerender({ uid: 'a' })
    expect(h.result.current).toBe(0)
  })

  it('a sign-out, or another account, is a leave — counted in the same render', () => {
    const h = run('a')
    h.rerender({ uid: null })
    expect(h.result.current).toBe(1)
    // The next person signs in on that fresh form: not a leave, their typing stays.
    h.rerender({ uid: 'b' })
    expect(h.result.current).toBe(1)
    h.rerender({ uid: 'c' })
    expect(h.result.current).toBe(2)
  })

  it('the same account re-rendering changes nothing', () => {
    const h = run('a')
    h.rerender({ uid: 'a' })
    h.rerender({ uid: 'a' })
    expect(h.result.current).toBe(0)
  })
})

// The stored draft is crash insurance — the /post wizard's rule (gate reviews, 2026-10-08): this tab, 15 minutes.
describe('the stored draft', () => {
  const KEY = 'eno.teacherDraft.v1'
  const store = () => {
    const m = new Map<string, string>()
    return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, String(v)), removeItem: (k: string) => void m.delete(k), clear: () => m.clear(), key: () => null, length: 0 }
  }
  // ⛔ Node 25's built-in Web Storage is dead under jsdom: fresh stores per test (a new sessionStorage = another tab).
  beforeEach(() => { vi.stubGlobal('localStorage', store()); vi.stubGlobal('sessionStorage', store()) })
  afterEach(() => { vi.unstubAllGlobals() })
  const draft = { ...EMPTY_TEACHER, fullName: 'Jane Doe', phone: '+84901234567' }

  it('lives in THIS tab — it survives a reload and the sign-in redirect, and never reaches another tab', () => {
    writeStoredDraft(draft, 'teaching', { owner: 'u1' })
    expect(localStorage.getItem(KEY)).toBeNull()
    expect(readStoredDraft()?.t).toMatchObject({ fullName: 'Jane Doe' })
    vi.stubGlobal('sessionStorage', store()) // another tab, or the next person after the browser closed
    expect(readStoredDraft()).toBeNull()
  })

  it('for 15 minutes after its last change — then it is gone', () => {
    writeStoredDraft(draft, 'plans', { owner: 'u1' })
    expect(readStoredDraft(Date.now() + 14 * 60_000)?.t).toMatchObject({ fullName: 'Jane Doe' })
    expect(readStoredDraft(Date.now() + 15 * 60_000 + 1)).toBeNull()
    expect(sessionStorage.getItem(KEY)).toBeNull()
  })

  it('the old device-wide draft, kept for good, is deleted unread', () => {
    localStorage.setItem(KEY, JSON.stringify(draft))
    expect(readStoredDraft()).toBeNull()
    expect(localStorage.getItem(KEY)).toBeNull()
  })

  it('v5 keeps the STEP — a reload or the Google round trip lands where the teacher was going', () => {
    writeStoredDraft(draft, 'cover')
    expect(JSON.parse(sessionStorage.getItem(KEY)!)).toMatchObject({ v: 5, step: 'cover' })
    expect(readStoredDraft()?.step).toBe('cover')
  })

  it('⛔ never holds the photo, the video, the cover switch or a consent — the periods, the rate and the phone stay', () => {
    writeStoredDraft({
      ...draft, photoUrl: 'https://sb.eno.vn/p.webp', videoUrl: 'https://sb.eno.vn/v.mp4', coverOpen: true, coverConsent: true,
      coverSlots: ['mon-am'], coverRateVnd: 300_000, matchEmailOptIn: true, staffContactOptIn: true,
    }, 'finish')
    const stored = JSON.parse(sessionStorage.getItem(KEY)!).t
    expect(stored).toMatchObject({
      photoUrl: null, videoUrl: null, coverOpen: false, coverConsent: false, matchEmailOptIn: false, staffContactOptIn: false,
      coverSlots: ['mon-am'], coverRateVnd: 300_000, phone: '+84901234567',
    })
  })

  it('⛔ a v3 draft from an older form is read once — step 1 only, with no step, so the form opens where it first fails', () => {
    sessionStorage.setItem(KEY, JSON.stringify({ v: 3, savedAt: Date.now(), t: { fullName: 'Old Draft', preferredCities: ['ha-noi'] } }))
    const r = readStoredDraft()!
    expect(r.step).toBeNull()
    expect((r.t as TeacherInput).fullName).toBe('')
    expect((r.t as TeacherInput).teachAreas).toContain('ha-noi') // step 1 writes the teaching areas
  })

  it('⛔ a v4 copy (the form before copies had an owner, which a signed-out visitor could fill through "About you"): step 1 only — never a previous person\'s name or bio', () => {
    sessionStorage.setItem(KEY, JSON.stringify({ v: 4, savedAt: Date.now(), step: 'about', t: { ...draft, fullName: 'Previous Visitor', bio: 'Their bio' }, signIn: Date.now(), base: { uid: 'u9', rev: 2, gen: 'x' } }))
    const r = readStoredDraft()!
    expect(r).toMatchObject({ step: 'about' })
    expect(r).not.toHaveProperty('signIn')
    expect(r).not.toHaveProperty('base')
    expect((r.t as TeacherInput).fullName).toBe('')
    expect((r.t as TeacherInput).bio).toBe('')
    expect((r.t as TeacherInput).livesIn).toBe(draft.livesIn)
  })

  it('"Prefer not to say" (the HCMC district — it stores nothing) rides BESIDE the answers, only when given', () => {
    writeStoredDraft(draft, 'plans', { districtNotSaying: true })
    expect(JSON.parse(sessionStorage.getItem(KEY)!)).toMatchObject({ districtNotSaying: true, t: { currentDistrictKey: '' } })
    expect(readStoredDraft()?.districtNotSaying).toBe(true)
    writeStoredDraft(draft, 'plans')
    expect(readStoredDraft()).not.toHaveProperty('districtNotSaying')
  })

  it('a draft naming a step that does not exist is read with no step', () => {
    sessionStorage.setItem(KEY, JSON.stringify({ v: 5, savedAt: Date.now(), step: 'qualifications', t: draft }))
    expect(readStoredDraft()?.step).toBeNull()
  })

  // ⛔ NOTHING OWNERLESS CARRIES MORE THAN STEP 1 (commit gate, rounds 13-14)
  const answers: TeacherInput = { ...EMPTY_TEACHER, livesIn: 'abroad', jobTypes: ['fulltime'], fullName: 'Previous Visitor', bio: 'Their bio' }
  it('a copy written signed out is read as step 1 — the rest of it never reaches a form', () => {
    writeStoredDraft(answers, 'about')
    const r = readStoredDraft()!
    expect(r).not.toHaveProperty('owner')
    expect(r.t).toMatchObject({ livesIn: 'abroad', jobTypes: ['fulltime'], fullName: '', bio: '' })
  })
  it('a copy written under an account keeps everything, and says whose it is', () => {
    writeStoredDraft(answers, 'about', { owner: 'u1' })
    expect(readStoredDraft()).toMatchObject({ owner: 'u1', t: { fullName: 'Previous Visitor', bio: 'Their bio' } })
  })
  it('⛔ a job-match refusal is read only from a copy with an owner — never one account\'s on the next account\'s form (commit gate, codex 2026-10-22)', () => {
    writeStoredDraft(answers, 'finish', { optInsOff: ['matchEmail'], owner: 'u1' })
    expect(readStoredDraft()).toMatchObject({ owner: 'u1', optInsOff: ['matchEmail'] })
    writeStoredDraft(answers, 'finish', { optInsOff: ['matchEmail'] })
    expect(readStoredDraft()).not.toHaveProperty('optInsOff')
  })
})
