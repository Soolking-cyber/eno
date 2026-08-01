/**
 * MARKETPLACE-EDITION STUB for cross-site-promo.tsx.
 *
 * next.config.ts aliases the real component here on an eno.vn build. Two things follow, and only
 * the second one needs the alias:
 *   · BEHAVIOUR — nothing renders. The real component already returns null on the marketplace
 *     edition (its link data comes from cross-site-links, which is stubbed to empty), so this
 *     changes no output.
 *   · ARTIFACT — the copy is gone. "Already in Vietnam? Find housing, jobs and motorbikes on
 *     eno.vn" is a sentence eno.vn must not ship to a reader who is already on eno.vn, and a
 *     component that declines to render still puts its strings in the chunk. That is what the alias
 *     removes and a guard cannot.
 *
 * ⚠️ NO PROPS ARE DESTRUCTURED AND NO MARKUP IS RETURNED, on purpose. Keep it that way: the moment
 * a stub renders a fallback ("also available on our other site"), the words are back in the bundle
 * and the alias has bought nothing. It must also keep accepting the same props as the real
 * component — tsc only ever sees the real one, so a signature that has drifted is a build that
 * fails on eno.vn and nowhere else. src/components/marketplace/edition-stubs.test.ts pins the
 * export names; the signature is on you.
 */
export function CrossSitePromo(_props: { className?: string }) {
  return null
}
