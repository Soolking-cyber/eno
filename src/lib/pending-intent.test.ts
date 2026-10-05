// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { INTENT_TTL_MS as RENTAL_CHECK_TTL } from '@/lib/rental-check/store'
import { clearAccountDeviceStorage } from '@/lib/sign-out-storage'
import {
  INTENT_KEY,
  INTENT_TTL_MS,
  __resetPendingIntentForTests,
  armIntent,
  decideResume,
  discountFor,
  dropIntent,
  markIntentRouted,
  parseIntent,
  pathnameOf,
  readIntent,
  resumeKindFrom,
  stripResume,
  stripResumeFromAddress,
  takeIntent,
  withResume,
  writeIntent,
  type PendingIntent,
} from './pending-intent'

// ── UX3 J5: finish the action after sign-in — the rental check's resume pattern, shared ─────────────

const T0 = new Date('2026-10-05T09:00:00Z').getTime()

function memoryStorage() {
  const m = new Map<string, string>()
  return {
    getItem: (k: string) => (m.has(k) ? m.get(k)! : null),
    setItem: (k: string, v: string) => { m.set(k, String(v)) },
    removeItem: (k: string) => { m.delete(k) },
    clear: () => m.clear(),
    key: (i: number) => [...m.keys()][i] ?? null,
    get length() { return m.size },
  }
}

