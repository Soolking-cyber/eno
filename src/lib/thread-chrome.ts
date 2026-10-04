import { TEACHER_LISTING_TYPE } from '@/lib/teachers/constants'

/**
 * THE CONVERSATION THREAD'S CHROME — which pages lose the site header on a phone, the header that then
 * owns the top of the screen, and the item strip's gates (UX program 2, A7: inbox-01 / inbox-03).
 * Pure, so the layout, the thread page, its loading skeleton and the tests read ONE definition.
 */

/**
 * A real conversation thread: /messages/<conversation id>. Below lg the messages layout drops the site
 * header there, because the thread header already carries Back, the counterpart and Report (si-05: on a
 * real iPhone the messages got 352 of 654px).
 * ⛔ AN ALLOW-LIST BY ID FORMAT, NOT A DENY-LIST OF SIBLINGS. src/app/[lang]/messages/ holds the inbox
 * (page.tsx), the thread ([id]/page.tsx + loading.tsx), the eno AI chat (ai/) and the composer's resolver
 * (pending/) — and only the thread's header owns the status-bar inset. A deny-list (`ai|pending`) would
 * hand the NEXT sibling route a screen with no site header and a Back under the status bar; matching the
 * id itself keeps every sibling, present or future, on the site header.
 * The id is Prisma's `cuid()` (Conversation.id `@default(cuid())`): 'c' + 24 lowercase letters / digits —
 * every one of the 39 production rows on 2026-10-04 (read-only count). A path that is not one (a mistyped
 * URL, the e2e seed's fixed 'e2e-conv-1') keeps the site header — the page still renders, just with the
 * chrome it had before this change. If the id default ever changes, change this with it.
 */
export function isConversationPath(pathname: string | null | undefined): boolean {
  return /^\/messages\/c[a-z0-9]{24}(?:\/|$)/.test(pathname || '')
}

/**
 * The thread header's box — shared by the page, its loading skeleton and its guest / not-found states so
 * the swap between them never moves on native.
 * ⚠️ BELOW lg THIS IS THE TOP OF THE SCREEN (see isConversationPath), so it owns the status-bar inset the
 * site header used to pad: `0.75rem + max(0, inset − banner)` — the same py-3 breathing room BELOW the
 * inset that the rest of the bar has, never flush against the notch. `--banner-h` on <html>
 * (keyboard-viewport-sync.tsx) is 0px with no banner AND on native (where the banner is display:none), and
 * the banner's height otherwise — a height that already includes its own inset, so `inset − banner` goes
 * negative and the header keeps its plain 0.75rem (the double-gap rule globals.css applies to #app-header).
 * The `--safe-area-inset-top` term is the older-Android-WebView path, as in `html.native #app-header`;
 * it is undefined (0) everywhere else.
 * ⛔ NO `:has()` for "is there a banner": design-lint bans a document-level :has() (it restyles the whole
 * document on every DOM insertion), and `--banner-h` already answers the question.
 */
export const THREAD_HEADER_CLASS =
  'flex items-center gap-3 bg-background px-4 py-3 max-lg:pt-[calc(0.75rem+max(0px,calc(env(safe-area-inset-top)-var(--banner-h,0px)),calc(var(--safe-area-inset-top,0px)-var(--banner-h,0px))))]'

/** What the strip's gates read off the thread payload (the page's Thread type is wider). */
export type StripThread = {
  iAmSeller?: boolean
  /** The server's thread kind — 'listing' for an ordinary marketplace chat; the desks have their own;
   *  null/absent until the server has said (a cached or listing-less payload). */
  kind?: string | null
  /** `null` = the server says this is NOT a teacher thread; absent = a cached payload that predates it. */
  teacher?: unknown
  sellerIsPartner?: boolean
  listing: { negotiable?: boolean; status?: string; listingType?: string | null } | null
  messages: readonly { mine: boolean }[]
}

export type StripGates = {
  /** The item strip renders at all. */
  strip: boolean
  /** The listing is on sale (an absent status is an older cached payload → treated as live). */
  listingLive: boolean
  /** The buyer's 'Trả giá' in the strip. */
  offer: boolean
  /** The seller's 'Đã bán' in the strip. */
  sold: boolean
  /** The buyer's 'Lấy số' (contact reveal) in the strip. */
  contact: boolean
  /** The composer's tag button (the offer-mode toggle). */
  composerTag: boolean
}

/**
 * THE ITEM STRIP'S GATES (inbox-03) — the one place they are decided.
 *
 * ⛔ `offer` CARRIES THE COMPOSER'S OWN GATE, `negotiable !== false` (undefined = an older cached thread →
 * allow; the server refuses a fixed-price offer with 409 and docks the buyer's trust anyway), plus a live
 * listing and the buyer's side. It only MOVES the entry point: it opens the same offer composer the tag
 * button did, whose Send, slider and Counter gating are untouched.
 * ⛔ `composerTag`: while the strip offers, the tag is only the way back OUT of offer mode — and on a listing
 * that is no longer live it is the same (an offer there answers 409 listing_unavailable). The seller side
 * keeps it on a live negotiable listing, as before.
 * ⛔ `sold` ONLY ON AN ORDINARY MARKETPLACE THREAD — `kind === 'listing'` POSITIVELY (a cached thread with no
 * kind shows nothing until the server answers). The visa and trip desks are sellers too, and one tap would
 * take a desk product off sale; a job or a teacher profile is not "sold" at all (owner 2026-10-01: a job
 * is not a sale).
 * `contact`: only in the state where the reveal is a BUTTON — the counterpart has replied and nothing is
 * revealed yet; never to an official partner (chat-only by agreement) or on a teacher thread (its own strip).
 * ⛔ `strip` ON THE MARKETPLACE: ordinary listing threads only (`kind === 'listing'`). The thread route already
 * 404s eno's own visa/trip-desk threads on eno.vn (edition-scope.ts hides the desk sellers) and threadKind
 * fails closed to 'listing' there unless a partner desk is deliberately enabled — so a desk product's cover
 * and price cannot reach eno.vn through this strip today. This keeps it true by construction should either
 * of those configurations change (legal boundary: no visa / itinerary product surface on eno.vn).
 * `productThreadStrip` = the services edition, where the desks are legitimate.
 */
export function threadStripGates(
  thread: StripThread | null | undefined,
  { contactRevealed, showOffer, productThreadStrip }: { contactRevealed: boolean; showOffer: boolean; productThreadStrip: boolean },
): StripGates {
  const listing = thread?.listing ?? null
  const strip = !!listing && (productThreadStrip || thread?.kind === 'listing')
  const listingLive = !listing?.status || listing.status === 'active'
  const negotiable = !!listing && listing.negotiable !== false
  const offer = strip && negotiable && !thread?.iAmSeller && listingLive
  const sold = strip && !!thread?.iAmSeller && thread.kind === 'listing' && listing?.status === 'active' &&
    listing.listingType !== 'job' && listing.listingType !== TEACHER_LISTING_TYPE
  const contact = strip && !!thread && thread.teacher === null && !thread.iAmSeller && !contactRevealed &&
    !thread.sellerIsPartner && thread.messages.some((m) => !m.mine)
  const composerTag = negotiable && (showOffer || (listingLive && !offer))
  return { strip, listingLive, offer, sold, contact, composerTag }
}
