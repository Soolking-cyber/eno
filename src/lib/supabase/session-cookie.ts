// ⛔ NO IMPORTS. The root layout inlines SESSION_COOKIE_NAME_JS into the pre-paint head script, and src/test/head-script.ts
// reads it to run that script in tests; keep this module free of anything a layout or a test cannot load.

/**
 * THE NAME OF THIS BUILD'S SUPABASE SESSION COOKIE, derived from NEXT_PUBLIC_SUPABASE_URL exactly as supabase-js derives
 * its storage key: `sb-${baseUrl.hostname.split('.')[0]}-auth-token`, where baseUrl is the URL trimmed, required to start
 * with http:// or https://, and parsed with a trailing slash (@supabase/supabase-js 2.111.0, dist/index.cjs:1270 and its
 * validateSupabaseUrl). browser.ts passes neither `auth.storageKey` nor `cookieOptions.name` (the one override
 * @supabase/ssr's createBrowserClient applies), so this is the cookie, or its `.0` chunk, the browser client reads a
 * session from: `sb-sb-auth-token` for https://sb.eno.vn, `sb-127-auth-token` for the local http://127.0.0.1:54321.
 *
 * ⛔ ONE NAME, NOT A PATTERN. A browser can hold another project's session cookie: eno.vn used the Supabase Cloud project
 * `xihiryllwmjoouipkyhw` until 2026-08-22, and @supabase/ssr's removeItem clears only the chunks of the CURRENT key, so
 * signing out never removes that one. This client never reads it, so it is no sign of a session here.
 *
 * null for an unset or invalid URL, or a first host label outside [a-z0-9_-] (the name is written into an inline script
 * as a string literal): no name means no rail-hint, today's behaviour.
 */
export function sessionCookieName(supabaseUrl: string | null | undefined): string | null {
  const url = supabaseUrl?.trim()
  if (!url || !/^https?:\/\//i.test(url)) return null
  let host: string
  try {
    host = new URL(url.endsWith('/') ? url : `${url}/`).hostname
  } catch {
    return null
  }
  const ref = host.split('.')[0]
  return /^[a-z0-9_-]+$/.test(ref) ? `sb-${ref}-auth-token` : null
}

/** This build's session cookie name (computed once, on the server, from the inlined public URL), or null. */
export const SESSION_COOKIE_NAME = sessionCookieName(process.env.NEXT_PUBLIC_SUPABASE_URL)

/** The same as a JavaScript literal for the head script: `"sb-sb-auth-token"`, or `null`. */
export const SESSION_COOKIE_NAME_JS = JSON.stringify(SESSION_COOKIE_NAME)
