# Continue with Facebook — the owner's runbook

Owner, 2026-10-16: *"in facebook browser sign in doesnt show google sign in or apple sign in we have to fix it to make
signing in as easy as possible if needed add sign in with facebook"*. 85% of teacher.eno.vn's visitors arrive in
Facebook's in-app browser, where Google refuses to run. The code ships DARK: no button anywhere until GoTrue reports
`external.facebook: true`, which only `apply-facebook-signin.sh` turns on — AFTER the deploy (the script refuses before).

## 1. The Meta app (developers.facebook.com, as the eno business admin)

1. **My Apps → Create app.** Use case: **Authenticate and request data from users with Facebook Login**. App type, if
   asked: **Consumer**. Name: `eno.vn`. Contact email: `support@eno.vn`. Business portfolio: the one that owns the
   eno.forum ad account (optional, not required for Login).
2. **Use cases → Authentication and account creation → Customize → Permissions:** `public_profile` (always on) and
   **`email` → Add**. Nothing else — both need NO App Review (Meta, Login Review: "If your app requests more than
   public_profile and email, it must be reviewed").
3. **Facebook Login → Settings:**
   - Client OAuth login: **Yes** · Web OAuth login: **Yes** · Enforce HTTPS: **Yes**
   - Use Strict Mode for redirect URIs: **Yes**
   - **Valid OAuth Redirect URIs: `https://sb.eno.vn/auth/v1/callback`** (exactly — GoTrue's callback, not eno.vn's)
   - Login from Devices: No · Login with the JavaScript SDK: No (we use the redirect flow)
4. **App settings → Basic:**
   - App domains: `eno.vn`, `sb.eno.vn`
   - Privacy Policy URL: `https://eno.vn/privacy`
   - Terms of Service URL: `https://eno.vn/terms`
   - **User data deletion → Data deletion instructions URL: `https://eno.vn/privacy#your-rights`** (Settings › Account
     deletes the account and everything with it, the Facebook link included)
   - App icon (1024×1024, the eno mark), Category: **Business and pages** (or Shopping)
   - **+ Add platform → Website**, Site URL `https://eno.vn/`
   - Copy the **App ID** and the **App secret** (Show → re-enter the password). ⚠️ NOT the Client Token on
     Settings › Advanced — it is also 32 hex characters.
5. **Publish (top bar): switch the app to Live.** In Development mode only people with a role on the app can sign in;
   everyone else gets "App not active".

## 2. GoTrue on the box (after the deploy that carries this code)

```bash
cd ~/eno.vn && git pull
FACEBOOK_APP_ID='<the App ID>' FACEBOOK_APP_SECRET="$(pbpaste)" DRY_RUN=1 bash infra/vn-node/apply-facebook-signin.sh
FACEBOOK_APP_ID='<the App ID>' FACEBOOK_APP_SECRET="$(pbpaste)" bash infra/vn-node/apply-facebook-signin.sh
```

Copy the App secret right before each line (`pbpaste` keeps it out of the shell history and the transcript). The
script refuses unless the deployed app has the Facebook code and both editions' /privacy already name Facebook sign-in,
`mailer_autoconfirm` is off (Facebook emails link into
same-email accounts — safe only while unverified emails never count), sign-ups are open and `auth.flow_state` has the
token columns. It installs two database guards FIRST — a trigger that keeps Facebook's access token out of
`auth.flow_state`, and one on `auth.identities` that never ADDS a Facebook identity to an account someone already uses —
confirmed, or ever signed in to (GoTrue links by email and counts Facebook's emails as verified — an account takeover if
Facebook ever returned an unconfirmed address); an email-code sign-up nobody finished is GoTrue's own case and links —
nor creates one for an ADMIN_EMAILS address (copied from both app containers; **re-run the script
whenever ADMIN_EMAILS changes**). Someone whose email already has an eno account is told to sign in the way they did
before. Then it writes
GoTrue's env (secret via stdin and python's environment — never an argv), recreates GoTrue only (a few seconds of failed
sign-ins on both editions: run it at 19:00–22:00 UTC), and proves: `external.facebook` true, the token trigger blanks a
token, the link guard (run as GoTrue's own database role) refuses an account in use, an old account with no identity row
and an operator, and allows a new account and an unfinished email-code sign-up, `/authorize` goes to
`www.facebook.com/dialog/oauth` with this App ID and the `sb.eno.vn` callback. After a Supabase upgrade, `DRY_RUN=1`
says whether both triggers are still there (and fails if Facebook is on without them) — and sign up once with a fresh
Facebook test account: a GoTrue that confirmed new accounts before writing their identity would make the link guard refuse
every new one. Any failure puts
`.env` and the compose override back (`*.bak-facebook-<stamp>`).

## 3. Test (≤15 minutes after the script, in a sign-in opened after that: the server's 10-minute probe + a tab's 5)

1. **iPhone, Facebook app:** open a Messenger chat with yourself, send `https://eno.vn/signin`, tap it (Facebook's
   in-app browser). Under the email code: "Continue with Facebook" and "Continue with Google". Tap Facebook.
   **Write down what Facebook shows:** "Continue as <name>" with one tap (the hope) — or a Facebook password screen.
   Finish: you land back signed in.
2. **Android, Facebook app:** the same. ⚠️ Meta ended Facebook Login in Android *embedded* browsers in 2021 (other apps'
   webviews — the code hides the button there); whether Facebook's own Android browser still lets its dialog run is
   exactly what this step finds out. If it says "logging into Facebook from an embedded browser is disabled", tell
   Claude: the button comes off Android in-app browsers in one line.
3. **Desktop Chrome, signed out of eno:** /signin shows Google, Apple, Facebook, then email. Facebook → back signed in.
4. **Cancel** at Facebook's dialog: back on /signin, no error toast.
5. **Admin › Users:** the new account has a name and an email; no photo (Facebook's picture link expires — never kept).
6. **An existing account:** with a Facebook account whose email already has an eno account (e.g. one you made with the
   email code), Continue with Facebook ends on "This email address already has an account here…" — and that account
   still signs in by code.

**Promote Facebook to the top in Facebook's own browser** only when step 1–2 showed "Continue as …" AND the counters
agree: `set -a; . ./.env; set +a; npx tsx scripts/signup-prompt-report.ts --days 7` (read-only) — the gates' `facebk`
column vs `completed`, in-app vs browser. One line in sign-in-form.tsx (the in-app block's order).

## Undo

`cd /opt/eno/supabase && cp .env.bak-facebook-<stamp> .env && cp docker-compose.override.yml.bak-facebook-<stamp>
docker-compose.override.yml && docker compose up -d auth` — the buttons disappear within ~15 minutes (until then a tap
says "Facebook sign-in didn't start"). Both
triggers and the operators' table stay on purpose: they only ever act on Facebook rows (a token blanked, a link
refused), so they protect any later re-enable too — to drop them: `DROP TRIGGER eno_drop_facebook_provider_tokens ON
auth.flow_state; DROP TRIGGER eno_refuse_facebook_identity ON auth.identities;` as supabase_admin. Accounts made with
Facebook keep working by email code.
