import { useSyncExternalStore } from 'react'
import {
  RENTAL_CHECK_CATEGORY_SLUG,
  RENTAL_CHECK_CHANNELS,
  RENTAL_CHECK_ID_RE,
  RENTAL_CHECK_MAX_ITEMS,
  RENTAL_CHECK_MAX_REQUIREMENTS,
  RENTAL_CHECK_REQUEST_ID_RE,
  type AvailabilityRequestItem,
  type RentalCheckChannel,
} from './shared'

/**
 * THE AVAILABILITY-CHECK BASKET — up to five rentals a visitor wants the eno team to check, kept on
 * THIS DEVICE (owner, 2026-09-25: guests collect first, sign in only at "Check these for me").
 *
 * ⚠️ STRICTLY-NECESSARY STORAGE, SO NOT CONSENT-GATED. The basket and the draft exist only because
 * the visitor asked for them, hold nothing about anyone else, and are never read by a server. That
 * is the same footing favorites-context.tsx keeps its device-local saved set on.
 *
 * ⛔ THE IN-MEMORY COPY IS THE SOURCE OF TRUTH INSIDE A TAB; localStorage IS BEST-EFFORT. Every
 * storage call is wrapped, because private mode, a full quota, blocked site data and the thumbnail
 * capture all throw or come back empty — and a basket that dies with them would make the card chip
 * a button that does nothing. A tab without storage still collects and sends; it just forgets on
 * reload.
 *
 * ⚠️ ONE STORE, MANY SUBSCRIBERS. Every rental card on a feed subscribes (48 on a grid), so a
 * snapshot is never re-parsed per read: `memory` is the parsed array, invalidated only by this
 * tab's own writes and by the `storage` event another tab fires. `useInRentalBasket` returns a
 * BOOLEAN, so a memo'd card re-renders only when ITS OWN id enters or leaves the basket.
 */

export const BASKET_KEY = 'eno:rental-check:v1'
export const DRAFT_KEY = 'eno:rental-check-draft:v1'
/** The "first add this session" toast flag. sessionStorage, so a new visit hears it again. */
export const HINT_KEY = 'eno:rental-check:hinted'
export const DRAFT_TTL_MS = 7 * 24 * 60 * 60 * 1000
export const INTENT_TTL_MS = 15 * 60 * 1000

export type BasketItem = AvailabilityRequestItem & { addedAt: number }

/** What a card or PDP hands the basket. A full SerializedListingCard satisfies it. */
export type RentalCheckSource = {
  id: string
  title: string
  titleVi?: string | null
  images?: string[] | null
  price: number
  currency: string
  priceUnit: string
  category?: { slug: string } | null
}

/**
 * ⛔ A CONSTANT, AND THE SAME ONE EVERY TIME — the server snapshot for useSyncExternalStore. The
 * rental cards are baked into ISR HTML; the server has no basket, so every card must hydrate as
 * "not added" and only then read this device. A fresh `[]` per call would also make React treat
 * every render as a store change.
 */
const EMPTY: readonly BasketItem[] = Object.freeze([]) as readonly BasketItem[]

const str = (v: unknown, max: number): string | null =>
  typeof v === 'string' && v.length > 0 && v.length <= max ? v : null

/** Only an absolute https URL or a same-origin path — never a `javascript:` or data URL from a tampered store. */
const safeImage = (v: unknown): string | null => {
  const s = str(v, 512)
  return s && /^(https:\/\/|\/(?!\/))/.test(s) ? s : null
}

/** One stored row, re-validated on the way in: localStorage is user-writable. */
function cleanItem(x: unknown): BasketItem | null {
  if (!x || typeof x !== 'object') return null
  const o = x as Record<string, unknown>
  const id = typeof o.id === 'string' && RENTAL_CHECK_ID_RE.test(o.id) ? o.id : null
  const title = str(o.title, 300)
  const price = typeof o.price === 'number' && Number.isFinite(o.price) && o.price >= 0 ? o.price : null
  const currency = str(o.currency, 8)
  const priceUnit = typeof o.priceUnit === 'string' && o.priceUnit.length <= 32 ? o.priceUnit : null
  if (!id || !title || price === null || !currency || priceUnit === null) return null
  return {
    id,
    title,
    titleVi: str(o.titleVi, 300),
    image: safeImage(o.image),
    price,
    currency,
    priceUnit,
    addedAt: typeof o.addedAt === 'number' && Number.isFinite(o.addedAt) ? o.addedAt : 0,
  }
}

