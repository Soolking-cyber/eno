'use client'

import Link from 'next/link'
import type { ComponentProps } from 'react'
import { useLanguage } from '@/context/language-context'
import { localizedHref } from '@/lib/lang-pinned'
import { variantOfLanguage } from '@/lib/lang-variant'

/**
 * A `next/link` whose href follows the page's language — the `/vi` twin of a live pilot path (`/`,
 * `/c/furniture-appliances`) on a Vietnamese page, so a Vietnamese reader is never sent into the
 * English-pinned plain URL (A1-LANG). Anything else is passed through unchanged (localizedHref).
 *
 * ⚠️ FOR A SERVER COMPONENT THAT CANNOT SEE THE PAGE'S LANGUAGE (a shared block with no `params`). The
 * context's language starts at the variant the server rendered (language-context.tsx `initialLang`), so
 * the SSR href and the hydrating one agree; a later client-side switch to a machine-translated language
 * maps back to `en`, the variant those languages ride on.
 * ⚠️ ON A STOREFRONT'S OWN HOST the rendered `/vi` href is the same cached HTML as eno.vn's; that host has
 * no pilot, so src/proxy.ts answers its live `/vi` twins with a 308 to the apex (the reader lands on the
 * marketplace's Vietnamese page, not a 404).
 */
export function LocalizedLink({ href, ...rest }: Omit<ComponentProps<typeof Link>, 'href'> & { href: string }) {
  const { lang } = useLanguage()
  return <Link href={localizedHref(href, variantOfLanguage(lang))} {...rest} />
}
