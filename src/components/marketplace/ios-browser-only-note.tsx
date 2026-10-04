'use client'

import { Info } from '@/components/ui/icons'
import { useLanguage } from '@/context/language-context'
import { SITE_NAME } from '@/lib/edition'
import { cn } from '@/lib/utils'

/**
 * The line the iOS app shows where it would have taken an identity or business document, or an e-Visa application —
 * App Store gate `ios-hide-visa` (D5 = b; src/lib/ios-hide-visa.ts). Presentational: the caller supplies the words.
 *
 * ⛔ PLAIN TEXT, NOT A LINK, ON PURPOSE: inside the app the site is the app's own origin, so a link would reload the
 * same gated page in the WebView, and the in-app Safari sheet would carry the flow back into the app. The host is
 * written out because that is what the person needs to open Safari themselves.
 * ⛔ e-Visa WORDS NEVER LIVE IN THIS FILE. It is shared by both editions and gen-ui-strings harvests it into the
 * catalogue eno.vn ships; the visa sentences are VisaInAppNote in visa-start.tsx, which is aliased to a stub there.
 */
export function IosBrowserOnlyNote({ text, className }: { text: string; className?: string }) {
  return (
    <p className={cn('flex items-start gap-2 rounded-xl bg-tint p-3 text-sm leading-relaxed text-body', className)}>
      <Info className="mt-0.5 h-4 w-4 shrink-0 text-accent-foreground" aria-hidden />
      <span>{text}</span>
    </p>
  )
}

/**
 * This build's own host — www.eno.forum on the services build, eno.vn on the marketplace one. Appended OUTSIDE tr(),
 * so no hostname enters the shared catalogue: eno.vn's string set must not carry eno.forum's address (opus, review).
 */
function siteHost(): string {
  try {
    return new URL(process.env.NEXT_PUBLIC_APP_URL || '').host || SITE_NAME
  } catch {
    return SITE_NAME
  }
}

/**
 * Identity / business verification, done in a browser. Both editions verify people, so the words are shared and name
 * no site; the host comes from the build. In practice only eno.forum's renders: the gate keys on the iOS app, and the
 * iOS app only ever loads www.eno.forum (capacitor.config.ts).
 */
export function IosVerifyElsewhereNote({ kind, className }: { kind: 'identity' | 'business'; className?: string }) {
  const { tr } = useLanguage()
  const lead = kind === 'identity'
    ? tr('Identity verification is available on our website, in a web browser:', 'Bạn có thể xác minh danh tính trên website của chúng tôi, bằng trình duyệt web:')
    : tr('Business verification is available on our website, in a web browser:', 'Bạn có thể xác minh doanh nghiệp trên website của chúng tôi, bằng trình duyệt web:')
  const text = lead + ' ' + siteHost()
  return <IosBrowserOnlyNote text={text} className={className} />
}
