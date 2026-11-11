import { storefrontBaseHost } from '@/lib/storefront-host'

/**
 * docs.<base> AND api.<base> — NAMES FOR THE DEVELOPER DOCS, NOT SITES (2026-11-11).
 *
 * ⛔ MEASURED: both hosts answered 200 with the whole marketplace homepage (canonical https://eno.vn). `api` is an
 * infrastructure label and `docs` a reserved handle, so neither resolves as a storefront, and the request fell through
 * to the site. An agent-readiness scanner then reported "API described in documentation at https://docs.eno.vn but no
 * machine-verifiable API surface confirmed" — it had guessed the conventional docs host and been handed a homepage.
 *
 * So a page request on either host 302s to the app origin: `/` to /developers, any other path to the SAME path there
 * (docs.eno.vn/openapi.json → eno.vn/openapi.json), query kept. 302, not 301, as for schools./classroom.: a browser
 * caches a 301 for good, and `api.<base>` may yet be given a real job. Only GET/HEAD page requests (src/proxy.ts); `/api/*` and
 * `/.well-known/*` are served in place as before, and so is every other method. Import-light: the proxy runs on the edge.
 * `base` follows storefrontBaseHost, so `www.` is stripped as for teacher./schools./classroom.<base>.
 */
export const DOCS_HOST_LABELS = ['docs', 'api'] as const

/** Is this Host header docs.<base> or api.<base>? Port, case and a trailing root dot are ignored. */
export function isDocsHost(hostHeader: string | null | undefined, appUrl: string | null | undefined): boolean {
  const base = storefrontBaseHost(appUrl)
  if (!base || !hostHeader) return false
  const host = hostHeader.toLowerCase().replace(/:\d+$/, '').replace(/\.$/, '')
  return DOCS_HOST_LABELS.some((label) => host === `${label}.${base}`)
}

/**
 * Where docs.<base><pathname><search> goes. ⚠️ CONCATENATED ONTO THE ORIGIN, NEVER `new URL(path, base)`: a path of
 * `//evil.example/x` resolved against a base is a redirect off the domain; appended to the origin it is only a path
 * (src/proxy.ts's rule).
 */
export function docsHostRedirectUrl(appUrl: string | null | undefined, pathname: string, search: string): string | null {
  if (!appUrl) return null
  let origin: string
  try {
    origin = new URL(appUrl).origin
  } catch {
    return null
  }
  const path = pathname === '' || pathname === '/' ? '/developers' : pathname
  return `${origin}${path}${search}`
}

/** Paths a docs./api. host keeps serving in place: the API itself and well-known documents. */
export function docsHostServesInPlace(pathname: string): boolean {
  return pathname === '/api' || pathname.startsWith('/api/') || pathname === '/.well-known' || pathname.startsWith('/.well-known/')
}
