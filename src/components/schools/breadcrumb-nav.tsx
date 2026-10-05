'use client'

import type { ReactNode } from 'react'
import { useLanguage } from '@/context/language-context'

/** The school pages' breadcrumb landmark: its label goes through tr(), so the nine machine-translated languages get it too. */
export function BreadcrumbNav({ className, children }: { className?: string; children: ReactNode }) {
  const { tr } = useLanguage()
  return <nav aria-label={tr('Breadcrumb', 'Vị trí trang')} className={className}>{children}</nav>
}
