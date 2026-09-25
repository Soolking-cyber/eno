/**
 * THE RENTAL AVAILABILITY CHECK — THE CONTRACT BOTH HALVES BUILD AGAINST.
 *
 * A person collects up to five rentals, adds what they need and one way to reach them, and presses
 * "Check these for me". The request becomes a card in a real conversation with the eno team, who
 * check the listings with the landlords for free and answer in /messages.
 *
 * ⚠️ PURE AND CLIENT-SAFE, ON PURPOSE. The basket, the checkout page and the thread card import
 * this file in the browser, and the route, the message gate and the card schema import it on the
 * server. That only works while it imports nothing but the phone normaliser — one server-only
 * import here and every client component that touches the basket becomes a build error. The phone
 * module is the one dependency, and it is the right one: it is the SAME normaliser the OTP router
 * uses, so the number a person types is read identically in the form and in the route.
 *
 * ⚠️ THE EXPORT LIST IS THE CONTRACT. The client half was written against exactly these names and
 * shapes; adding a field to a body or a meta here without the other side is a silent drift, because
 * the meta is re-validated STRICTLY on the server (an unknown key is a reject, not a pass-through).
 */
import { isVietnamesePhone, normalizePhoneForRouting } from '../phone'

export const RENTAL_CHECK_PATH = '/rentals/check'
export const RENTAL_CHECK_API = '/api/rental-check'
export const RENTAL_CHECK_MAX_ITEMS = 5
export const RENTAL_CHECK_MAX_REQUIREMENTS = 1000
export const RENTAL_CHECK_CATEGORY_SLUG = 'rentals'
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

export type RentalCheckRequestBody = {
  /** 1..5 unique after dedupe, each RENTAL_CHECK_ID_RE. */
  listingIds: string[]
  /** ≤1000 after trim; control characters stripped, \n kept; default ''. */
  requirements?: string
  /** Raw as typed — the server normalises. */
  contact: { channel: RentalCheckChannel; value: string }
  /** RENTAL_CHECK_REQUEST_ID_RE; one per logical submit, reused on every retry. */
  clientRequestId: string
  lang?: 'en' | 'vi'
}

export type RentalCheckOk = { conversationId: string; messageId: string; threadCreated: boolean; listingIds: string[] }

export type RentalCheckErrorBody =
  | { error: 'bad_request' } | { error: 'auth_required' } | { error: 'rate_limited' }
  | { error: 'invalid_contact'; reason: RentalContactProblem }
  | { error: 'listings_unavailable'; unavailable: string[] }
  | { error: 'send_in_flight' } | { error: 'desk_unavailable' } | { error: 'internal_error' }

/** One rental as the card shows it — snapshotted SERVER-SIDE from the database at send time. */
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
