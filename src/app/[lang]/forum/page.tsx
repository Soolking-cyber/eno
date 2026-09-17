import { redirect } from 'next/navigation'

/**
 * The legacy /forum path.
 *
 * ⚠️ IT MUST COMPARE ORIGINS, NOT JUST REDIRECT. This used to be an unconditional
 * `redirect(NEXT_PUBLIC_FORUM_URL || 'https://eno.forum')`, which was correct while eno.forum was a
 * different codebase. It is not any more: eno.vn and eno.forum are now two deployments of THIS repo,
 * so on the services deployment the peer URL and the app's own origin are the same host — and an
 * unconditional redirect sends /forum to itself forever. A 308 loop is not a subtle failure; the
 * browser gives up and the page is simply dead. The hardcoded fallback made it worse, because the
 * loop would happen even with the env var unset.
 *
 * So: send visitors to the PEER domain only when there is a peer to send them to, and otherwise
 * treat /forum as an alias for home on the domain that already is the forum.
 */
export default function LegacyForumRedirect() {
  const peer = process.env.NEXT_PUBLIC_FORUM_URL
  const self = process.env.NEXT_PUBLIC_APP_URL

  // Compare hosts rather than whole URLs — a trailing slash, a scheme or a www prefix differing
  // between two env vars must not read as "these are different sites" and reopen the loop.
  const host = (value: string | undefined) => {
    if (!value) return null
    try { return new URL(value).host.replace(/^www\./, '') } catch { return null }
  }

  const peerHost = host(peer)
  if (!peer || !peerHost || peerHost === host(self)) redirect('/')
  redirect(peer)
}
