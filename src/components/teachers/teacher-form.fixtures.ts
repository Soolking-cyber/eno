/**
 * The teacher form's test harness (not a test file): the fakes every whole-form test needs. jsdom has no scrollIntoView
 * or scrollTo, Node 25's Web Storage is dead under jsdom (fresh stores per test), and the form talks to /api/teachers/*
 * through fetch. Imported by teacher-form.*.test.tsx only.
 */
import { vi } from 'vitest'
import { EMPTY_TEACHER, type TeacherInput } from '@/lib/teachers/profile'

export const store = () => {
  const m = new Map<string, string>()
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, String(v)),
    removeItem: (k: string) => void m.delete(k),
    clear: () => m.clear(),
    key: (i: number) => [...m.keys()][i] ?? null,
    get length() { return m.size },
  }
}

export const DRAFT_KEY = 'eno.teacherDraft.v1'

/** An HCMC full-time job seeker whose four draft steps are complete. */
export const COMPLETE: TeacherInput = {
  ...EMPTY_TEACHER,
  livesIn: 'city', currentCity: 'ho-chi-minh-city', currentDistrictKey: 'd7', jobTypes: ['fulltime'], relocate: 'no',
  teachAreas: ['ho-chi-minh-city'], teachAreasConfirmed: true,
  subjects: ['general-english'], ageGroups: ['adults'], experienceBand: '3-5-years',
  fullName: 'Jane Doe', nationality: 'GB', englishLevel: 'native', headline: 'CELTA English teacher, five years',
}

export function putDraft(t: Partial<TeacherInput> | Record<string, unknown>, step: string | null = 'about', v = 4) {
  sessionStorage.setItem(DRAFT_KEY, JSON.stringify({ v, savedAt: Date.now(), ...(step ? { step } : {}), t }))
}
export const storedDraft = () => JSON.parse(sessionStorage.getItem(DRAFT_KEY) || 'null')

/** base64url of a JSON value — what a `#d=` fragment carries. */
export function b64url(v: unknown): string {
  const bytes = new TextEncoder().encode(JSON.stringify(v))
  let bin = ''
  bytes.forEach((b) => { bin += String.fromCharCode(b) })
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}
export function unb64url(s: string): unknown {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/')
  const bin = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4))
  return JSON.parse(new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0))))
}

export type Call = { url: string; method: string; body: unknown }
/** A fetch fake: `routes` answers by "METHOD path" (query stripped); every call is recorded. */
export function fakeFetch(routes: Record<string, (body: unknown) => { status?: number; json: unknown }>) {
  const calls: Call[] = []
  const fn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    const method = (init?.method ?? 'GET').toUpperCase()
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) : init?.body ?? null
    calls.push({ url, method, body })
    const route = routes[`${method} ${url.split('?')[0]}`]
    const r = route ? route(body) : { status: 404, json: { error: 'not_found' } }
    return new Response(JSON.stringify(r.json), { status: r.status ?? 200, headers: { 'Content-Type': 'application/json' } })
  })
  return { fn, calls }
}

export function stubBrowser() {
  vi.stubGlobal('localStorage', store())
  vi.stubGlobal('sessionStorage', store())
  vi.stubGlobal('scrollTo', () => {})
  Element.prototype.scrollIntoView ??= function () {}
}
