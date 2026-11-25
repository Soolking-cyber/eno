import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  SIGN_OUT_LOCAL_KEYS,
  SIGN_OUT_LOCAL_PREFIXES,
  SIGN_OUT_SESSION_KEYS,
  SIGN_OUT_SESSION_PREFIXES,
  clearAccountDeviceStorage,
  clearRetiredDeviceKeys,
} from './sign-out-storage'
import { COMPOSE_KEY } from './quick-contact'

const ROOT = join(__dirname, '..', '..')
const src = (p: string) => readFileSync(join(ROOT, p), 'utf8')

function memoryStorage(seed: Record<string, string> = {}): Storage {
  const map = new Map(Object.entries(seed))
  return {
    get length() { return map.size },
    key: (i: number) => [...map.keys()][i] ?? null,
    getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
    setItem: (k: string, v: string) => { map.set(k, String(v)) },
    removeItem: (k: string) => { map.delete(k) },
    clear: () => { map.clear() },
  } as Storage
}

/**
 * ⛔ EACH KEY IS HELD TO THE FILE THAT WRITES IT. Sign-out cleared `eno-convos` / `eno-thr:` for weeks
 * after chat-context.tsx moved to `eno-convos-v2` / `eno-thr2:` — rename a key at its owner and this
 * fails until the sign-out list follows.
 */
describe('sign-out keys match the code that writes them', () => {
  it.each([
    ['eno-convos-v2', 'src/context/chat-context.tsx', /CONVOS_KEY = 'eno-convos-v2'/],
    ['eno-thr2:', 'src/context/chat-context.tsx', /THREAD_PREFIX = 'eno-thr2:'/],
    ['eno-saved-cache', 'src/context/favorites-context.tsx', /SAVED_KEY = 'eno-saved-cache'/],
    ['eno:favorites:acct', 'src/lib/saved-store.ts', /ACCOUNT_KEY = 'eno:favorites:acct'/],
    ['eno-dashboard', 'src/hooks/use-dashboard.ts', /CACHE_KEY = 'eno-dashboard'/],
    ['eno-notifs', 'src/context/notifications-context.tsx', /'eno-notifs'/],
    ['eno-listing-draft', 'src/components/marketplace/post-wizard.tsx', /'eno-listing-draft'/],
    ['eno:ai_chat_v1', 'src/app/[lang]/messages/ai/page.tsx', /STORE_KEY = 'eno:ai_chat_v1'/],
    ['eno.teacherDraft.v1', 'src/components/teachers/teacher-form.tsx', /DRAFT_KEY = 'eno\.teacherDraft\.v1'/],
  ])('%s is what %s writes', (key, file, pattern) => {
    expect(src(file)).toMatch(pattern)
    expect([...SIGN_OUT_LOCAL_KEYS, ...SIGN_OUT_LOCAL_PREFIXES]).toContain(key)
  })

  // The renters' availability check is gone (2026-11-25) but its keys are still on devices that used it: still removed.
  it('the removed rental basket\'s leftovers (local and session) are still covered', () => {
    expect(SIGN_OUT_LOCAL_PREFIXES).toContain('eno:rental-check')
    expect(SIGN_OUT_SESSION_PREFIXES).toContain('eno:rental-check')
  })

  it('⛔ the composer hand-off (sessionStorage) is the key quick-contact.ts writes', () => {
    expect(SIGN_OUT_SESSION_KEYS).toContain(COMPOSE_KEY)
  })

  it('⛔ the teacher-profile draft (sessionStorage since 2026-10-08) is cleared from the tab, not only from localStorage', () => {
    expect(src('src/components/teachers/teacher-form.tsx')).toMatch(/sessionStorage\.setItem\(DRAFT_KEY/)
    expect(SIGN_OUT_SESSION_KEYS).toContain('eno.teacherDraft.v1')
  })

  it('⛔ a guest’s pending action (sessionStorage, UX3 J5) is the key pending-intent.ts writes', () => {
    expect(src('src/lib/pending-intent.ts')).toMatch(/INTENT_KEY = 'eno:pending-intent'/)
    expect(SIGN_OUT_SESSION_KEYS).toContain('eno:pending-intent')
  })
})

describe('clearAccountDeviceStorage', () => {
  it('removes every per-account key and prefix, and leaves device preferences alone', () => {
    const ls = memoryStorage({
      'eno-convos-v2': '{}', 'eno-convos': '{}', 'eno-thr2:abc': '{}', 'eno-thr:old': '{}',
      'eno:ai_chat_v1': '[]', 'eno.teacherDraft.v1': '{}', 'eno:rental-check:v1': '{}',
      'eno:rental-check-draft:v1': '{}', 'eno-listing-draft': '{}', 'eno-notifs': '[]',
      // device / visitor state that must survive a sign-out:
      'eno-theme': 'dark', 'lang': 'vi', 'eno-currency': 'USD', 'eno-consent-v2': 'v2.000.1.abcdefgh',
      'eno:recent_searches': '[]', 'eno:favorites': '[]', 'eno:favorites:acct': '{"u":"x","ids":[]}',
    })
    const ss = memoryStorage({ 'eno:rental-check:hinted': '1', 'eno:feed-snap': '{}', [COMPOSE_KEY]: '{"listingId":"x","body":"hi"}', 'eno.teacherDraft.v1': '{"v":3}' })
    clearAccountDeviceStorage(ls, ss)
    const left = Array.from({ length: ls.length }, (_, i) => ls.key(i)).sort()
    expect(left).toEqual(['eno-consent-v2', 'eno-currency', 'eno-theme', 'eno:favorites', 'eno:recent_searches', 'lang'])
    expect(ss.getItem('eno:rental-check:hinted')).toBeNull()
    expect(ss.getItem(COMPOSE_KEY)).toBeNull()
    expect(ss.getItem('eno.teacherDraft.v1')).toBeNull()
    expect(ss.getItem('eno:feed-snap')).toBe('{}')
  })

  it('never throws when storage is blocked', () => {
    const blocked = { get length(): number { throw new Error('SecurityError') }, removeItem: () => { throw new Error('SecurityError') } } as unknown as Storage
    expect(() => clearAccountDeviceStorage(blocked, blocked)).not.toThrow()
  })
})

// The removed renters' availability check (2026-11-25): its basket, draft (a typed phone or email) and hint are cleared on
// every page load, signed in or not — and nothing else is touched.
describe('clearRetiredDeviceKeys', () => {
  it('removes every eno:rental-check* key from both stores and leaves the rest', () => {
    const ls = memoryStorage({ 'eno:rental-check:v1': '{}', 'eno:rental-check-draft:v1': '{"contact":"84901234567"}', 'eno-notifs': '[]', 'eno:favorites:acct': '[]' })
    const ss = memoryStorage({ 'eno:rental-check:hinted': '1', 'eno-compose': '{}' })
    clearRetiredDeviceKeys(ls, ss)
    expect(ls.getItem('eno:rental-check:v1')).toBeNull()
    expect(ls.getItem('eno:rental-check-draft:v1')).toBeNull()
    expect(ss.getItem('eno:rental-check:hinted')).toBeNull()
    expect(ls.getItem('eno-notifs')).toBe('[]')
    expect(ls.getItem('eno:favorites:acct')).toBe('[]')
    expect(ss.getItem('eno-compose')).toBe('{}')
  })
  it('AuthProvider runs it once per page load', () => {
    const src = readFileSync(join(process.cwd(), 'src/context/auth-context.tsx'), 'utf8')
    expect(src).toContain('useEffect(() => { clearRetiredDeviceKeys() }, [])')
  })
})
