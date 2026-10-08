// @vitest-environment jsdom
// The join form's account rule (gate review, 2026-10-08): a sign-in keeps the form; a signed-in account LEAVING — a
// sign-out, another account — is a new form (TeacherForm keys join mode by this count).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderHook } from '@testing-library/react'
import { readStoredDraft, useAccountLeaves, writeStoredDraft } from './teacher-form'
import { EMPTY_TEACHER } from '@/lib/teachers/profile'

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
    writeStoredDraft(draft)
    expect(localStorage.getItem(KEY)).toBeNull()
    expect(readStoredDraft()).toMatchObject({ fullName: 'Jane Doe' })
    vi.stubGlobal('sessionStorage', store()) // another tab, or the next person after the browser closed
    expect(readStoredDraft()).toBeNull()
  })

  it('for 15 minutes after its last change — then it is gone', () => {
    writeStoredDraft(draft)
    expect(readStoredDraft(Date.now() + 14 * 60_000)).toMatchObject({ fullName: 'Jane Doe' })
    expect(readStoredDraft(Date.now() + 15 * 60_000 + 1)).toBeNull()
    expect(sessionStorage.getItem(KEY)).toBeNull()
  })

  it('the old device-wide draft, kept for good, is deleted unread', () => {
    localStorage.setItem(KEY, JSON.stringify(draft))
    expect(readStoredDraft()).toBeNull()
    expect(localStorage.getItem(KEY)).toBeNull()
  })
})
