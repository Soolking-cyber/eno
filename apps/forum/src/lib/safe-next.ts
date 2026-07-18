// The ONE `next` validator for the forum's auth routes (audit Phase 1): bridge,
// callback, and handoff each carried their own copy, and callback's had drifted to
// the weakest form (no `..` / `\` rejection — browsers normalize `/\evil.com` to
// `//evil.com`, an open redirect). Strictest-of-all-copies, plus a decode fixpoint
// so percent-encoded smuggling (%2e%2e, %5c, %2f%2f) can't sneak past the literal
// checks. Relative-path-only by design: these routes always redirect within their
// own origin.
export function safeNext(value: string | null): string {
  if (!value || !value.startsWith('/') || value.startsWith('//') || value.includes('..') || value.includes('\\')) return '/'
  try {
    // Decode to a fixpoint (bounded) and re-check: what the browser ultimately
    // navigates is the decoded form.
    let current = value
    for (let i = 0; i < 3; i++) {
      const decoded = decodeURIComponent(current)
      if (decoded === current) break
      current = decoded
    }
    if (current.startsWith('//') || current.includes('..') || current.includes('\\') || /^\s*javascript:/i.test(current)) return '/'
  } catch {
    return '/' // malformed percent-encoding
  }
  return value
}
