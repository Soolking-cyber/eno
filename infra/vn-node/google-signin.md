# Google sign-in on the VN box

⛔ **Blocked on ONE credential that only the Google Console can give you:
`GOOGLE_CLIENT_SECRET`.** It exists nowhere today — not in `eno-root-env`, not in
`eno-services-env`, not on the box. Verified 2026-08-22. Everything else is built,
tested and waiting.

## What is already done

- **Our own button, not Google's.** `<Button variant="ghost">` with our `GoogleIcon`,
  bilingual copy, busy state, and the in-app-browser handoff — `sign-in-form.tsx`.
- **Our own OAuth round-trip** so the consent screen reads **eno.vn**, not a Supabase
  project ref. `src/lib/auth/google-oauth.ts` + `/auth/google/{start,callback}`.
  **14/14 unit tests pass**, covering the parts that fail silently and totally: the
  nonce is sent to Google as a hex SHA-256 digest and to Supabase as the pre-image
  (GoTrue re-hashes it), PKCE sends the challenge and never the verifier, and the
  `redirect_uri` is byte-identical between authorize and token.
- **A fallback that cannot strand anyone.** Every failure redirects to
  `/signin?g=fallback`, which runs `signInWithOAuth` instead — an unbranded consent
  screen rather than no sign-in at all.

## Why it needs the secret at all

Google's consent screen prints the **redirect host** of the OAuth client, and nothing
in the Console changes that line. Two earlier attempts are recorded in
`google-oauth.ts`: `signInWithOAuth` reads *"to continue to
xihiryllwmjoouipkyhw.supabase.co"*, and Google Identity Services fixes the name but
renders a cross-origin iframe that cannot be styled and refuses clicks while hidden.
Owning the redirect is the only way to get **both** our design and our domain — and
owning the redirect means doing the code-for-token exchange ourselves, which Google
requires a client secret for on a Web application client.

## Step 1 — get the secret (owner)

Google Cloud Console → **APIs & Services → Credentials** → the OAuth 2.0 Web client
whose ID starts `71068369681-…` → **Client secret**.

⚠️ That project number is load-bearing: two GCP projects are both named "eno-vn".
Match the client ID, not the project name.

## Step 2 — register the redirect URIs (owner, same screen)

Add **all** of these under *Authorized redirect URIs*. Our flow and the fallback use
different ones, and both must work:

```
https://eno.vn/auth/google/callback              ← our flow
https://www.eno.vn/auth/google/callback
https://eno.forum/auth/google/callback
https://www.eno.forum/auth/google/callback
http://localhost:3000/auth/google/callback       ← dev
https://sb.eno.vn/auth/v1/callback               ← fallback, box GoTrue
```

⛔ The four app hosts are exactly `ALLOWED_AUTH_HOSTS` in `google-oauth.ts`. A host
missing here fails **after** the visitor has already picked their account — the worst
place in the funnel to fail.

## Step 3 — apply it

```bash
GOOGLE_CLIENT_SECRET='…' bash infra/vn-node/apply-google-signin.sh
```

That script sets the secret on both app containers and configures the box's GoTrue
(`GOTRUE_EXTERNAL_GOOGLE_ENABLED/CLIENT_ID/SECRET/REDIRECT_URI`), restarts, and
verifies. It refuses to run with an empty secret.

⛔ **Never set a placeholder secret.** `googleOauthConfigured()` checks only that the
secret is non-empty, so a placeholder *activates* the first-party flow, which then
fails at Google's token endpoint — and the fallback it drops to needs the same real
secret. A placeholder turns one broken path into two.

## Step 4 — verify (not by eye)

```bash
# the box's GoTrue must now report the provider enabled
curl -s https://sb.eno.vn/auth/v1/settings -H "apikey: $ANON" | jq .external.google   # true

# /auth/google/start must send you to Google, NOT bounce to the fallback
curl -sk -o /dev/null -w '%{http_code} %{redirect_url}\n' \
  --resolve eno.vn:443:127.0.0.1 'https://eno.vn/auth/google/start?next=%2F'
#   307 https://accounts.google.com/o/oauth2/v2/auth?...   ← working
#   307 https://eno.vn/signin?g=fallback...                ← still not configured
```

⚠️ The consent screen itself is the real test, and it is the whole point: it must read
**"to continue to eno.vn"**. If it names a Supabase host, the fallback ran.
