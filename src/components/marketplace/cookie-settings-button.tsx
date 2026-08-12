'use client'

import { Cookie } from '@/components/ui/icons'
import { Button } from '@/components/ui/button'
import { useLanguage } from '@/context/language-context'

// PDPL consent-withdrawal entry point that works for GUESTS. The footer's
// "Cookie settings" link is hidden on native (html.native #app-footer) and the
// dashboard-settings copy sits behind sign-in, so the privacy policy page —
// public, linked from the consent dialog itself — carries this one.
export function CookieSettingsButton() {
  const { tr } = useLanguage()
  return (
    <Button
      type="button"
      variant="ghost"
      size="none"
      onClick={() => window.dispatchEvent(new CustomEvent('eno:open-consent'))}
      className="px-4 py-2 font-semibold text-body hover:bg-muted hover:text-body"
    >
      <Cookie className="h-4 w-4" /> {tr('Cookie settings', 'Cài đặt cookie')}
    </Button>
  )
}
