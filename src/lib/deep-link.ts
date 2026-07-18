// The ONE canonicalize-then-validate helper for in-app path navigation (audit Phase 1:
// two validators existed at two strictness levels — native-bootstrap's full discipline
// vs native-push's bare startsWith('/'), which accepted `//evil.com`-class input and
// navigated the TRUSTED NATIVE SHELL to it).
//
// Pure and isomorphic: resolve the raw value against the app origin, reject anything
// that escapes it (protocol-relative `//…`, backslash `/\…` — the URL parser treats \
// as / in special schemes), decode the pathname to a bounded fixpoint so double-encoded
// smuggling can't slip past prefix checks, and (optionally) refuse auth-flow paths.

export function canonicalAppPath(
  raw: string | null | undefined,
  opts: { blockAuthPaths?: boolean } = {},
): string | null {
  if (!raw || !raw.startsWith('/')) return null
  try {
    const resolved = new URL(raw, 'https://eno.vn')
    if (resolved.origin !== 'https://eno.vn') return null
    let probe = resolved.pathname
    for (let i = 0; i < 3; i++) {
      let decoded: string
      try { decoded = decodeURIComponent(probe) } catch { break }
      if (decoded === probe) break
      probe = decoded
    }
    if (probe.includes('\\')) return null
    // /auth + /signin rejected so a crafted link can't drive OAuth/sign-in routes.
    if (opts.blockAuthPaths && (probe.startsWith('/auth') || probe.startsWith('/signin'))) return null
    return resolved.pathname + resolved.search + resolved.hash
  } catch {
    return null
  }
}
