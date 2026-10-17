// The ONE canonicalize-then-validate helper for in-app path navigation (audit Phase 1:
// two validators existed at two strictness levels — native-bootstrap's full discipline
// vs native-push's bare startsWith('/'), which accepted `//evil.com`-class input and
// navigated the TRUSTED NATIVE SHELL to it).
//
// Pure and isomorphic: resolve the raw value against the app origin, reject anything
// that escapes it (protocol-relative `//…`, backslash `/\…` — the URL parser treats \
// as / in special schemes), decode the pathname to a bounded fixpoint so double-encoded
// smuggling can't slip past prefix checks, and (optionally) refuse auth-flow paths.

const APP_ORIGIN = 'https://eno.vn'

/**
 * %-decoding the way a LENIENT decoder downstream does it (Android's Uri, WebKit): every escape that decodes is decoded,
 * a malformed one (`%ZZ`, a broken UTF-8 byte, a lone `%`) stays as written — never a throw, so a broken escape cannot
 * hide the readable one beside it. A run of escapes decodes as UTF-8; a run that is not valid UTF-8 still gives up its
 * ASCII bytes (`%5F%E0` → `_%E0`).
 */
function decodeLeniently(s: string): string {
  return s.replace(/(?:%[0-9A-Fa-f]{2})+/g, (run) => {
    try { return decodeURIComponent(run) } catch {
      return run.replace(/%([0-7][0-9A-Fa-f])/g, (_, hex: string) => String.fromCharCode(parseInt(hex, 16)))
    }
  })
}

/**
 * Every spelling of a pathname that a decoder further down could act on: the path as written, then after each lenient
 * %-decoding round both the decoded string and its re-resolution (dot segments and `\` collapse again — a decode can
 * mint `..` or `//` that the first parse never saw), until it stops changing. null = NO STABLE SPELLING: a decode that
 * leaves the origin, or still changing after the last round. Callers fail closed on null.
 */
function pathSpellings(pathname: string): string[] | null {
  const spellings = [pathname]
  let probe = pathname
  for (let round = 0; round < 5; round++) {
    const decoded = decodeLeniently(probe)
    if (decoded === probe) return spellings
    let next: URL
    try { next = new URL(decoded, APP_ORIGIN) } catch { return null }
    if (next.origin !== APP_ORIGIN) return null
    spellings.push(decoded, next.pathname)
    // Re-encoding gave back the same path: the escapes are literal characters (a Vietnamese slug, a space), not layers.
    if (next.pathname === probe) return spellings
    probe = next.pathname
  }
  return null
}

/**
 * True when the path could land under "/_" — framework territory (Next's /_next/*, Capacitor's /_capacitor_*), never a
 * page — in ANY spelling, or when it has no stable spelling at all (fail closed, see pathSpellings).
 * ⛔ NO IN-APP NAVIGATION MAY LAND THERE (speed plan item 11, 2026-10-17). Capacitor ≤8.4.2 answers
 * /_capacitor_http_interceptor_ ON THE APP'S OWN ORIGIN by fetching a URL of the caller's choosing (GHSA-rvm3-566m-v7fv,
 * critical): a navigation there runs someone else's page with the app's cookies, storage and native plugins. Every store
 * binary up to iOS 1.0.3 (3) and Android 1.0.2 embeds 8.4.2 and hands deep links, notification taps and ?next= to this
 * code. 8.4.3 binaries close it natively; old installs keep relying on this check.
 */
export function mayReachFrameworkPath(pathname: string): boolean {
  const spellings = pathSpellings(pathname)
  return !spellings || spellings.some((p) => p.startsWith('/_'))
}

export function canonicalAppPath(
  raw: string | null | undefined,
  opts: { blockAuthPaths?: boolean } = {},
): string | null {
  if (!raw || !raw.startsWith('/')) return null
  try {
    const resolved = new URL(raw, APP_ORIGIN)
    if (resolved.origin !== APP_ORIGIN) return null
    const spellings = pathSpellings(resolved.pathname)
    if (!spellings || spellings.some((p) => p.includes('\\'))) return null
    if (mayReachFrameworkPath(resolved.pathname)) return null
    // /auth + /signin rejected so a crafted link can't drive OAuth/sign-in routes.
    if (opts.blockAuthPaths && spellings.some((p) => p.startsWith('/auth') || p.startsWith('/signin'))) return null
    return resolved.pathname + resolved.search + resolved.hash
  } catch {
    return null
  }
}
