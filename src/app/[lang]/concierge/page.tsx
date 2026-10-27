import type { Metadata } from 'next'
import { ConciergeFrameShell } from '@/components/concierge/concierge-frame-shell'

/**
 * /concierge — the voice concierge's window: this page is the same-origin frame the floating host shows over the app
 * (src/components/concierge/concierge-host.tsx), so the face, the microphone and the voice run under THIS page's security
 * policy (next.config.ts) and never in the marketplace page's. A static shell; who may use it is asked on the client (the
 * classroom's pattern — nothing personal in the HTML). `data-concierge-frame` stands the marketplace chrome down from the
 * first paint (globals.css), as `data-classroom` does.
 */
export const metadata: Metadata = {
  title: 'eno guide',
  robots: { index: false, follow: false },
}

export default function ConciergePage() {
  return (
    <div data-concierge-frame="" className="fixed inset-0 z-overlay bg-brand-deeper text-primary-foreground">
      <ConciergeFrameShell />
    </div>
  )
}