/** Parse, dedupe by id (first wins), cap at the contract's five. Anything malformed is an empty basket. */
export function parseBasket(raw: string | null): BasketItem[] {
  if (!raw) return []
  let parsed: unknown
  try { parsed = JSON.parse(raw) } catch { return [] }
  const list = parsed && typeof parsed === 'object' && (parsed as { v?: unknown }).v === 1
    ? (parsed as { items?: unknown }).items
    : null
  if (!Array.isArray(list)) return []
  const seen = new Set<string>()
  const out: BasketItem[] = []
  for (const x of list) {
    const item = cleanItem(x)
    if (!item || seen.has(item.id)) continue
    seen.add(item.id)
    out.push(item)
    if (out.length === RENTAL_CHECK_MAX_ITEMS) break
  }
  return out
}

/** A listing → a basket row, or null when it is not a rental (the basket holds rentals only). */
export function basketItemFrom(l: RentalCheckSource, now = Date.now()): BasketItem | null {
  if (l.category?.slug !== RENTAL_CHECK_CATEGORY_SLUG) return null
  return cleanItem({
    id: l.id,
    title: l.title,
    titleVi: l.titleVi ?? null,
    image: l.images?.[0] ?? null,
    price: l.price,
    currency: l.currency,
    priceUnit: l.priceUnit,
    addedAt: now,
  })
}

// ── the external store ────────────────────────────────────────────────────────────────────────

let memory: BasketItem[] | null = null
const listeners = new Set<() => void>()

function emit(): void {
  for (const l of Array.from(listeners)) l()
}

function load(): BasketItem[] {
  if (memory) return memory
  let raw: string | null = null
  try { raw = localStorage.getItem(BASKET_KEY) } catch { /* storage unavailable — an empty basket */ }
  memory = parseBasket(raw)
  return memory
}

function commit(next: BasketItem[]): void {
  memory = next
  try {
    if (next.length) localStorage.setItem(BASKET_KEY, JSON.stringify({ v: 1, items: next }))
    else localStorage.removeItem(BASKET_KEY)
  } catch { /* best-effort — the in-memory basket still works for this tab */ }
  emit()
}

/** Another tab changed the basket (or cleared all storage: `key === null`). Re-read lazily. */
function onStorage(e: StorageEvent): void {
  if (e.key !== null && e.key !== BASKET_KEY) return
  memory = null
  emit()
}

let storageBound = false
export function subscribeBasket(cb: () => void): () => void {
  listeners.add(cb)
  if (!storageBound && typeof window !== 'undefined') {
    window.addEventListener('storage', onStorage)
    storageBound = true
  }
  return () => {
    listeners.delete(cb)
    if (listeners.size === 0 && storageBound && typeof window !== 'undefined') {
      window.removeEventListener('storage', onStorage)
      storageBound = false
    }
  }
}

export function getBasket(): readonly BasketItem[] {
  if (typeof window === 'undefined') return EMPTY
  return load()
}

const getServerBasket = (): readonly BasketItem[] => EMPTY

export type AddResult = 'added' | 'exists' | 'full' | 'refused'

export function addToBasket(l: RentalCheckSource): AddResult {
  const item = basketItemFrom(l)
  if (!item) return 'refused'
  const cur = load()
  if (cur.some((i) => i.id === item.id)) return 'exists'
  if (cur.length >= RENTAL_CHECK_MAX_ITEMS) return 'full'
  commit([...cur, item])
  return 'added'
}

export function removeFromBasket(id: string): void {
  const cur = load()
  if (!cur.some((i) => i.id === id)) return
  commit(cur.filter((i) => i.id !== id))
}

export function clearBasket(): void {
  commit([])
}

/** The whole basket. Re-renders on any change — for the list page and the pill. */
export function useRentalBasket(): readonly BasketItem[] {
  return useSyncExternalStore(subscribeBasket, getBasket, getServerBasket)
}

/** One id's membership as a boolean, so a memo'd card only re-renders when ITS answer flips. */
export function useInRentalBasket(id: string): boolean {
  return useSyncExternalStore(
    subscribeBasket,
    () => getBasket().some((i) => i.id === id),
    () => false,
  )
}

/** The count alone — a number is a stable snapshot, so a count-only consumer skips unrelated edits. */
export function useRentalBasketCount(): number {
  return useSyncExternalStore(subscribeBasket, () => getBasket().length, () => 0)
}

export function useRentalCheck() {
  const items = useRentalBasket()
  return {
    items,
    count: items.length,
    has: (id: string) => items.some((i) => i.id === id),
    add: addToBasket,
    remove: removeFromBasket,
    clear: clearBasket,
  }
}

// ── the draft + the sign-in intent ───────────────────────────────────────────────────────────

/**
 * `fp` is a fingerprint of WHAT was pressed (rentals, requirements, normalised contact). The id is
 * reused only for the same content: the server dedupes on the id alone, so a retry after the visitor
 * changed the list would otherwise return the EARLIER card as if it were the new request.
 */
