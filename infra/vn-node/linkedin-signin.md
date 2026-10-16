# Sign in with LinkedIn — runbook (2026-10-15)

Owner decision 2026-10-15: "Add LinkedIn sign-in too". What it does and does not do:
- **Does:** one-tap account creation / sign-in for teachers (web only, teacher pages); LinkedIn sends the member's name,
  email, a 100px photo link and language. The name becomes the account name (offered in the teacher form).
- **Does not:** fetch jobs, education, skills or a profile URL. LinkedIn gives those to no self-serve app (Oct 2026:
  Apply with LinkedIn takes no new partners; Verified on LinkedIn closed Development/Lite to new developers on
  2026-10-14; the DMA portability API is for EEA-located members only). The profile itself is filled from the teacher's
  CV or LinkedIn's own "Save to PDF" file — `POST /api/teachers/me/import`.

## 1. The LinkedIn developer app (owner, once)
1. https://www.linkedin.com/developers/apps → **Create app**. Name `eno`, LinkedIn Page `linkedin.com/company/eno-vn`,
   privacy policy URL `https://eno.vn/privacy`, a square logo ≥100px. A Page super admin must approve the app's
   verification link within 30 days.
2. **A NEW app, not the page-posting one** — the Community Management API must be the only product on its app.
3. **Products → "Sign In with LinkedIn using OpenID Connect"** (self-serve, no review). Nothing else: requesting any other
   scope later invalidates every member's earlier tokens.
4. **Auth → Authorized redirect URLs:** exactly `https://sb.eno.vn/auth/v1/callback` (both editions use it; LinkedIn
   matches it byte for byte, no wildcards).
5. Copy the **Client ID** and **Primary Client Secret**.
6. ⛔ **Never replace this app later** — LinkedIn's member id (`sub`) is per app, so a new app orphans every LinkedIn
   identity. Rotate the secret instead (same app, then re-run the script).

## 2. Turn it on (after the deploy that carries /auth/linkedin/start)
```
LINKEDIN_CLIENT_ID='…' LINKEDIN_CLIENT_SECRET='…' DRY_RUN=1 bash infra/vn-node/apply-linkedin-signin.sh   # checks only
LINKEDIN_CLIENT_ID='…' LINKEDIN_CLIENT_SECRET='…' bash infra/vn-node/apply-linkedin-signin.sh
```
It refuses to write unless: `auth.flow_state` has the token columns its guard clears, `mailer_autoconfirm=false` (else GoTrue treats LinkedIn's unverified emails as verified and
links them into same-email accounts — a takeover), `disable_signup=false`, unverified-email sign-ins are off, the deployed
app has `/auth/linkedin/start`, and the box reaches LinkedIn's discovery (issuer `https://www.linkedin.com/oauth`) and
JWKS. It then writes the five `GOTRUE_EXTERNAL_LINKEDIN_OIDC_*` keys to `/opt/eno/supabase/.env` AND the one
`services.auth.environment` of `docker-compose.override.yml` (backups `*.bak-linkedin-*`), recreates `auth`, and verifies
`/auth/v1/settings` and that `/authorize` goes to **www**.linkedin.com (`…_URL=https://www.linkedin.com` — Supabase
#50831: the default api.linkedin.com host asks for the password every time). The token-guard trigger is installed
BEFORE any of that, and any failure after the first write restores both files from the backups and recreates `auth` —
the box is never left half-applied (the token guard stays: it only ever blanks LinkedIn's tokens). The id and secret must be LinkedIn's own characters (letters, digits, `._=+/-`).

The app needs no env: teacher pages read GoTrue's settings (cached 10 minutes; a failed probe 60 s, logged as
`[linkedin] settings probe …`).

**Test** with a LinkedIn test profile (API Terms 2.3: up to five, labelled "Test Profile at eno"): teacher.eno.vn on a
desktop browser → "Sign in with LinkedIn" → LinkedIn consent → back on `/teachers/join`, signed in; the CV door then
reads a file. Also on iPhone Safari and Android Chrome. Facebook/Zalo in-app browsers show the "open in your browser"
line instead (no LinkedIn session there).

## 3. What the code guarantees (do not undo)
- Notice beside every LinkedIn button, versioned (`LINKEDIN_NOTICE_VERSION`); the start route refuses another version.
- Consent recorded before the redirect (`auth.linkedin.consent`, actor unknown) and linked after
  (`auth.linkedin.consent.linked`); both in the account export with the sign-in identities.
- `/auth/callback` strips LinkedIn's 60-day access token from the session cookie; if that fails twice the sign-in is
  undone on that device (a LinkedIn token is a bearer token) — also when GoTrue's flow could not be read but the return
  is marked LinkedIn. GoTrue itself never stores it: the trigger `eno_drop_linkedin_provider_tokens` on
  `auth.flow_state` (installed by the script, checked by its VERIFY) blanks LinkedIn's tokens before GoTrue's callback
  writes them — an abandoned sign-in used to leave the token on that row. ⚠️ Re-run the script after a GoTrue upgrade.
  What is kept: GoTrue's identity row (and its copies in the user's metadata) — and the name and email LinkedIn gave a
  NEW account, which became that account's own name, @handle and sign-in email (the member changes them in Settings).
