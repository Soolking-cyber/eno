import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getCurrentProfile } from '@/lib/admin'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Lightweight identity for the account dropdown: who am I + do I own a storefront.
//
// ⚠️ WS6 — NOT MIGRATED, AND THIS IS THE CLEAREST CASE IN THE CLUSTER. A guest gets **200**
// `{"user":null}` — not 401, not an error body. Every page with a header calls this before it knows
// whether anyone is signed in, so "not signed in" is a normal, successful answer here; `auth:
// 'profile'` would turn the most common response on the site into a 401 and put an error in the
// console of every signed-out visitor. There is no rate limit and no body either, so the wrapper
// would be pure indirection on a hot path.
export async function GET() {
  const profile = await getCurrentProfile()
  if (!profile) return NextResponse.json({ user: null })
  const seller = await db.seller.findUnique({ where: { ownerId: profile.id }, select: { id: true, name: true, phone: true } })
  // Public @handles (user + shop) for the settings editors and share UI.
  const handles = await db.handle.findMany({
    where: { OR: [{ profileId: profile.id }, ...(seller ? [{ sellerId: seller.id }] : [])] },
    select: { handle: true, profileId: true },
  })
  const handle = handles.find((h) => h.profileId)?.handle ?? null
  const shopHandle = handles.find((h) => !h.profileId)?.handle ?? null
  return NextResponse.json({
    user: {
      /**
       * ⚠️ WHO THIS ANSWER IS ABOUT — the client compares it against the user it MEANT to ask for,
       * and discards the whole payload on a mismatch. Without it the client can only stamp the
       * response with the id it believed it was asking for, which is a guess: the request carries
       * whatever cookies exist when the server reads them, so a sign-in in ANOTHER TAB mid-fetch
       * returns the new account's identity to a page still rendering the old one. Since this payload
       * carries `sellerId`, that mis-attribution is an OWNERSHIP answer about the wrong person.
       * `Profile.id` IS `auth.users.id` (see the schema comment), so this compares directly against
       * the Supabase session user. It is the viewer's own id, returned only to them.
       */
      id: profile.id,
      displayName: profile.displayName,
      email: profile.email,
      phone: profile.phone ?? null,
      avatarUrl: profile.avatarUrl,
      avatarColor: profile.avatarColor,
      // Own trust standing for the native Account card (#45/#114).
      trustScore: profile.trustScore,
      trustTier: profile.trustTier,
      accountType: profile.accountType ?? null,
      businessName: profile.businessName ?? null,
      handle,
      shopHandle,
      sellerId: seller?.id ?? null,
      // Storefront contact for "post as" prefill.
      seller: seller ? { name: seller.name, phone: seller.phone } : null,
    },
  })
}
