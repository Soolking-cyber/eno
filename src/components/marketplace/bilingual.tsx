'use client'

import { useLanguage } from '@/context/language-context'

/**
 * Renders a piece of copy that was AUTHORED in both languages, rather than translated at runtime.
 *
 * ⚠️ WHY THIS EXISTS AT ALL, given `<Tr>` already translates anything. `<Tr text="…" />` sends its
 * string to the machine-translation layer for every language including Vietnamese (the curated
 * vi-overrides file is itself generated). That is right for UI copy and wrong for the two constants
 * the about page renders — `AFFILIATION` (src/lib/site-legal.ts) and `PROVIDER_OF_RECORD`
 * (src/lib/visa-provider.ts). Both carry a hand-written Vietnamese pass precisely because a
 * mistranslation of "who is legally responsible for this service" is a legal defect rather than a
 * typo, and both files say in their own comments to render them with `tr(x.en, x.vi)`.
 *
 * `tr()` gives exactly that: the English source for `en`, the authored Vietnamese for `vi`, and a
 * cached machine translation of the ENGLISH for the other nine languages — which is the honest
 * fallback, since English is the authoritative text of both constants.
 *
 * ⛔ A CATEGORY'S NAME GOES THROUGH HERE TOO, never through `<Tr>`. The category row carries its own
 * Vietnamese (`nameVi`), and `<Tr>` ignores it: it looks the English name up as a UI string,
 * so the category "Home" (furniture-appliances, `nameVi` "Nhà cửa") hit vi-overrides' "Home" →
 * "Trang chủ", the HOMEPAGE, and /c/furniture-appliances in Vietnamese read "Trang chủ ở Việt Nam"
 * under a "Trang chủ / Trang chủ" breadcrumb (live, 2026-09-27). Render
 * `<Bilingual en={cat.name} vi={cat.nameVi || cat.name} />`;
 * src/app/[lang]/category-name-contract.test.tsx holds every page to it.
 *
 * It is a client component because `tr` comes from the language context; the page around it stays a
 * server component and passes the constants down as plain strings.
 */
export function Bilingual({ en, vi }: { en: string; vi: string }) {
  const { tr } = useLanguage()
  return <>{tr(en, vi)}</>
}
