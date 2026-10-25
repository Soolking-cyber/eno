'use client'

import type { ReactNode } from 'react'
import { useLanguage } from '@/context/language-context'

/**
 * The school pages' breadcrumb landmark: its label goes through tr(), so the nine machine-translated languages get it too.
 * ⚠️ `data-crumb-trail` is what hides the trail in the native app (globals.css), as ui/breadcrumb carries it: the app's
 * other match, aria-label="breadcrumb", only holds for an English reader — the trail showed in Vietnamese and the MT
 * languages (sweep, 2026-10-22).
 */
export function BreadcrumbNav({ className, children }: { className?: string; children: ReactNode }) {
  const { tr } = useLanguage()
  return <nav aria-label={tr('Breadcrumb', 'Vị trí trang')} data-crumb-trail="" className={className}>{children}</nav>
}
