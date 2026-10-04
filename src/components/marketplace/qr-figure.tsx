'use client'

import { useLanguage } from '@/context/language-context'
import { fillBilingual } from '@/components/marketplace/bilingual'

/**
 * A server-built QR code (src/lib/qr-svg.ts, `decorative: true`) named in the READER's language.
 *
 * ⚠️ The SVG is markup built on the server, so a label inside it ("QR code to book on X") could only
 * ever be English — read aloud that way in all eleven languages. The name lives on this wrapper instead,
 * from tr(en, vi) with `{site}`-style values filled after translation (fillBilingual's token rule).
 */
export function QrFigure({ svg, en, vi, values, className }: { svg: string; en: string; vi: string; values?: Record<string, string>; className?: string }) {
  const { tr } = useLanguage()
  const t = tr(en, vi)
  const label = values ? fillBilingual(t, en, values) : t
  return <div role="img" aria-label={label} className={className} dangerouslySetInnerHTML={{ __html: svg }} />
}
