import type { Metadata } from 'next'

/**
 * A page's metadata in the language its HTML is rendered in — the `[lang]` segment the proxy rewrote to (src/proxy.ts).
 * A static `export const metadata` cannot read it, so ~20 routes kept an English <title> over a Vietnamese page ("Post a
 * listing | eno.vn" above "Tạo tin đăng" — sweep 2026-10-22). `vi` overrides what it names; robots and canonicals stay as
 * the English metadata decided them. A share card (withShare) whose title or description was derived from the page's
 * follows the Vietnamese one too, so a Vietnamese render never pairs a Vietnamese <title> with an English og:title.
 * The pattern /saved (E-TITLE) and /safety already used.
 */
export async function langMetadata(params: Promise<{ lang: string }>, en: Metadata, vi: Metadata): Promise<Metadata> {
  const { lang } = await params
  if (lang !== 'vi') return en
  const follow = <T extends { title?: unknown; description?: unknown } | null | undefined>(card: T): T => {
    if (!card) return card
    const out = { ...card }
    if (vi.title !== undefined && card.title === en.title) out.title = vi.title
    if (vi.description !== undefined && card.description === en.description) out.description = vi.description
    return out
  }
  return {
    ...en,
    ...vi,
    // A card the Vietnamese metadata names itself is its own; only an inherited English one follows.
    ...(vi.openGraph === undefined && en.openGraph ? { openGraph: follow(en.openGraph) } : {}),
    ...(vi.twitter === undefined && en.twitter ? { twitter: follow(en.twitter) } : {}),
  }
}

export type LangParams = { params: Promise<{ lang: string }> }