beforeEach(() => {
  vi.useFakeTimers({ now: T0 })
  vi.stubGlobal('sessionStorage', memoryStorage())
  __resetPendingIntentForTests()
  window.history.replaceState(null, '', '/')
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('pending-intent — the rental check’s window and id, shared (not a second pattern)', () => {
  it('⛔ the same 15-minute window as the rental check', () => {
    expect(INTENT_TTL_MS).toBe(RENTAL_CHECK_TTL)
    expect(INTENT_TTL_MS).toBe(15 * 60 * 1000)
  })
})

describe('pending-intent — storage', () => {
  it('writes to this tab’s sessionStorage, with a nonce, and reads back', () => {
    const it = writeIntent('chat', { listingId: 'l1', body: 'Chào bạn! Món này còn không?' }, '/listings/l1')
    expect(it.nonce).toMatch(/.{8,}/)
    expect(JSON.parse(sessionStorage.getItem(INTENT_KEY)!).kind).toBe('chat')
    expect(readIntent()).toEqual(it)
  })

  it('⛔ fresh for 15 minutes, then gone (and removed)', () => {
    writeIntent('saveSearch', { params: { q: 'sofa' } }, '/?q=sofa')
    vi.setSystemTime(T0 + INTENT_TTL_MS)
    expect(readIntent()).not.toBeNull()
    vi.setSystemTime(T0 + INTENT_TTL_MS + 1)
    expect(readIntent()).toBeNull()
    expect(sessionStorage.getItem(INTENT_KEY)).toBeNull()
  })

  it('⛔ the idempotency key: taken exactly once, then nothing for anyone', () => {
    const it = writeIntent('offer', { listingId: 'l1', offerAmount: 900_000 }, '/listings/l1')
    expect(takeIntent(it.nonce)).toBe(true)
    expect(takeIntent(it.nonce)).toBe(false)
    expect(readIntent()).toBeNull()
    // A stale copy written back (another code path, a restore) still cannot be honoured twice.
    sessionStorage.setItem(INTENT_KEY, JSON.stringify(it))
    expect(readIntent()).toBeNull()
    expect(takeIntent(it.nonce)).toBe(false)
  })

  it('a close drops only its own intent — never a newer ask’s', () => {
    const first = writeIntent('chat', { listingId: 'l1', body: 'hi' }, '/listings/l1')
    const second = writeIntent('chat', { listingId: 'l2', body: 'hi' }, '/listings/l2')
    dropIntent(first.nonce)
    expect(readIntent()?.nonce).toBe(second.nonce)
    dropIntent(second.nonce)
    expect(readIntent()).toBeNull()
  })

  it('arm and routed are recorded on the stored intent, and only for its own nonce', () => {
    const it = writeIntent('chat', { listingId: 'l1', body: 'hi' }, '/listings/l1')
    armIntent('someone-else')
    expect(readIntent()?.armed).toBeUndefined()
    armIntent(it.nonce)
    markIntentRouted(it.nonce)
    expect(readIntent()).toMatchObject({ armed: true, routed: true })
  })

  it('⛔ a failed WRITE (quota, a locked-down WebView) with reads still working: memory is the truth from then on', () => {
    const it = writeIntent('chat', { listingId: 'l1', body: 'hi' }, '/listings/l1', { away: true })
    armIntent(it.nonce)
    const store = sessionStorage as unknown as { setItem: (k: string, v: string) => void }
    const realSet = store.setItem
    store.setItem = () => { throw new Error('QuotaExceededError') }
    markIntentRouted(it.nonce)
    store.setItem = realSet
    // The stored copy (without `routed`) is gone or ignored; the memory copy, with it, is what is read.
    expect(readIntent()).toMatchObject({ armed: true, routed: true, away: true })
  })

  it('⛔ a stored path that is not this site\'s is no intent: "//evil" and "/\\evil" never reach router.push', () => {
    const at = Date.now()
    const base = { kind: 'chat', payload: { listingId: 'l1', body: 'hi' }, at, nonce: 'n1' }
    expect(parseIntent({ ...base, path: '/listings/l1' }, at)).not.toBeNull()
    for (const path of ['//evil.example', '/\\evil.example', '/\\/evil.example', 'https://evil.example/x', '/\t/evil.example']) {
      expect(parseIntent({ ...base, path }, at), path).toBeNull()
    }
  })

  it('⛔ sign-out clears the memory copy too: a failed write must not hand the action to the next account', () => {
    writeIntent('saveSearch', { params: { q: 'sofa' } }, '/?q=sofa')
    const store = sessionStorage as unknown as { setItem: (k: string, v: string) => void }
    const realSet = store.setItem
    store.setItem = () => { throw new Error('QuotaExceededError') }
    writeIntent('saveSearch', { params: { q: 'tủ lạnh' } }, '/?q=tủ lạnh') // memory is the truth from here
    store.setItem = realSet
    expect(readIntent()?.payload).toEqual({ params: { q: 'tủ lạnh' } })
    clearAccountDeviceStorage()
    expect(readIntent()).toBeNull()
  })

  it('a card’s intent says it finishes away from where it was asked', () => {
    expect(writeIntent('offer', { listingId: 'l1', offerAmount: 5 }, '/listings/l1', { away: true }).away).toBe(true)
    expect(readIntent()?.away).toBe(true)
    expect(writeIntent('offer', { listingId: 'l1', offerAmount: 5 }, '/listings/l1').away).toBeUndefined()
  })

  it('works with storage blocked — a memory copy carries it for the page’s life', () => {
    vi.stubGlobal('sessionStorage', { getItem: () => { throw new Error('blocked') }, setItem: () => { throw new Error('blocked') }, removeItem: () => { throw new Error('blocked') } })
    const it = writeIntent('chat', { listingId: 'l1', body: 'hi' }, '/listings/l1')
    expect(readIntent()?.nonce).toBe(it.nonce)
    expect(takeIntent(it.nonce)).toBe(true)
  })

  it('anything malformed is not an intent', () => {
    const ok = { kind: 'chat', payload: { listingId: 'l1', body: 'hi' }, at: T0, nonce: 'n1', path: '/listings/l1' }
    expect(parseIntent(ok, T0)).not.toBeNull()
    for (const bad of [
      null, 'x', { ...ok, kind: 'publish' }, { ...ok, at: T0 + 1 }, { ...ok, nonce: '' }, { ...ok, path: 'https://evil.example/' },
      { ...ok, payload: { listingId: '', body: 'hi' } }, { ...ok, payload: { listingId: 'l1', body: ' ' } },
      { ...ok, kind: 'offer', payload: { listingId: 'l1', offerAmount: -5 } },
      { ...ok, kind: 'saveSearch', payload: { params: [] } },
    ]) expect(parseIntent(bad, T0)).toBeNull()
    expect(parseIntent({ ...ok, kind: 'offer', payload: { listingId: 'l1', offerAmount: null } }, T0)).not.toBeNull()
  })
})

describe('pending-intent — the address', () => {
  it('`resume=<kind>` rides the next path, keeping its other params and hash', () => {
    expect(withResume('/listings/l1', 'chat')).toBe('/listings/l1?resume=chat')
    expect(withResume('/?q=sofa&category=furniture#listings', 'saveSearch')).toBe('/?q=sofa&category=furniture&resume=saveSearch#listings')
    expect(withResume('/listings/l1?resume=offer', 'chat')).toBe('/listings/l1?resume=chat')
  })

  it('reads only OUR kinds — the post wizard’s `resume=publish` is not ours and is left alone', () => {
    expect(resumeKindFrom('?resume=saveSearch')).toBe('saveSearch')
    expect(resumeKindFrom('?resume=publish')).toBeNull()
    expect(resumeKindFrom('?resume=<script>')).toBeNull()
    expect(stripResume('/post?resume=publish')).toBe('/post?resume=publish')
    expect(stripResume('/?q=sofa&resume=saveSearch#x')).toBe('/?q=sofa#x')
    expect(pathnameOf('/listings/l1?resume=chat#contact')).toBe('/listings/l1')
  })

  it('takes our marker out of the address bar once read, keeping the history state', () => {
    window.history.replaceState({ keep: 1 }, '', '/?q=sofa&resume=saveSearch')
    stripResumeFromAddress()
    expect(window.location.pathname + window.location.search).toBe('/?q=sofa')
    expect(window.history.state).toEqual({ keep: 1 })
  })

  it('⛔ a sign-in return is still recognised after another component rewrote the address — for that page, once', async () => {
    vi.resetModules()
    window.history.replaceState(null, '', '/?q=sofa&resume=saveSearch')
    const fresh = await import('./pending-intent') // evaluated as the landing document loads
    window.history.replaceState(null, '', '/?q=sofa') // e.g. the explorer re-wrote its query on mount
    expect(fresh.addressResumeKind()).toBe('saveSearch')
    window.history.replaceState(null, '', '/c/phones')
    expect(fresh.addressResumeKind()).toBeNull() // another page is not that sign-in return
    window.history.replaceState(null, '', '/?q=sofa')
    fresh.stripResumeFromAddress()
    expect(fresh.addressResumeKind()).toBeNull() // read once
  })

  it('an intent never stores the marker in its own path', () => {
    expect(writeIntent('saveSearch', { params: {} }, '/?q=a&resume=saveSearch').path).toBe('/?q=a')
  })
})

describe('pending-intent — when to act (decideResume)', () => {
  const chat = (over: Partial<PendingIntent> = {}): PendingIntent => ({ kind: 'chat', payload: { listingId: 'l1', body: 'hi' }, at: T0, nonce: 'n1', path: '/listings/l1', ...over } as PendingIntent)
  const mine = (it: PendingIntent) => (it.payload as { listingId: string }).listingId === 'l1'

  it('⛔ acts on a fresh intent of its own that the ADDRESS proves (a sign-in return in this tab)', () => {
    expect(decideResume({ urlKind: 'chat', intent: chat(), kinds: ['chat', 'offer'], matches: mine })).toEqual({ action: 'act', intent: chat() })
  })

  it('⛔ acts on one ARMED by a sign-in inside its own popup (the in-place code — no address to carry it)', () => {
    expect(decideResume({ urlKind: null, intent: chat({ armed: true }), kinds: ['chat'], matches: mine }).action).toBe('act')
  })

  it('⛔ never acts on an intent nobody proved: an abandoned gate followed by an unrelated sign-in', () => {
    expect(decideResume({ urlKind: null, intent: chat(), kinds: ['chat'], matches: mine })).toEqual({ action: 'none' })
  })

  it('⛔ `resume=` with nothing stored (a crafted link; another browser; a magic link’s new tab) → one confirming tap, never an act', () => {
    expect(decideResume({ urlKind: 'saveSearch', intent: null, kinds: ['saveSearch'], matches: () => true })).toEqual({ action: 'confirm', kind: 'saveSearch' })
  })

  it('…and the same when what is stored is someone else’s (another listing) or another kind', () => {
    const other = chat({ payload: { listingId: 'l2', body: 'hi' } })
    expect(decideResume({ urlKind: 'chat', intent: other, kinds: ['chat'], matches: mine })).toEqual({ action: 'confirm', kind: 'chat' })
    expect(decideResume({ urlKind: 'offer', intent: chat(), kinds: ['chat', 'offer'], matches: mine })).toEqual({ action: 'confirm', kind: 'offer' })
  })

  it('a kind this consumer does not finish is not its business', () => {
    expect(decideResume({ urlKind: 'saveSearch', intent: null, kinds: ['chat', 'offer'], matches: () => true })).toEqual({ action: 'none' })
  })
})

describe('pending-intent — a card’s amount on the PDP slider', () => {
  it('turns the chosen amount back into the composer’s discount, clamped to 0–50 %', () => {
    expect(discountFor(900_000, 1_000_000)).toBe(10)
    expect(discountFor(100_000, 1_000_000)).toBe(50)
    expect(discountFor(1_200_000, 1_000_000)).toBe(0)
    expect(discountFor(null, 1_000_000)).toBeNull()
    expect(discountFor(900_000, 0)).toBeNull()
  })
})
