/**
 * ENO's public channels — one list, rendered by the footer.
 *
 * Owner, 2026-09-18: "add all socials link on footer … plus facebook page
 * https://www.facebook.com/groups/1043790304690605 with follower counts for all socials".
 *
 * ✅ ALL SEVEN URLS WERE LOADED IN A REAL BROWSER ON 2026-09-18 and every one resolved: the page is
 * "Eno Vietnam | Ho Chi Minh City", the group is "Expats in Vietnam – Buy, Sell, Rent & Jobs | eno.vn",
 * and Instagram / Threads / Reddit / X / YouTube all answered 200. ⚠️ CURL IS NOT A TEST OF THESE —
 * both Facebook URLs return 400 to it and 200 to Chrome, so a link checker run with curl will report
 * two dead links that are not dead.
 *
 * ⛔ `followers` IS OPTIONAL AND EMPTY ON PURPOSE — A NUMBER NOBODY CAN VERIFY IS WORSE THAN NONE.
 * Every count here would have to be fetched, and measured 2026-09-18 none of them can be without
 * credentials this repo does not hold: Reddit's `about.json` refuses our requests, YouTube, X and
 * Threads render the figure in JavaScript, and Facebook/Instagram/Threads counts need a Meta Graph
 * token with `pages_read_engagement`. So the footer shows a count only where one is set here, and
 * shows the channel without it otherwise. Fill these in by hand, or give the app a YouTube Data API
 * key and a Meta token and a nightly job can keep them honest.
 *
 * ⚠️ THREE OF THE SEVEN WERE READ ON 2026-09-18 and are deliberately NOT filled in here: the page had
 * 503 followers, the group 1.7K members, Instagram 68 followers; Threads, Reddit, X and YouTube all
 * render theirs behind a login or in JavaScript this can't reach. Whether a footer should carry a
 * two-digit count at all is the owner's call, not a measurement — hence the numbers are recorded and
 * the badges stay off until someone says otherwise.
 *
 * ⚠️ ONE SET OF ACCOUNTS FOR BOTH EDITIONS, like the three links this replaced: the labels say "ENO",
 * which is true of eno.vn, of eno.forum and of the profiles themselves.
 */
export type Social = {
  key: 'facebook' | 'facebook-group' | 'instagram' | 'threads' | 'reddit' | 'x' | 'youtube'
  /** Accessible name, as "ENO on <channel>" is built in the footer. */
  label: string
  labelVi: string
  href: string
  /** Set only when the number is known to be current. Rendered as 1.2K / 12K / 1.2M. */
  followers?: number
  /**
   * `rel="me"` — an identity claim a consumer may follow back to verify the account is ours. True of
   * a profile we own; NOT of the community group, which is a place our members post, not an identity
   * of eno (a reviewer's catch).
   */
  me?: boolean
}

export const SOCIALS: Social[] = [
  { key: 'facebook', label: 'Facebook', labelVi: 'Facebook', href: 'https://www.facebook.com/profile.php?id=61591370031264', me: true },
  // The community group, which is a different surface from the page above.
  { key: 'facebook-group', label: 'the Facebook group', labelVi: 'nhóm Facebook', href: 'https://www.facebook.com/groups/1043790304690605' },
  { key: 'instagram', label: 'Instagram', labelVi: 'Instagram', href: 'https://www.instagram.com/eno.vn/', me: true },
  // ⚠️ MEASURED 2026-09-18, AND NOT WHAT THE FIRST COMMENT HERE CLAIMED: both threads.com and
  // threads.net answer, each 302ing a signed-out client to its OWN login page — neither redirects to
  // the other. threads.com is Meta's current canonical host, so it is the one linked.
  { key: 'threads', label: 'Threads', labelVi: 'Threads', href: 'https://www.threads.com/@eno.vn', me: true },
  { key: 'reddit', label: 'Reddit', labelVi: 'Reddit', href: 'https://www.reddit.com/user/eno_vn/', me: true },
  { key: 'x', label: 'X', labelVi: 'X', href: 'https://x.com/enovietnam', me: true },
  { key: 'youtube', label: 'YouTube', labelVi: 'YouTube', href: 'https://www.youtube.com/@enovietnam', me: true },
]

/**
 * 999 → "999", 1_200 → "1.2K", 12_300 → "12K", 1_240_000 → "1.2M".
 * ⚠️ THE BOUNDARIES ARE THE ROUNDED VALUE, NOT THE RAW ONE. 999_600 rounds to 1000K, so the
 * thousands branch has to stop below that or it prints "1000K" where "1M" belongs (a reviewer's
 * catch — dormant only because no count is set yet, which is exactly when it is cheap to fix).
 */
export function formatFollowers(n: number): string {
  if (n < 1000) return String(n)
  if (n < 9_950) return `${(n / 1000).toFixed(1).replace(/\.0$/, '')}K`
  if (n < 999_500) return `${Math.round(n / 1000)}K`
  return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`
}