- An existing session is never replaced by a LinkedIn sign-in (`li=signed_in`); a cross-site start is refused.
- LinkedIn-sourced emails never reach Meta/TikTok conversion signals (`adEmailWithheld`, D14 widened), and a LinkedIn
  sign-up starts with the marketing digest OFF (API Terms 3.1(10)).
- Never "LinkedIn verified" anywhere (API Terms 3.1(11)); LinkedIn's name/logo only inside the app — not in ads, FB
  comments or guides without LinkedIn's approval (Trademark@LinkedIn.com, API Terms 6.1). The button is text-only until
  LinkedIn's official [in] asset is dropped in unmodified (≥21px).

## 4. A member asks us to delete what LinkedIn sent (API Terms 4.4; PDPL)
Within 20 days, on the box (psql as the owner role):
```sql
-- FIRST the copies GoTrue keeps in the user's metadata: the keys whose values are LinkedIn's (compared with the LinkedIn
-- identity's own data). A value another identity sent too (the same email or name from Google) goes from this merged
-- copy as well — that identity keeps its own data in auth.identities …
UPDATE auth.users u SET raw_user_meta_data = (
    SELECT coalesce(jsonb_object_agg(e.k, e.v), '{}'::jsonb) FROM jsonb_each(u.raw_user_meta_data) AS e(k, v)
    WHERE NOT EXISTS (SELECT 1 FROM auth.identities i WHERE i.user_id = u.id AND i.provider = 'linkedin_oidc' AND i.identity_data -> e.k = e.v))
  WHERE u.id = '<uuid>';
-- … THEN the LinkedIn identity itself (name, email, picture link, locale, member id) …
DELETE FROM auth.identities WHERE user_id = '<uuid>' AND provider = 'linkedin_oidc';
-- … and LinkedIn from the account's sign-in methods (the app reads these: "made with LinkedIn", D14) — the sign-up
-- provider becomes the oldest identity left, or email
UPDATE auth.users SET raw_app_meta_data = jsonb_set(
    CASE WHEN raw_app_meta_data->>'provider' = 'linkedin_oidc'
      THEN jsonb_set(raw_app_meta_data, '{provider}', to_jsonb(coalesce((SELECT provider FROM auth.identities WHERE user_id = '<uuid>' ORDER BY created_at LIMIT 1), 'email')))
      ELSE raw_app_meta_data END,
    '{providers}', coalesce(raw_app_meta_data->'providers', '[]'::jsonb) - 'linkedin_oidc')
  WHERE id = '<uuid>';
```
If LinkedIn was their only sign-in method they lose it — tell them to sign in with an emailed code to the same address
first. The account's own name, @handle and sign-in email came from LinkedIn at sign-up and stay the account's: say so,
and that they change them in Settings (or ask us to reset the name to the masked handle). Account deletion removes all
of it (`account-erasure.ts` deletes the auth user and the profile).

## 5. Incidents
A breach touching LinkedIn data: report to security@linkedin.com within 24 hours (API Terms 7.1), besides A05 (72 h).
