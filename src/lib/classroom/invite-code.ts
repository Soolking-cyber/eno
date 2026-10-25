/**
 * The one-use invite code in a seat's link (eno.vn/classroom/join/<code>). Client-safe: the join page checks the shape
 * before asking the server anything.
 *
 * 12 characters from a 31-letter alphabet with no look-alikes (no 0/o, 1/l/i) — read aloud or typed from a printed QR
 * label without mistakes — ≈ 59 bits: unguessable, and the join routes are rate-limited on top. The code only ever finds
 * a seat that is still `invited` and unexpired, and is cleared the moment it is claimed.
 */
export const INVITE_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789'
export const INVITE_CODE_LENGTH = 12

const SHAPE = new RegExp(`^[${INVITE_ALPHABET}]{${INVITE_CODE_LENGTH}}$`)

export function isInviteCodeShape(v: unknown): v is string {
  return typeof v === 'string' && SHAPE.test(v)
}

/** A fresh code from random bytes — rejection sampling, so every letter is equally likely. */
export function inviteCodeFrom(random: (n: number) => Uint8Array): string {
  const limit = 256 - (256 % INVITE_ALPHABET.length)
  let out = ''
  while (out.length < INVITE_CODE_LENGTH) {
    for (const b of random(INVITE_CODE_LENGTH * 2)) {
      if (b >= limit) continue
      out += INVITE_ALPHABET[b % INVITE_ALPHABET.length]
      if (out.length === INVITE_CODE_LENGTH) break
    }
  }
  return out
}

/**
 * A code as a person brings it — from a link, a QR or typed by hand — made the stored shape: trimmed and lowercased (iOS
 * capitalises the first letter typed; round 9, opus). Every entry point normalises before isInviteCodeShape.
 */
export function normalizeInviteCode(v: unknown): string {
  return typeof v === 'string' ? v.trim().toLowerCase() : ''
}
