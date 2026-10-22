#!/usr/bin/env bash
# READ-ONLY auth-hardening check for the VN box (security review 2026-10-22, items 2, 4, 18, and 5's captcha half).
#   bash infra/vn-node/check-auth-hardening.sh
# It reads the RUNNING GoTrue (Supabase Auth) container's environment and reports, per setting, PASS or FIX with the
# exact remediation. It changes NOTHING — apply a fix the way apply-gotrue-db-pool.sh does: add the line(s) to
# /opt/eno/supabase/docker-compose.override.yml under services.auth.environment, then
# `cd /opt/eno/supabase && docker compose up -d --no-deps auth` (a ~5 s sign-in blip; run off-peak).
#
# WHY EACH ONE (full reasoning: the security review doc, and the app-side comments cited):
#  · GOTRUE_RATE_LIMIT_HEADER=CF-Connecting-IP — the email sign-in CODE is 6 digits (sign-in-form.tsx EMAIL_OTP_LEN)
#    and /auth/v1/verify is checked by GoTrue, NOT eno's own limiter. Without a rate-limit header GoTrue applies no
#    per-IP cap on verify, so a live code can be brute-forced — any account, support@eno.forum included. The origin
#    only accepts Cloudflare (authenticated origin pulls, eno.conf), so CF-Connecting-IP is the true client IP and
#    cannot be spoofed; a raw X-Forwarded-For header could be. This is the primary fix for item 2.
#  · GOTRUE_EXTERNAL_PHONE_ENABLED=false and GOTRUE_SMS_AUTOCONFIRM=false — eno's phone sign-in is OFF
#    (auth-policy.ts PHONE_OTP_ENABLED=false). The self-hosting template ships phone sign-up ON with autoconfirm,
#    which marks a phone CONFIRMED with no code sent. ensureProfile claims a guest storefront for good on a confirmed
#    phone (item 4). The app now distrusts confirmations stamped after phone sign-in went off (phoneConfirmationTrusted),
#    but closing it at the source is the real fix. When phone sign-in returns, SMS_AUTOCONFIRM must STAY false.
#  · GOTRUE_URI_ALLOW_LIST — GoTrue only redirects to an allow-listed URI, so this list must hold ONLY eno https
#    origins (no localhost in production, no wildcards). It bounds the implicit-flow redirect concern on the email
#    endpoints the nginx /authorize guard does not cover (item 18).
#  · GOTRUE_SECURITY_CAPTCHA_ENABLED / _PROVIDER — the password + signup endpoints lean on Turnstile in front
#    (item 5); report whether GoTrue itself enforces it too.
# Reported for awareness, not failed: GOTRUE_MAILER_OTP_LENGTH (8 is recommended — 100x the guess space of 6. Since the
# release where api/auth/email-link reports `codeLength` and the sign-in form sizes itself from it, the box can change
# it ON ITS OWN; on an older app release it must still move with EMAIL_OTP_LEN or sign-in breaks) and
# GOTRUE_DISABLE_SIGNUP (do NOT set true: it would block new OAuth and magic-link accounts too; the nginx
# `^/+auth/+v1/+signup` 404 is the narrow fix). GOTRUE_MAILER_OTP_EXP stays 3600 — the owner's 2026-10-05 decision,
# which apply-apple-signin.sh enforces; the per-IP limit above is what makes a live code unguessable.
set -euo pipefail
KEY="${ENO_SSH_KEY:-$HOME/.ssh/CS-Linux-20260920135129228.pem}"
HOST="${ENO_HOST:-root@162.4.176.233}"
PORT="${ENO_SSH_PORT:-24700}"
SB_DIR="${ENO_SB_DIR:-/opt/eno/supabase}"

ok(){ printf '  \033[32mPASS\033[0m  %s\n' "$1"; }
fix(){ printf '  \033[31mFIX \033[0m  %s\n' "$1"; FAILED=1; }
note(){ printf '  note  %s\n' "$1"; }
FAILED=0

