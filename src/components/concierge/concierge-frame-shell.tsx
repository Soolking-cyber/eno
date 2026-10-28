'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useLanguage } from '@/context/language-context'
import { guidedPageLang } from '@/lib/concierge/client'
import { localizedHref } from '@/lib/lang-pinned'
import { variantOfLanguage } from '@/lib/lang-variant'
import type { GuideFaceConfig } from '@/lib/concierge/guide-assets'
import { ConciergeFrame } from './concierge-frame'

/** The frame page's client side: may this account use the guide, and which face to draw (ids only — no token yet). */
export function ConciergeFrameShell() {
  const router = useRouter()
  const { lang } = useLanguage()
  const [config, setConfig] = useState<{ open: boolean; face: GuideFaceConfig | null } | null>(null)
  useEffect(() => {
    // ⛔ Only ever a frame of the page it guides (review, codex): opened on its own it has no app to move and no window to
    // close — home instead of a guide that dead-ends.
    if (window.parent === window) { router.replace(localizedHref('/', variantOfLanguage(lang))); return }
    let live = true
    // ?lang: the opening's voice is made ahead in the app's language (start.ts warmOpening).
    void fetch(`/api/concierge/config?lang=${encodeURIComponent(guidedPageLang(lang))}`, { cache: 'no-store' })
      .then((r) => (r.ok ? (r.json() as Promise<{ open?: boolean; face?: GuideFaceConfig | null }>) : null))
      .then((b) => { if (live) setConfig({ open: !!b?.open, face: b?.face ?? null }) })
      .catch(() => { if (live) setConfig({ open: false, face: null }) })
    return () => { live = false }
  }, [router, lang])
  if (!config) return null
  return <ConciergeFrame open={config.open} face={config.face} />
}
