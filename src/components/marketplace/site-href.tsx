'use client'

import { createContext, useContext, useSyncExternalStore } from 'react'
import { storefrontBaseHost } from '@/lib/storefront-host'

/**
 * ⛔ ON AN eno SUBDOMAIN, A LINK TO ONE OF THE SITE'S PAGES NAMES THE APEX (Seobility crawl 3, 2026-11-24). A shop's host serves
 * the shop at `/` and nothing else: every other page path 301s to the same path on eno.vn (src/proxy.ts, "ON A SHOP'S HOST, ONLY
 * `/` IS THE SHOP"), and teacher.eno.vn does the same. So a relative `/listings/<id>` or `/terms` on <shop>.eno.vn was a link to a
 * redirect: 1,075 card links and 387 nav links on 35 shop hosts ("internal link targets on redirects", 145 → 1,545 once the
 * crawl took in subdomains). `useSiteHref()(path)` returns `https://eno.vn<path>` there and the path itself everywhere else.
 *
 * Two ways it knows, so the server HTML is right where it can be and nothing mismatches on hydration:
 * · SiteOriginProvider — the shop page (`/s/[handle]`, its own Header, main and Footer) passes the apex when it renders on the
 *   shop's host, so those links are absolute in the HTML a crawler reads first.
 * · Outside it, the browser's own host: useSyncExternalStore answers '' for the server render and the hydration pass, then the
 *   apex on a subdomain, so React re-renders those links once instead of mismatching. ⚠️ AFTER HYDRATION ONLY: the shop host's
 *   bottom nav (mounted in providers.tsx) and every link on teacher.eno.vn (its form page is the same static page as
 *   eno.vn/teachers/join, so it cannot know its host on the server) — a crawler that renders JavaScript, like Seobility, sees them.
 *
 * Only a same-site path (`/…`, not `//…`) is rewritten; an absolute URL, `mailto:` or `#` passes through. A plain click is
 * unchanged wherever a caller handles it (the card's router push, the sign-in dialog); Next's <Link> treats the absolute apex URL
 * on a subdomain as another origin and navigates there, which is where the 301 sent it anyway.
 */
const SiteOriginContext = createContext('')

export function SiteOriginProvider({ origin, children }: { origin: string; children: React.ReactNode }) {
  return <SiteOriginContext.Provider value={origin}>{children}</SiteOriginContext.Provider>
}

/**
 * The app's own origin when `host` is another subdomain of its base host (a shop's, the teacher host), else ''.
 * ⛔ NEVER ON THE APP'S OWN HOST OR `www.`: storefrontBaseHost strips `www`, and eno.forum's canonical host IS `www.eno.forum`
 * (gate review, 2026-11-24) — without this every forum nav link would have named the bare apex after hydration, a redirect and
 * a full reload on every tab. The target is the app URL's own origin, not the stripped base, for the same reason.
 */
export function subdomainApexOrigin(host: string, appUrl: string | null | undefined): string {
  const base = storefrontBaseHost(appUrl)
  if (!base || !appUrl) return ''
  let app: URL
  try { app = new URL(appUrl) } catch { return '' }
  if (host === app.host || host === base || host === `www.${base}` || !host.endsWith(`.${base}`)) return ''
  return app.origin
}

const subscribe = () => () => {}
const clientOrigin = () => subdomainApexOrigin(window.location.host, process.env.NEXT_PUBLIC_APP_URL)
const serverOrigin = () => ''

export function withOrigin(origin: string, path: string): string {
  return origin && path.startsWith('/') && !path.startsWith('//') ? `${origin}${path}` : path
}

export function useSiteHref(): (path: string) => string {
  const provided = useContext(SiteOriginContext)
  const detected = useSyncExternalStore(subscribe, clientOrigin, serverOrigin)
  const origin = provided || detected
  return (path: string) => withOrigin(origin, path)
}