# Pull the running auth container's full env once. `docker inspect` prints KEY=VALUE lines.
ENV_DUMP=$(ssh -i "$KEY" -p "$PORT" -o StrictHostKeyChecking=accept-new "$HOST" \
  "cid=\$(cd $SB_DIR && docker compose ps -q auth 2>/dev/null | head -1); [ -n \"\$cid\" ] && docker inspect --format '{{range .Config.Env}}{{println .}}{{end}}' \"\$cid\"" 2>/dev/null) \
  || { echo "cannot reach the box or read the auth container (ssh $HOST, $SB_DIR)"; exit 2; }
[ -n "$ENV_DUMP" ] || { echo "the auth container is not running or has no env"; exit 2; }

# Last occurrence wins, matching docker/compose.
val(){ printf '%s\n' "$ENV_DUMP" | grep -E "^$1=" | tail -1 | cut -d= -f2-; }

echo "auth hardening check — $HOST:$SB_DIR"

v=$(val GOTRUE_RATE_LIMIT_HEADER)
if [ "$v" = "CF-Connecting-IP" ]; then ok "GOTRUE_RATE_LIMIT_HEADER=$v (verify/token are rate-limited per real client IP)"
else fix "GOTRUE_RATE_LIMIT_HEADER='${v:-<unset>}' — set it to CF-Connecting-IP. Without it /auth/v1/verify is not rate-limited and the 6-digit email code is brute-forceable (item 2)."; fi

v=$(val GOTRUE_EXTERNAL_PHONE_ENABLED)
if [ "$v" = "false" ]; then ok "GOTRUE_EXTERNAL_PHONE_ENABLED=false (phone sign-up is off at the source)"
else fix "GOTRUE_EXTERNAL_PHONE_ENABLED='${v:-<unset, template default is true>}' — set false while eno phone sign-in is off (item 4)."; fi

v=$(val GOTRUE_SMS_AUTOCONFIRM)
if [ "$v" = "false" ]; then ok "GOTRUE_SMS_AUTOCONFIRM=false (a phone is confirmed only by a code)"
else fix "GOTRUE_SMS_AUTOCONFIRM='${v:-<unset, template default may be true>}' — set false so no phone is marked confirmed without a code (item 4)."; fi

v=$(val GOTRUE_URI_ALLOW_LIST)
case ",$v," in
  *localhost*|*127.0.0.1*|*"*"*) fix "GOTRUE_URI_ALLOW_LIST='$v' contains localhost/127.0.0.1 or a wildcard — restrict to eno https origins only (item 18)." ;;
  ,,) fix "GOTRUE_URI_ALLOW_LIST is empty/unset — set it to the exact eno https callback URLs so GoTrue redirects nowhere else (item 18)." ;;
  *) ok "GOTRUE_URI_ALLOW_LIST=$v (no localhost or wildcard)" ;;
esac

v=$(val GOTRUE_SECURITY_CAPTCHA_ENABLED)
if [ "$v" = "true" ]; then ok "GOTRUE_SECURITY_CAPTCHA_ENABLED=true (provider: $(val GOTRUE_SECURITY_CAPTCHA_PROVIDER))"
else note "GOTRUE_SECURITY_CAPTCHA_ENABLED='${v:-<unset>}' — eno enforces Turnstile in front of its own send routes, but GoTrue's /signup and /verify are stronger with GoTrue's own captcha on too (item 5)."; fi

# Awareness only — do not fail on these.
note "GOTRUE_MAILER_OTP_LENGTH=$(val GOTRUE_MAILER_OTP_LENGTH || true) (8 recommended. Safe to set alone once the app release whose sign-in form reads email-link's codeLength is live; on an older release it must move with EMAIL_OTP_LEN — see the header)."
dz=$(val GOTRUE_DISABLE_SIGNUP)
[ "$dz" = "true" ] && fix "GOTRUE_DISABLE_SIGNUP=true blocks NEW OAuth and magic-link accounts too — eno needs those. Unset it; the nginx 404 on /auth/v1/signup is the narrow block for password sign-up (item 5)." \
  || note "GOTRUE_DISABLE_SIGNUP='${dz:-<unset>}' (correct — the nginx /auth/v1/signup 404 is the narrow block; do not set this true)."

echo
[ "$FAILED" = 0 ] && { echo "All enforced auth-hardening settings pass."; exit 0; }
echo "One or more settings need fixing — add them to $SB_DIR/docker-compose.override.yml (services.auth.environment) and recreate auth. See the header."
exit 1
