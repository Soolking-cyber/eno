import 'server-only'
import { db } from './db'
import { HANDLE_RE, validateHandle, slugifyHandle } from './handle-format'

// ── Public @handles (Telegram-style) ─────────────────────────────────────────────
// "Alex Doe" → @alex_doe, "Apple Store" → @apple_store. ONE namespace for users and
// storefronts (model Handle: the name is the PK, so uniqueness is a DB guarantee).
// Shareable as eno.vn/<@handle> — resolved by src/app/[handle]/page.tsx.
// Pure rules (regex, reserved list, slugify) live in ./handle-format (client-safe).

export { HANDLE_RE, validateHandle, slugifyHandle, isReservedHandle } from './handle-format'

/** First free variant of `base`: base, base2 … base99, then base_<4 random digits>.
 *  One indexed IN-query instead of N lookups; the caller's CREATE is still the only
 *  authority (a concurrent claim just makes it retry). */
export async function generateUniqueHandle(base: string): Promise<string> {
  const b = slugifyHandle(base)
  const candidates = [b, ...Array.from({ length: 98 }, (_, i) => `${b.slice(0, 28)}${i + 2}`)]
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
