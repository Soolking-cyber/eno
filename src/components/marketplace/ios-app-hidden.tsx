import type { ReactNode } from 'react'

/**
 * Wrap `children` in the `ios-app-hidden` CSS hook (globals.css: `html.native-ios .ios-app-hidden {display:none}`) —
 * ONLY when `when` is true; otherwise a fragment, so with an App Store gate off the markup is byte-identical.
 * For server-rendered / ISR HTML that the edge cache shares between the iOS app and the web, where the server cannot
 * decide per user agent (src/lib/ios-hide-visa.ts). A server component: no client JavaScript.
 * ⚠️ `contents` (display: contents), so off the iOS app the wrapper generates no box and a flex / gap parent lays the
 * children out exactly as before (opus, review). In the app the hook's rule is unlayered, so it beats the utility.
 */
export function IosAppHidden({ when, children }: { when: boolean; children: ReactNode }) {
  return when ? <div className="ios-app-hidden contents">{children}</div> : <>{children}</>
}
