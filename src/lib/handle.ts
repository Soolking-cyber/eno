import 'server-only'
import { db } from './db'
import { HANDLE_RE, validateHandle, slugifyHandle } from './handle-format'

// ── Public @handles (Telegram-style) ─────────────────────────────────────────────
// "Alex Doe" → @alex_doe, "Apple Store" → @apple_store. ONE namespace for users and
// storefronts (model Handle: the name is the PK, so uniqueness is a DB guarantee).
// Shareable as eno.vn/<@handle> — resolved by src/app/[handle]/page.tsx.
// Pure rules (regex, reserved list, slugify) live in ./handle-format (client-safe).

export { HANDLE_RE, validateHandle, slugifyHandle, isReservedHandle } from './handle-format'

/** First free variant of `base`: base, base1 … base98, then base_<4 random digits>
 *  ("alex" taken → "alex1"). One indexed IN-query instead of N lookups; the caller's
 *  CREATE is still the only authority (a concurrent claim just makes it retry). */
export async function generateUniqueHandle(base: string): Promise<string> {
  const b = slugifyHandle(base)
  const candidates = [b, ...Array.from({ length: 98 }, (_, i) => `${b.slice(0, 28)}${i + 1}`)]
    .filter((c) => validateHandle(c) === null)
  const taken = new Set(
    (await db.handle.findMany({ where: { handle: { in: candidates } }, select: { handle: true } })).map((r) => r.handle),
  )
  for (const c of candidates) if (!taken.has(c)) return c
  return `${b.slice(0, 25)}_${Math.floor(1000 + Math.random() * 9000)}`
}

export type HandleOwner = { profileId: string } | { sellerId: string }

/** Claim (or change to) `handle` for exactly one owner. Frees the owner's previous
 *  name in the same transaction. Throws 'taken' | 'invalid' | 'reserved'. */
export async function claimHandle(owner: HandleOwner, rawHandle: string): Promise<string> {
  const h = rawHandle.trim().toLowerCase().replace(/^@/, '')
  const err = validateHandle(h)
  if (err) throw new Error(err)
  try {
    await db.$transaction(async (tx) => {
      // Same owner re-claiming their current name → no-op.
      const existing = await tx.handle.findUnique({ where: 'profileId' in owner ? { profileId: owner.profileId } : { sellerId: owner.sellerId } })
      if (existing?.handle === h) return
      if (existing) await tx.handle.delete({ where: { handle: existing.handle } })
      await tx.handle.create({ data: { handle: h, ...owner } })
    })
  } catch (e) {
    // PK collision = someone owns it. (The tx rolled back, so a failed CHANGE keeps
    // the previous name — the delete above never commits without the create.)
    if ((e as { code?: string })?.code === 'P2002') throw new Error('taken')
    throw e
  }
  return h
}

/** ONE handle per account: when a profile owns a storefront, the single public handle
 *  lives on the SELLER (the shop is what people share). This frees any handle the
 *  profile itself held — so a business account never ends up with two (a personal
 *  @name AND a shop @name). Prefers a shop-name handle; transfers the profile's row
 *  in place when it already matches (keeps the clean name). Best-effort; never throws.
 *  A guest storefront (no profileId) just auto-claims a shop handle. */
export async function consolidateSellerHandle(
  sellerId: string,
  sellerName: string | null | undefined,
  profileId: string | null | undefined,
): Promise<void> {
  try {
    const shopHandle = await db.handle.findUnique({ where: { sellerId }, select: { handle: true } })
    const profileHandle = profileId
      ? await db.handle.findUnique({ where: { profileId }, select: { handle: true } })
      : null

    // Shop already has its handle → just make sure the profile isn't also holding one.
    if (shopHandle) {
      if (profileHandle) await db.handle.delete({ where: { handle: profileHandle.handle } }).catch(() => {})
      return
    }

    // Shop needs a handle. If the profile's handle already equals the shop-name slug,
    // move that row to the shop in place (atomic, keeps the clean name).
    const desired = slugifyHandle(sellerName)
    if (profileHandle && profileHandle.handle === desired) {
      await db.handle.update({ where: { handle: desired }, data: { profileId: null, sellerId } })
      return
    }

    // Otherwise claim a fresh shop-name handle, THEN release the profile's (claim-first
    // so a failure never leaves the account with no handle at all).
    await autoClaimHandle({ sellerId }, sellerName)
    if (profileHandle) await db.handle.delete({ where: { handle: profileHandle.handle } }).catch(() => {})
  } catch (e) {
    console.error('[handle] consolidate failed', { sellerId, profileId }, (e as Error).message)
  }
}

/** Business → individual ("delete the business"): free the SHOP's business-name handle
 *  and restore a PERSONAL handle on the profile. Prefers the exact display-name slug
 *  ("Alex" → alex); if that's already taken, takes the first free numbered variant
 *  (alex → alex1) — the user can still rename it in Settings. Mirror image of
 *  consolidateSellerHandle. Best-effort; never throws. */
export async function revertToPersonalHandle(
  profileId: string,
  sellerId: string | null | undefined,
  displayName: string | null | undefined,
): Promise<void> {
  try {
    // Free the shop's handle — the account is no longer a business.
    if (sellerId) {
      const shop = await db.handle.findUnique({ where: { sellerId }, select: { handle: true } })
      if (shop) await db.handle.delete({ where: { handle: shop.handle } }).catch(() => {})
    }
    // Already holding a personal handle → nothing to restore.
    const existing = await db.handle.findUnique({ where: { profileId }, select: { handle: true } })
    if (existing) return
    // Claim the name (or its first free numbered variant) back onto the profile.
    await autoClaimHandle({ profileId }, displayName)
  } catch (e) {
    console.error('[handle] revert-to-personal failed', { profileId, sellerId }, (e as Error).message)
  }
}

/** Best-effort auto-claim at signup / storefront creation — NEVER throws (a handle
 *  is a nicety; account/listing creation must not fail on it). Skips owners that
 *  already have one. Retries once on a lost race. */
export async function autoClaimHandle(owner: HandleOwner, baseName: string | null | undefined): Promise<void> {
  try {
    const existing = await db.handle.findUnique({
      where: 'profileId' in owner ? { profileId: owner.profileId } : { sellerId: owner.sellerId },
      select: { handle: true },
    })
    if (existing) return
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        await claimHandle(owner, await generateUniqueHandle(baseName || 'user'))
        return
      } catch (e) {
        if ((e as Error).message !== 'taken') throw e // lost the race → regenerate once
      }
    }
  } catch (e) {
    console.error('[handle] auto-claim failed', owner, (e as Error).message)
  }
}
