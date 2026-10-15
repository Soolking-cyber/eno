/**
 * A STOREFRONT'S PICTURE AS EVERYONE SEES IT (owner, 2026-10-15: "the persons page doesnt show their profile image, but
 * in messages i can clearly see the profile image").
 *
 * Seller.avatarUrl is a shop's own picture — a business sets its logo in the business profile editor, partners get theirs
 * from scripts — and a PERSON'S storefront has none: the person's photo lives on their Profile, which is why their
 * messages showed it and their storefront showed initials (measured 2026-10-15: 37 owned storefronts with no picture of
 * their own, 36 of them a person's). So a person's storefront shows its owner's profile photo — the photo eno.vn already
 * shows publicly on the owner's /<handle> card when they have no storefront ([lang]/[handle]/page.tsx).
 * ⛔ FAIL CLOSED (commit gate): only an owner POSITIVELY known to be a person — accountType 'individual' (all 36, measured)
 * — lends their face. A business shows its own picture or none, never the face of whoever holds the account; an account
 * with no type yet, a query that did not read the type, and an ownerless storefront show no one's.
 * ⚠️ The listing page is ISR for 30 days: a change of photo or of account type purges the owner's listing pages
 * (seller-pdp-refresh.ts refreshShopPicturePdps), or a removed face stays up for a month.
 *
 * Read the owner's `avatarUrl` and `accountType` wherever a storefront's picture is shown to others — the storefront, the
 * listing page, a conversation — or that surface falls back to the initials and the same seller looks like two people
 * (owner, 2026-07-24: the listing page's shop picture must match the storefront's — serialize.ts). A query that does not
 * select the owner's photo simply gets the shop's own picture.
 */
export function storefrontAvatarUrl(s: {
  avatarUrl: string | null
  owner?: { avatarUrl?: string | null; accountType?: string | null } | null
}): string | null {
  if (s.avatarUrl) return s.avatarUrl
  const o = s.owner
  return o && o.accountType === 'individual' ? (o.avatarUrl ?? null) : null
}
