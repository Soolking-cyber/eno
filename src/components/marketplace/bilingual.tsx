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
export function Bilingual({ en, vi, values }: {
  en: string
  vi: string
  /**
   * `{key}` placeholders filled AFTER translation, so a name or a number is never typed into the copy
   * and the nine machine-translated languages translate the template, not one instance of it.
   * split/join rather than a pattern replace, so a `$&` in a value prints as typed.
   * ⚠️ A TRANSLATION WHOSE PLACEHOLDERS ARE NOT EXACTLY THE ENGLISH TEMPLATE'S FALLS BACK TO THE
   * ENGLISH. The machine-translation layer does not protect `{…}` tokens: "…on {sitio}." would print
   * the token and drop the one fact the sentence carries, and an added or doubled token would print
   * raw. So the rule is the whole set, compared as a sorted list — not "is {site} still in there".
   */
  values?: Record<string, string>
}) {
  const { tr } = useLanguage()
  const t = tr(en, vi)
  if (!values) return <>{t}</>
  const tokens = (x: string) => (x.match(/\{[^{}]*\}/g) ?? []).sort().join('\u0000')
  let out = tokens(t) === tokens(en) ? t : en
  for (const [k, v] of Object.entries(values)) out = out.split(`{${k}}`).join(v)
  return <>{out}</>
}
