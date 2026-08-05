import { getVerifiedPhone } from '@/lib/admin'
// POST /api/listings seller resolution: attach a signed-in poster's listing to their
// Profile-owned storefront, or resolve/create a guest storefront by phone — with the
// one-number-one-account claim rules. Extracted verbatim from route.ts; returns a
// NextResponse (error) instead of a seller when a phone-claim rule rejects the post.
import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { phoneTakenByOther } from '@/lib/phone-unique'

// Resolve the storefront this listing belongs to. CRITICAL: a SIGNED-IN poster's
// listing must attach to THEIR Profile-owned Seller (ownerId) — otherwise it
// won't show in their dashboard and buyer messages (conversation.sellerProfileId
// = seller.ownerId) never reach them. Guests still resolve/create by phone.
export async function resolveSellerForPost(meId: string | null, contactPhone: string, contactName: string) {
  let seller
  if (meId) {
    const owned = await db.seller.findUnique({ where: { ownerId: meId } })
    if (owned) {
      seller = owned
      // Set OR update the contact phone on their storefront (the post wizard's inline
      // quick-edit) — but never one that already belongs to another account (any
      // format → normalized key).
      if (contactPhone && contactPhone !== owned.phone) {
        if (await phoneTakenByOther(contactPhone, meId)) return NextResponse.json({ error: 'phone_taken' }, { status: 409 })
        try {
          seller = await db.seller.update({ where: { id: owned.id }, data: { phone: contactPhone } })
        } catch {
          // Lost a race for the number (unique constraint) → surface it; never post
          // with the stale phone (which would also send the wrong CAPI/contact data).
          return NextResponse.json({ error: 'phone_taken' }, { status: 409 })
        }
      }
    } else {
      // A number identifies ONE account. If this one is already another account's
      // (their verified profile phone OR an owned storefront), reject — never
      // silently attach this listing to someone else's storefront.
      if (contactPhone && await phoneTakenByOther(contactPhone, meId)) {
        return NextResponse.json({ error: 'phone_taken' }, { status: 409 })
      }
      const byPhone = await db.seller.findUnique({ where: { phone: contactPhone } })
      // ⚠️ CLAIM ONLY ON AN AUTH-CONFIRMED PHONE — `contactPhone` here is TYPED INTO THE POST BODY.
      // Without this check, any signed-in account with no storefront could take over an unowned
      // guest storefront just by knowing its number (sellers advertise the same number on Facebook
      // and Zalo), inheriting every listing, review and rating, receiving all future buyer threads
      // (conversation creation resolves the seller side from Seller.ownerId), and locking the real
      // owner out for good — the verified auto-claim in profile.ts requires `ownerId: null`.
      // `phoneTakenByOther` above cannot catch this: it deliberately ignores unowned sellers,
      // because they are meant to be claimable by whoever VERIFIES the number.
      // src/lib/profile.ts:71-77 has always got this right ("Verified phone only (never a
      // self-typed number)"); this path reimplemented the claim and dropped the condition.
      const verifiedPhone = byPhone && !byPhone.ownerId ? await getVerifiedPhone() : null
      if (byPhone && !byPhone.ownerId && verifiedPhone && verifiedPhone === byPhone.phone) {
        // Claim the unowned guest storefront for this account. updateMany + the ownerId:null guard
        // makes it atomic and claim-once, matching profile.ts — two racing claims cannot both win.
        const claimed = await db.seller.updateMany({
          where: { id: byPhone.id, ownerId: null },
          data: { ownerId: meId, claimedAt: new Date() },
        })
        // ⚠️ On a LOST race, re-read before creating. `Seller.ownerId` is @unique, so if the
        // concurrent request that beat us was this same account's, a blind create would throw a
        // P2002 and fail the post. Losing the claim means either we now own it (our own concurrent
        // request won) or someone else does — check ours first, and only then fall back.
        seller = claimed.count > 0
          ? await db.seller.findUniqueOrThrow({ where: { id: byPhone.id } })
          : (await db.seller.findUnique({ where: { ownerId: meId } }))
            ?? await db.seller.create({
              data: { name: contactName || 'eno.vn seller', phone: null, ownerId: meId, verifiedSeller: false, rating: 0, reviewCount: 0, responseRate: 100 },
            })
      } else if (byPhone && !byPhone.ownerId) {
        // An unowned storefront exists on this number but the caller has NOT verified it. Do not
        // touch it, and do not fail the post either — they get their own storefront, without the
        // number (Seller.phone is unique, and it belongs to the row we just refused to hand over).
        seller = await db.seller.create({
          data: { name: contactName || 'eno.vn seller', phone: null, ownerId: meId, verifiedSeller: false, rating: 0, reviewCount: 0, responseRate: 100 },
        })
      } else {
        seller = await db.seller.create({
          data: { name: contactName || 'eno.vn seller', phone: contactPhone, ownerId: meId, verifiedSeller: false, rating: 0, reviewCount: 0, responseRate: 100 },
        })
      }
    }
  } else {
    // Guest post (not signed in): a number already tied to a real account can't be
    // reused by an anonymous poster (impersonation / cross-account dupe).
    if (contactPhone && await phoneTakenByOther(contactPhone, null)) {
      return NextResponse.json({ error: 'phone_taken' }, { status: 409 })
    }
    const existing = await db.seller.findUnique({ where: { phone: contactPhone } })
    seller = existing
      ? existing
      : await db.seller.create({
          data: { name: contactName || 'eno.vn seller', phone: contactPhone, verifiedSeller: false, rating: 0, reviewCount: 0, responseRate: 100 },
        })
  }
  return seller
}
