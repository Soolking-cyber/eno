'use client'

import * as React from 'react'
import { useLanguage } from '@/context/language-context'

/**
 * A `<nav>` whose accessible name follows the visitor's language — for SERVER-rendered pages and
 * server-renderable primitives, which cannot call useLanguage and used to hardcode an English
 * aria-label that a screen reader then read out in all eleven languages.
 *
 * `label` is the English and `labelVi` the authored Vietnamese, exactly as tr(en, vi): the server
 * renders the en or vi variant unchanged, and the nine machine-translated languages translate the
 * English on the client. Children stay server components.
 *
 * ⚠️ NEVER SELECT ON THIS LABEL. It changes with the language — a CSS or test hook keyed on the
 * English text matches only English pages. Give the element a data attribute and select on that
 * (see `data-crumb-trail` in ui/breadcrumb and globals.css).
 */
export function LocalizedNav({ label, labelVi, ...props }: Omit<React.ComponentProps<'nav'>, 'aria-label'> & { label: string; labelVi: string }) {
  const { tr } = useLanguage()
  // The translated name is applied AFTER the spread, so no stray `aria-label` in props can blank it.
  return <nav {...props} aria-label={tr(label, labelVi)} />
}
