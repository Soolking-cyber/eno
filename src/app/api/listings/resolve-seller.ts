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
      if (byPhone && !byPhone.ownerId) {
        // Claim the unowned guest storefront for this account.
        seller = await db.seller.update({ where: { id: byPhone.id }, data: { ownerId: meId } })
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