export type RentalCheckIntent = { clientRequestId: string; at: number; fp?: string }
export type RentalCheckDraft = {
  requirements: string
  channel: RentalCheckChannel
  value: string
  savedAt: number
  /**
   * Present between "Check these for me" and the server's answer. Its id is the request's
   * idempotency key: every retry — the auto-submit after sign-in, a second tab opened by a magic
   * link, a network retry — sends the SAME id, so the eno team gets one card, not three.
   */
  pending?: RentalCheckIntent
  /**
   * The account the draft was written under, or null for a guest. ⛔ A SHARED DEVICE IS THE CASE THIS
   * EXISTS FOR: a number typed while signed in as A must not be restored into B's form (or a
   * signed-out visitor's) after A signs out. A guest draft (null) restores for anyone — that is the
   * guest → sign-in flow this whole draft exists to carry.
   */
  owner?: string | null
}

/**
 * The saved form, or null. ⚠️ TWO CLOCKS: the draft lives 7 days (someone comes back to finish),
 * the intent 15 minutes (only a sign-in round trip may resume a send on its own — an hour later a
 * surprise send is not what anybody asked for). An expired intent is dropped, the draft kept.
 */
export function readDraft(now = Date.now()): RentalCheckDraft | null {
  let raw: string | null = null
  try { raw = localStorage.getItem(DRAFT_KEY) } catch { return null }
  if (!raw) return null
  let o: Record<string, unknown>
  try { o = JSON.parse(raw) } catch { return null }
  if (!o || typeof o !== 'object') return null
  const savedAt = typeof o.savedAt === 'number' && Number.isFinite(o.savedAt) ? o.savedAt : null
  if (savedAt === null || now - savedAt > DRAFT_TTL_MS || savedAt - now > INTENT_TTL_MS) {
    clearDraft()
    return null
  }
  const channel = (RENTAL_CHECK_CHANNELS as readonly string[]).includes(o.channel as string)
    ? (o.channel as RentalCheckChannel)
    : 'whatsapp'
  const draft: RentalCheckDraft = {
    requirements: typeof o.requirements === 'string' ? o.requirements.slice(0, RENTAL_CHECK_MAX_REQUIREMENTS) : '',
    channel,
    value: typeof o.value === 'string' ? o.value.slice(0, 254) : '',
    savedAt,
    owner: typeof o.owner === 'string' && o.owner.length > 0 && o.owner.length <= 64 ? o.owner : null,
  }
  const p = o.pending as Record<string, unknown> | undefined
  if (
    p && typeof p === 'object'
    && typeof p.clientRequestId === 'string' && RENTAL_CHECK_REQUEST_ID_RE.test(p.clientRequestId)
    && typeof p.at === 'number' && now - p.at <= INTENT_TTL_MS && p.at - now <= INTENT_TTL_MS
  ) {
    draft.pending = {
      clientRequestId: p.clientRequestId,
      at: p.at,
      ...(typeof p.fp === 'string' && p.fp.length <= 64 ? { fp: p.fp } : {}),
    }
  }
  return draft
}

export function writeDraft(d: Omit<RentalCheckDraft, 'savedAt'>, now = Date.now()): void {
  try { localStorage.setItem(DRAFT_KEY, JSON.stringify({ ...d, savedAt: now })) } catch { /* best-effort */ }
}

export function clearDraft(): void {
  try { localStorage.removeItem(DRAFT_KEY) } catch { /* best-effort */ }
}

/**
 * A short, stable fingerprint of a request's CONTENT (not its id) — FNV-1a over the JSON. Collisions
 * only matter between two presses on one device within 15 minutes, so 32 bits is plenty.
 */
export function requestFingerprint(content: { listingIds: string[]; requirements: string; channel: string; value: string }): string {
  const s = JSON.stringify([content.listingIds, content.requirements, content.channel, content.value])
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h.toString(16).padStart(8, '0')
}

/** One id per logical submit. `randomUUID` where it exists; the fallback only has to be unique per device. */
export function newClientRequestId(): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  } catch { /* insecure context — fall through */ }
  return `r${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`
}

let hintedInMemory = false
/**
 * True exactly once per browser session: the first add explains what the basket is and that it is
 * free. Later adds stay quiet — the chip and the pill already say it happened.
 */
export function takeFirstAddHint(): boolean {
  if (hintedInMemory) return false
  hintedInMemory = true
  try {
    if (sessionStorage.getItem(HINT_KEY)) return false
    sessionStorage.setItem(HINT_KEY, '1')
  } catch { /* no sessionStorage — the in-memory flag still makes it once per page life */ }
  return true
}

/** Test seam: forget the in-memory copies so a test can start from a given storage state. */
export function __resetRentalCheckStoreForTests(): void {
  memory = null
  hintedInMemory = false
}
