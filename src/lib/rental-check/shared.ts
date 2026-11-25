/**
 * THE RENTAL AVAILABILITY CHECK'S CARD CONTRACT — READ-ONLY SINCE 2026-11-25.
 *
 * The renters' availability check (a person collected up to five rentals and pressed "Check these for me"; the eno team
 * checked them with the landlords and answered in /messages) was removed on 2026-11-25 (owner: "remove the check availability
 * feature entirely"). What stays is what the requests already in people's threads need to keep reading as the card they were:
 * the card's shape (messages.ts re-validates it strictly on read) and the contact link the operator taps
 * (availability-request-card.tsx). Nothing here can send a request any more.
 *
 * ⚠️ PURE AND CLIENT-SAFE, ON PURPOSE: the thread card imports this file in the browser. Its one dependency is the phone
 * normaliser — the SAME one the OTP router uses, so a stored number reads identically everywhere.
 */
import { isVietnamesePhone, normalizePhoneForRouting } from '../phone'

export const RENTAL_CHECK_MAX_ITEMS = 5
export const RENTAL_CHECK_MAX_REQUIREMENTS = 1000
export const RENTAL_CHECK_CHANNELS = ['zalo', 'whatsapp', 'email'] as const
export type RentalCheckChannel = typeof RENTAL_CHECK_CHANNELS[number]
/** A Listing id — cuid or seed id. No spaces and no punctuation, so it can carry no free text. */
export const RENTAL_CHECK_ID_RE = /^[A-Za-z0-9_-]{1,64}$/
/** One per LOGICAL submit, reused on every retry — the durable dedupe key (see the route). */
export const RENTAL_CHECK_REQUEST_ID_RE = /^[A-Za-z0-9_-]{8,64}$/

export type RentalContactProblem = 'empty' | 'zalo_needs_vn_mobile' | 'phone_invalid' | 'email_invalid'

/**
 * ⚠️ STRICTER THAN "ONE @ AND A DOT", DELIBERATELY. The value is rendered to the operator as a
 * `mailto:` link, so a character that is structural in a URL — `?`, `#`, `&` — would let a typed
 * "address" smuggle `?body=…` or `?cc=…` into the operator's mail client. Those, the quote and
 * angle-bracket family, path separators and control characters are refused outright; no real
 * mailbox a person types into a form needs them.
 */
const EMAIL_UNSAFE = String.raw`\s@?#&<>"'\\/,;:()[\]%\u0000-\u001f\u007f`
const EMAIL_RE = new RegExp(`^[^${EMAIL_UNSAFE}]+@[^${EMAIL_UNSAFE}]+\\.[^${EMAIL_UNSAFE}]{2,}$`)
/** A dialable international number: E.164 caps at 15 digits, and nothing real is under 8. */
const WHATSAPP_DIGITS_RE = /^\d{8,15}$/
/** Raw input is bounded before any parsing, so a pasted essay costs nothing. */
const RAW_MAX = 320

/**
 * Normalise what a person typed into the one form the card stores and the operator dials.
 *
 *   zalo     → '84xxxxxxxxx'. A Vietnamese MOBILE only — Zalo is a Vietnamese app keyed on a VN
 *              number, so a foreign number here is not a typo we can fix, it is the wrong channel.
 *   whatsapp → international digits, no '+' (wa.me wants exactly that).
 *   email    → trimmed, lowercased.
 *
 * ⛔ IDEMPOTENT, AND THE SERVER DEPENDS ON IT: `normalise(normalise(x).value) === normalise(x).value`.
 * The stored card must hold a FIXED POINT, so a value re-read from the database normalises to
 * itself and the card schema can refuse anything that does not.
 * ⚠️ THAT IS WHY A 9-DIGIT WHATSAPP NUMBER IS REFUSED. `normalizePhoneForRouting` reads bare nine
 * digits as a Vietnamese mobile typed without its 0 and prefixes 84 — the right call for the form,
 * where that is what people type. So '+376 312345' (Andorra) normalises to '376312345', and that
 * re-normalises to '84376312345': not a fixed point, and a card storing it would dial the wrong
 * country on the second read. Nine-digit international numbers are rare enough here that refusing
 * them is the honest trade; the person can pick Email instead.
 */
export function normaliseRentalContact(
  channel: RentalCheckChannel,
  raw: string,
): { ok: true; value: string } | { ok: false; reason: RentalContactProblem } {
  const s = typeof raw === 'string' ? raw.trim() : ''
  if (!s) return { ok: false, reason: 'empty' }
  if (channel === 'email') {
    const v = s.toLowerCase()
    return v.length <= 254 && EMAIL_RE.test(v) ? { ok: true, value: v } : { ok: false, reason: 'email_invalid' }
  }
  if (s.length > RAW_MAX) return { ok: false, reason: channel === 'zalo' ? 'zalo_needs_vn_mobile' : 'phone_invalid' }
  const d = normalizePhoneForRouting(s)
  if (channel === 'zalo') {
    return isVietnamesePhone(d) ? { ok: true, value: d } : { ok: false, reason: 'zalo_needs_vn_mobile' }
  }
  if (channel === 'whatsapp') {
    return WHATSAPP_DIGITS_RE.test(d) && normalizePhoneForRouting(d) === d
      ? { ok: true, value: d }
      : { ok: false, reason: 'phone_invalid' }
  }
  return { ok: false, reason: 'empty' }
}

/**
 * The deep link the operator taps. Built from the NORMALISED value only — anything that does not
 * normalise yields the bare scheme, never a link carrying unvetted text.
 */
export function rentalContactHref(channel: RentalCheckChannel, value: string): string {
  const n = normaliseRentalContact(channel, value)
  const v = n.ok ? n.value : ''
  if (channel === 'zalo') return `https://zalo.me/${v}`
  if (channel === 'whatsapp') return `https://wa.me/${v}`
  return `mailto:${v}`
}

/** One rental as the card shows it — snapshotted SERVER-SIDE from the database when it was sent. */
export type AvailabilityRequestItem = {
  id: string
  title: string
  titleVi: string | null
  image: string | null
  price: number
  currency: string
  priceUnit: string
}

export type AvailabilityRequestMeta = {
  v: 1
  /** = clientRequestId (durable dedupe + audit). */
  requestId: string
  /** 1..5 unique ids, snapshotted SERVER-SIDE from the DB at send time. */
  items: AvailabilityRequestItem[]
  /** 0..1000, '' when none. */
  requirements: string
  /** The normalised form — a fixed point of normaliseRentalContact. */
  contact: { channel: RentalCheckChannel; value: string }
  /** The edition it was sent from. */
  origin: 'vn' | 'forum'
  /** The requester's UI language at send time. */
  lang: 'en' | 'vi'
}
