// One mailbox, one account.
//
// support@eno.vn is NOT a mailbox — it is a Cloudflare Email Routing redirect into
// support@eno.forum, which is the real private mail (owner, 2026-07-22). Supabase Auth
// has no concept of that: it keys accounts on the literal address string, so signing in
// as support@eno.vn would mint a SECOND account for what is physically the same inbox.
//
// That already happened once. On 2026-07-22 a single character (.forum vs .vn) created a
// blank duplicate account that the owner then onboarded into, while their real account —
// business type, five live conversations — sat untouched under the other address.
//
// So aliases are resolved to a canonical address BEFORE anything keys off them: the
// token is minted for the canonical account, and either address gets you into it.
//
// ⚠️ Deliberately a fixed map, NOT a rule like "rewrite every @eno.vn to @eno.forum".
// A rule would silently merge unrelated staff addresses into one login the moment
// someone adds sales@ or billing@. New alias, new line here — and the line is a
// statement about mail routing, so it must be changed IN STEP with the actual routing
// config, never ahead of it. Adding an entry for an address that does NOT redirect
// hands that account's access to whoever owns the real mailbox.
const ALIASES: Readonly<Record<string, string>> = {
  'support@eno.vn': 'support@eno.forum',
}

/**
 * The address an account is keyed on. Input should already be trimmed + lowercased.
 * Returns the input unchanged when it isn't an alias, which is the overwhelming case.
 */
export function canonicalEmail(email: string): string {
  return ALIASES[email] ?? email
}

/** True when `email` is only a redirect, so no account may be created under it. */
export function isAliasEmail(email: string): boolean {
  return email in ALIASES
}
