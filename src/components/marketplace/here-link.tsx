import { LocalizedLink } from './localized-link'

/**
 * An in-site link inside a guide (SeoArticle's `HereLink`), in the ARTICLE's language.
 *
 * ⛔ A VIETNAMESE GUIDE MUST NOT LINK THE ENGLISH-PINNED PLAIN URL (A1-LANG). Five VI guides linked
 * `/c/furniture-appliances`, which V-a renders in English for everyone, so a reader of a Vietnamese
 * article landed on an English category page. LocalizedLink sends them to the `/vi` twin instead;
 * anything outside the live pilot list, and every English page, is unchanged.
 *
 * ⚠️ THE ARTICLE BODY IS AUTHORED AS JSX HANDED TO SeoArticle, so a server link has no way to learn the
 * article's language — the client context does. On a guide it IS the article's: a guide is pinned to its
 * variant (lang-pinned.ts FIXED_LANG), the server renders in it, and the provider refuses to swap a
 * pinned page into the other variant, so the href agrees on both sides of hydration.
 */
export function HereLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <LocalizedLink href={href} className="font-semibold text-accent-foreground hover:underline">
      {children}
    </LocalizedLink>
  )
}
