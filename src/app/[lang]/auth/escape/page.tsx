import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { HANDOFF_COOKIE, handoffAuthUrl, isNonce } from '@/lib/auth/handoff'
import { parseHandoffVia } from '@/lib/auth/handoff-client'
import { HandoffWaiting } from '@/components/marketplace/handoff-waiting'
import { HandoffLaunch } from '@/components/marketplace/handoff-launch'

// ── One URL, two behaviours, chosen by which cookie jar is asking ───────────────────────────────
//
// The waiting room in the ORIGINATING context; the launch ramp in the REAL BROWSER. It must be both
// because of how the manual iOS escape works: on iOS there is no API to leave a webview, so the
// visitor uses the in-app browser's "••• → Open in Safari", and that menu opens the page's CURRENT
// URL. If the app were still sitting on /signin, Safari would load a fresh sign-in page — the
// visitor would sign in THERE and the app would wait forever for a code nobody parked. So the app
// navigates here first, making the current URL one that knows how to resume the flow.
//
// ⚠️ THE COOKIE IS THE DISCRIMINATOR, which is exactly right because the whole problem is that the
// two contexts have different jars. No user-agent sniffing, and a visitor who pastes the link into
// another browser gets the sign-in they were trying to do rather than an error.
export const dynamic = 'force-dynamic'

export default async function EscapePage({ searchParams }: { searchParams: Promise<{ h?: string; via?: string }> }) {
  const { h, via: rawVia } = await searchParams
  // Where the visitor started (UX3 J2) — an allow-listed word for the launch ramp's copy, or null.
  const via = parseHandoffVia(rawVia)
  const cookieNonce = (await cookies()).get(HANDOFF_COOKIE)?.value

  // ⚠️ COOKIE PRESENT ⇒ ALWAYS THE WAITING ROOM, even if `h` is absent or does not match. An
  // earlier draft treated a mismatch as "this is the escaped browser" and redirected — which meant
  // a visitor holding any live cookie who opened someone else's link was sent to THAT handoff's
  // Google URL. The jar that opened a handoff is never the jar that should be escaping.
  if (isNonce(cookieNonce)) return <HandoffWaiting nonce={cookieNonce} />

  if (!isNonce(h)) redirect('/signin')

  const url = await handoffAuthUrl(h)
  // The stored URL was pinned on write by /api/auth/handoff/open: this project's own Supabase
  // /auth/v1/authorize (exact origin and path), `provider=google`, a PKCE `code_challenge`, and a
  // `redirect_to` of exactly this site's /auth/callback?handoff=<that nonce> (plus an allow-listed
  // `via`). That is what keeps this 302 from being an open redirector — or an implicit-flow token
  // delivery — aimed at someone mid-sign-in. (It said "accounts.google.com only" until 2026-10-08;
  // that was never what was stored.)
  if (url) redirect(url)

  // ⚠️ NOT AN ERROR — THE ROW IS PROBABLY STILL BEING WRITTEN. The app has to launch this browser
  // inside the live user gesture, before it has asked Supabase for the Google URL, so arriving
  // early is the NORMAL case rather than a failure. Bouncing to /signin here would start the
  // disconnected second sign-in this whole design exists to prevent.
  return <HandoffLaunch nonce={h} via={via} />
}
