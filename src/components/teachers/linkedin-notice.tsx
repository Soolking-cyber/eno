'use client'

import { useLanguage } from '@/context/language-context'
import { Button } from '@/components/ui/button'
import { Collapsible, CollapsiblePanel, CollapsibleTrigger } from '@/components/ui/collapsible'
import { ChevronDown } from '@/components/ui/icons'
import { LINKEDIN_NOTICE_DETAILS, LINKEDIN_NOTICE_LEAD } from '@/lib/teachers/import-notice'

/**
 * THE WORDS BESIDE EVERY "SIGN IN WITH LINKEDIN" (LinkedIn API Terms 5.2: consent before the redirect, covering use,
 * when, what, how to withdraw and to delete; PDP Law 91 Art 9). The lead is always shown; the rest is in a disclosure
 * that STAYS IN THE PAGE (keepMounted) — the same notice, folded, never a separate page. The start route refuses a
 * button that did not send this notice's version (src/app/[lang]/auth/linkedin/start/route.ts).
 * `id` goes on the lead so the button can point aria-describedby at it — the notice is read before the act.
 */
export function LinkedInNotice({ id }: { id: string }) {
  const { tr } = useLanguage()
  return (
    <div className="space-y-1">
      <p id={id} className="text-xs leading-relaxed text-body">{tr(LINKEDIN_NOTICE_LEAD.en, LINKEDIN_NOTICE_LEAD.vi)}</p>
      <Collapsible>
        <CollapsibleTrigger
          render={<Button variant="bare" size="none" type="button" className="group inline-flex min-h-11 items-center gap-1 text-xs font-semibold text-accent-foreground hover:underline" />}
        >
          {tr('More about LinkedIn sign-in', 'Thêm về đăng nhập bằng LinkedIn')}
          <ChevronDown className="size-3.5 transition-transform duration-200 group-data-[panel-open]:rotate-180" aria-hidden />
        </CollapsibleTrigger>
        <CollapsiblePanel keepMounted className="space-y-1.5 pb-1 data-[closed]:hidden">
          {LINKEDIN_NOTICE_DETAILS.map((p) => (
            <p key={p.en} className="text-xs leading-relaxed text-muted-foreground">{tr(p.en, p.vi)}</p>
          ))}
          <a href="/privacy" target="_blank" rel="noreferrer" className="inline-flex min-h-11 items-center text-xs font-semibold text-accent-foreground underline underline-offset-2">
            {tr('Privacy Policy', 'Chính sách bảo vệ dữ liệu cá nhân')}
          </a>
        </CollapsiblePanel>
      </Collapsible>
    </div>
  )
}
