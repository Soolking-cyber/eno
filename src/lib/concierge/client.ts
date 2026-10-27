'use client'

import { useSyncExternalStore } from 'react'
import { isClassroomPath } from '@/lib/classroom/host'
import { isPostFlowPath } from '@/lib/post-flow-path'

/**
 * The voice concierge on the PAGE side — what the ✨ "Ask eno AI" buttons and the floating window's host share. The window
 * itself is a same-origin frame (/concierge — src/components/concierge/concierge-frame.tsx); this module is tiny and ships
 * with every page.
 */

/** The frame's own page. */
export const CONCIERGE_FRAME_PATH = '/concierge'
export const isConciergeFramePath = (pathname: string | null | undefined): boolean =>
  !!pathname && (pathname === CONCIERGE_FRAME_PATH || pathname.startsWith(`${CONCIERGE_FRAME_PATH}/`))

/**
 * Pages the window never floats over — they own the screen or the microphone: the classroom (its own app and its own face:
 * AvatarKit's session token is page-global), sign-in, the messenger (its composer owns the bottom-right corner), the post
 * flow, the admin, and the frame itself. Reaching one closes a live window (it never hides a running microphone).
 */
export function isConciergeHiddenPath(pathname: string | null | undefined): boolean {
  if (!pathname) return true
  return isConciergeFramePath(pathname) || isClassroomPath(pathname) || isPostFlowPath(pathname)
    || /^\/(?:signin|auth|messages|admin|teachers\/join|teachers\/edit)(?:\/|$)/.test(pathname)
}

/** May this account open the window now (GET /api/concierge/config, read by the host)? */
let available = false
const subs = new Set<() => void>()
export function setConciergeAvailable(v: boolean): void {
  if (available === v) return
  available = v
  subs.forEach((f) => f())
}
export const conciergeAvailable = (): boolean => available
export function useConciergeAvailable(): boolean {
  return useSyncExternalStore(
    (f) => { subs.add(f); return () => { subs.delete(f) } },
    () => available,
    () => false,
  )
}

/** The ✨ buttons open the window through this event (the header is rendered per page; the host lives in providers). */
export const CONCIERGE_OPEN_EVENT = 'eno:concierge-open'
export function openConcierge(): void {
  window.dispatchEvent(new Event(CONCIERGE_OPEN_EVENT))
}

/** The frame → host messages (postMessage, same origin; the host checks the sender is ITS frame). */
export type ConciergeMessage =
  | { type: 'eno-concierge:go'; href: string; closes: boolean }
  | { type: 'eno-concierge:close' }

/**
 * The paths a `go` may open — the explorer (`/`, `/vi`) with any query, a listing, or one of the fixed pages
 * (actions.ts CONCIERGE_PAGES — client.test.ts keeps the two lists equal). The server built the path; the host checks it
 * again because a message is only data: a relative same-origin path, nothing else. Null = ignore the message.
 */
const PAGE_PATHS = ['/post', '/teachers/join', '/messages', '/help', '/safety', '/trust', '/hcmc-rent-index', '/teach-in-vietnam', '/schools', '/saved']
const LISTING_PATH = /^\/listings\/c[a-z0-9]{20,30}$/
export function safeConciergeHref(href: unknown): string | null {
  if (typeof href !== 'string' || href.length > 2_000 || !href.startsWith('/') || href.startsWith('//') || href.includes('\\')) return null
  let u: URL
  try { u = new URL(href, 'https://eno.invalid') } catch { return null }
  if (u.origin !== 'https://eno.invalid' || u.hash) return null
  const p = u.pathname
  const explorer = p === '/' || p === '/vi'
  if (!explorer && u.search) return null
  if (!explorer && !LISTING_PATH.test(p) && !PAGE_PATHS.includes(p)) return null
  return `${p}${u.search}`
}
/** For the test that keeps the two lists equal. */
export const CONCIERGE_PAGE_PATHS: readonly string[] = PAGE_PATHS

/**
 * The area a `go` sets on the explorer (`eno:set-area`), as codes — or null to leave the person's own alone (review,
 * opus: the host cleared it on every `go`, so "cheaper ones" lost a picked ward and "near you", which no URL carries).
 * A href that names a place replaces the area with exactly that place; a page that named one the href dropped ("anywhere")
 * clears it; a href and a page that name none keep it.
 */
const PLACE_KEYS = ['province', 'district', 'ward'] as const
export function areaForGo(next: URLSearchParams, current: URLSearchParams): { province: string | null; ward: string | null } | null {
  const names = (q: URLSearchParams) => PLACE_KEYS.some((k) => q.has(k))
  if (!names(next) && !names(current)) return null
  const province = next.get('province')
  return { province, ward: province ? next.get('ward') : null }
}
