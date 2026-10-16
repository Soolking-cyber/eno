'use client'

import { useEffect } from 'react'
import { setLinkedInSignInHere } from '@/lib/linkedin-flag'
import { LINKEDIN_PROVIDER } from '@/lib/linkedin-signin'

// An answer is kept like the server's (src/lib/auth/linkedin.ts): 10 minutes, a failure 60 s — never for the whole visit.
let probed: { at: number; ttl: number; on: Promise<boolean> } | null = null
/** A static page's own look at GoTrue's settings (the dynamic join page passes the server's answer instead). */
function probeOnce(): Promise<boolean> {
  if (probed && Date.now() - probed.at < probed.ttl) return probed.on
  const entry = { at: Date.now(), ttl: 60_000, on: Promise.resolve(false) }
  entry.on = (async () => {
    const base = (process.env.NEXT_PUBLIC_SUPABASE_URL || '').replace(/\/$/, '')
    const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || ''
    if (!base || !key) return false
    try {
      const r = await fetch(`${base}/auth/v1/settings`, { headers: { apikey: key } })
      if (!r.ok) return false
      const d = (await r.json()) as { external?: Record<string, unknown> }
      entry.ttl = 10 * 60_000
      return d.external?.[LINKEDIN_PROVIDER] === true
    } catch {
      return false
    }
  })()
  probed = entry
  return entry.on
}

/**
 * Rendered by a teacher page: "Sign in with LinkedIn" is offered in this page's sign-in form(s) while it is mounted —
 * the header's, the toast's and the form's own popup — and nowhere else (src/lib/linkedin-flag.ts). `enabled` is the
 * server's answer (the join page); without it (the static edit page) the browser asks GoTrue itself.
 */
export function LinkedInSignInFlag({ enabled }: { enabled?: boolean }) {
  useEffect(() => {
    let alive = true
    let said = false
    const say = (on: boolean) => { if (on && alive) { setLinkedInSignInHere(true); said = true } }
    if (enabled !== undefined) say(enabled)
    else void probeOnce().then(say)
    // Only an "on" this flag gave is taken back (the count in linkedin-flag.ts).
    return () => { alive = false; if (said) setLinkedInSignInHere(false) }
  }, [enabled])
  return null
}
