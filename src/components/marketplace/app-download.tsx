'use client'

import { useEffect, useState } from 'react'
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover'
import { IconButton } from '@/components/ui/icon-button'
import { Smartphone, Clock } from '@/components/ui/icons'
import { useLanguage } from '@/context/language-context'
import { ANDROID_APP_URL, IOS_APP_URL } from '@/lib/app-store-links'
import { isNativeShell } from '@/lib/native-browser'
import { IS_SERVICES } from '@/lib/edition'
import { cn } from '@/lib/utils'

/**
 * "Get the app" — the header's one door to the mobile apps, on BOTH editions (owner, 2026-09-16:
 * "add android app link to both domains and show on top right to the lefto of post a listing and to
 * the right of noticification icon on mobile download app if user is on the website. tap once
 * android linked ios coming soon").
 *
 * One control, which is why it satisfies both placements the owner described: it is mounted between
 * the notification bell and the Post button, so on a phone — where Post lives in the bottom nav — it
 * sits immediately right of the bell, and on desktop immediately left of Post.
 *
 * ⛔ WEB ONLY. Inside the Capacitor shell the visitor already has the app, and a store link there is
 * both noise and a trip out of the app. `isNativeShell()` reads `window.Capacitor`, which does not
 * exist during SSR — so this renders on the server and is removed on the client's first effect
 * rather than being gated at render, which would make the header's markup differ between the two
 * and trip hydration.
 *
 * ⛔ ANDROID IS A LINK, iOS IS A FACT. There is no App Store listing yet (the id is assigned at
 * submission), so the iOS row is inert copy, not a disabled link to nowhere — it becomes a real link
 * the moment NEXT_PUBLIC_IOS_APP_URL is set, with no change here. See src/lib/app-store-links.ts.
 *
 * ⛔⛔ SERVICES EDITION ONLY, AND THAT IS THE LICENSING BOUNDARY, NOT A PREFERENCE. The owner asked for
 * this on BOTH domains (2026-09-16) — but the published Android app renders `https://www.eno.forum`
 * (capacitor.config.ts `server.url`; the `eno.vn` package id is a Play identifier, not a destination).
 * So a "Get the app" control on eno.vn would have the LICENSED MARKETPLACE handing visitors an app
 * that offers e-Visa and itinerary, which is the leak class CLAUDE.md names: "any place eno.vn still
 * shows, links to, describes, indexes, emails or serves one of those surfaces". Two independent
 * reviewers (astra, agy) found it before it shipped.
 * ⚠️ THE FIX IS AN eno.vn BUILD OF THE APP, NOT A FLAG FLIP HERE. When one exists (its own package id,
 * `server.url = https://eno.vn`, its own listing), give app-store-links.ts a per-edition URL and delete
 * this gate — the owner's "both domains" is then satisfied honestly.
 */
export function AppDownload() {
  const { tr } = useLanguage()
  const [inApp, setInApp] = useState(false)
  const [open, setOpen] = useState(false)

  useEffect(() => { setInApp(isNativeShell()) }, [])

  if (!IS_SERVICES || inApp) return null

  const row = 'flex items-center gap-3 px-4 py-3 text-left'

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <IconButton
            size="lg"
            // The pre-paint `html.native [data-app-download]` rule in globals.css hides this inside the
            // app before the first frame — the effect below is the belt to that CSS's braces.
            data-app-download=""
            aria-label={tr('Get the eno app', 'Tải ứng dụng eno')}
            // Matches the bell's press feel exactly — they are neighbours, and a different scale or
            // duration on one of two adjacent header glyphs reads as a bug.
            className="text-body transition-[background-color,color,scale] duration-100 hover:bg-accent hover:text-accent-foreground active:scale-[0.96]"
          >
            <Smartphone className="h-7 w-7" strokeWidth={1.75} />
          </IconButton>
        }
      />
      <PopoverContent
        side="bottom"
        align="end"
        sideOffset={8}
        aria-label={tr('Get the eno app', 'Tải ứng dụng eno')}
        className="w-64 gap-0 overflow-hidden p-0 shadow-pop ring-0"
      >
        <p className="px-4 pb-1 pt-3 text-sm font-bold text-foreground">{tr('Get the eno app', 'Tải ứng dụng eno')}</p>
        <a
          href={ANDROID_APP_URL}
          target="_blank"
          rel="noopener noreferrer"
          onClick={() => setOpen(false)}
          className={cn(row, 'font-semibold text-foreground transition-colors hover:bg-accent cursor-pointer')}
        >
          <Smartphone className="h-5 w-5 shrink-0 text-ink-4" strokeWidth={1.75} />
          {tr('Android — Google Play', 'Android — Google Play')}
        </a>
        {IOS_APP_URL ? (
          <a
            href={IOS_APP_URL}
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => setOpen(false)}
            className={cn(row, 'font-semibold text-foreground transition-colors hover:bg-accent cursor-pointer')}
          >
            <Smartphone className="h-5 w-5 shrink-0 text-ink-4" strokeWidth={1.75} />
            {tr('iPhone — App Store', 'iPhone — App Store')}
          </a>
        ) : (
          // Not a disabled button: there is nothing to press, and a greyed control invites a tap that
          // can never do anything. It is a line of copy that says when to come back.
          <p className={cn(row, 'text-sm text-ink-4')}>
            {/* There is no Apple glyph in the sprite (it is a trademark, deliberately absent) — a
                clock says "later", which is what this row is about. */}
            <Clock className="h-5 w-5 shrink-0" strokeWidth={1.75} />
            {tr('iPhone — coming soon', 'iPhone — sắp có')}
          </p>
        )}
      </PopoverContent>
    </Popover>
  )
}
