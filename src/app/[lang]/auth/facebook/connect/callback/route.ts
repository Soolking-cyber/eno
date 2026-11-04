import { canonicalAuthOrigin, stateMatches } from '@/lib/auth/google-oauth'
import { connectFacebookIdentity, fbTxCookieName, isConnectState, readFacebookProfile } from '@/lib/auth/facebook-connect'
import { createSupabaseServer } from '@/lib/supabase/server'
import { authRedirect } from '@/lib/auth-finish'
import { renderFacebookConnectedEmail } from '@/lib/emails/facebook-connected'
import { logError } from '@/lib/log'
import { sendMail } from '@/lib/mail'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** The `fb` values Settings › Privacy turns into a sentence (facebook-connect-row.tsx). */
const OUTCOME_PARAM: Record<string, string> = {
  ok: 'connected',
  already: 'connected',
  other_facebook: 'other',
  held_elsewhere: 'held',
  operator: 'refused',
  no_account: 'failed',
  no_email: 'failed',
  bad_input: 'failed',
}

// Where Facebook returns the visitor. ⛔ THESE MUST AGREE before anything is read from Facebook: the full state, the httpOnly
// cookie that holds it, and the live signed-in user against the user who started. Together they close link CSRF in both
// directions: a Facebook URL or a callback URL sent to someone else finds no matching cookie in that browser.
export async function GET(request: Request) {
  const url = new URL(request.url)
  const origin = canonicalAuthOrigin(request)
  // Only the shape we mint: a newline in a hand-made state would make setting the cookie throw (commit gate, opus).
  const givenState = url.searchParams.get('state')
  const state = isConnectState(givenState) ? givenState : null
  const code = url.searchParams.get('code')

  const cookieName = state ? fbTxCookieName(state) : null
  // No RegExp from `state`: it is caller-supplied (see the Google callback).
  const raw = cookieName
    ? request.headers.get('cookie')?.split('; ').find((c) => c.startsWith(`${cookieName}=`))?.slice(cookieName.length + 1)
    : null
  // ⚠️ VALID JSON IS NOT AN OBJECT: `null` parses fine, and reading a field of it would be a 500 (commit gate, codex).
  let tx: { s?: unknown; u?: unknown } = {}
  try {
    const parsed: unknown = raw ? JSON.parse(decodeURIComponent(raw)) : null
    if (parsed && typeof parsed === 'object') tx = parsed
  } catch { tx = {} }

  // Whatever happens, the transaction is burned on the way out: one try per cookie.
  const finish = (fb: string | null) => {
    const res = authRedirect(`${origin}/dashboard/settings?tab=privacy${fb ? `&fb=${fb}` : ''}`)
    if (cookieName) res.cookies.set(cookieName, '', { path: '/', maxAge: 0 })
    return res
  }

  // Declining Facebook's dialog is a decision, not a failure: back to the row, no message.
  if (url.searchParams.get('error')) return finish(null)
  if (!code || !state || typeof tx.s !== 'string' || typeof tx.u !== 'string') return finish('failed')
  if (!stateMatches(state, tx.s)) return finish('failed')

  try {
    const sb = await createSupabaseServer()
    const [{ data }, { data: live }] = await Promise.all([sb.auth.getClaims(), sb.auth.getUser()])
    // getUser asks GoTrue: getClaims alone verifies locally, and would let a session Disconnect just ended keep going until its
    // access token expires (commit gate, opus).
    if (data?.claims?.sub !== tx.u || live?.user?.id !== tx.u) return finish('failed')

    const read = await readFacebookProfile(code, origin)
    if (!read.ok) return finish('failed')

    const outcome = await connectFacebookIdentity(tx.u, read.profile)
    // The session's JWT carries app_metadata.providers; a fresh one names Facebook at once. Best effort: the next refresh does it.
    if (outcome === 'ok') {
      await sb.auth.refreshSession().catch((e: unknown) => logError(e, { op: 'facebook-connect.refresh' }))
      // Told to the account's own address. Best effort: the link has happened, and a failed mail must not read as a failed link.
      // GoTrue's answer, not the token's: a token can name an address the account has since left.
      const email = live?.user?.email ?? null
      if (email) {
        const lang = request.headers.get('cookie')?.split('; ').includes('lang=vi') ? 'vi' : 'en'
        // sendMail answers false rather than throwing, and this notice is what a phished owner would recover by: never silently lost.
        const sent = await sendMail({ to: email, ...renderFacebookConnectedEmail({ origin, lang }) }).catch(() => false)
        if (!sent) logError(new Error('notice not sent'), { op: 'facebook-connect.notice' })
      }
    }
    return finish(OUTCOME_PARAM[outcome] ?? 'failed')
  } catch (e) {
    logError(e, { op: 'facebook-connect.callback' })
    return finish('failed')
  }
}
