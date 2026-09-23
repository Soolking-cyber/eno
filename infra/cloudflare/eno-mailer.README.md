# eno-mailer — cutover runbook (Cloudflare Email Sending primary, Resend fallback on eno.vn)

Owner decision, 2026-09-23: **"resend fallback"**. It replaced that morning's "hard cut, no Resend
at all". After this runbook, every email the app sends (sign-in links and codes, KYC and
business-verification outcomes, payout-change alerts, e-Visa results) goes app → `eno-mailer`
Worker → Cloudflare Email Sending **first**. Then:

- **eno.vn falls back to Resend** when the Worker does not accept a message: it is unreachable,
  times out, answers 5xx, 429 (quota or budget), 401/403 (key, clock, plan) or a config error.
  `src/lib/mail.ts` sends the same message through Resend with the same idempotency key, inside the
  caller's deadline. It does **not** fall back when the Worker accepted the message, or refused it
  for the recipient (`suppressed`, `invalid`), its size (`too_large`) or as a duplicate
  (`idempotency_conflict`): Resend would bounce or double-send those.
- **eno.forum has no fallback.** eno.forum is not verified in Resend, and the only sender Resend
  would take is eno.vn, so a forum email must never go through it. The check is the edition,
  inlined at build time: the forum image ignores `RESEND_API_KEY` and `MAIL_FROM` even if they are
  set. If the Worker cannot send, the forum sends nothing and logs it.

The weekly digest is marketing and stays off on both transports: `mail.ts` refuses marketing
before it picks one.

**Mail env per container, after step 7:**

| Container | Env file | Mail variables |
|---|---|---|
| eno.vn (`eno-vn-app`) | `/opt/eno/secrets/eno-vn.env` | `MAILER_URL` + `MAILER_KEY` (the vn key, step 5b), and it **keeps** `RESEND_API_KEY` + `MAIL_FROM` (the fallback; both must be set) |
| eno.forum (`eno-forum-app`) | `/opt/eno/secrets/eno-forum.env` | `MAILER_URL` + `MAILER_KEY` (the forum key) **only**. Its old `RESEND_API_KEY` and `MAIL_FROM` come out in step 8 |

| File | What it is |
|---|---|
| `infra/cloudflare/eno-mailer.js` | The Worker. Its header documents the request contract, budget and logs. |
| `infra/cloudflare/deploy-mailer.sh` | Deploy, set secrets, show status (steps 4–5, from a laptop). |
| `src/lib/mail.ts` | The app side: signs requests with this edition's key, falls back to Resend on eno.vn only, never throws. |
| `scripts/mailer-smoke.mjs` | One signed test send, for step 6. |
| `scripts/email-suppression.mjs` | API fallback for lifting a suppression. The dashboard is the primary path ("Operating it"). |

**Who does what.** Every step below is a live Cloudflare, DNS, box or deploy action. The operator
runs them, in order. Do not start the app deploy (step 7) until step 6 passes for **both**
editions: after that deploy the Worker is eno.forum's only mail path, and eno.vn's primary one.

---

## 0. Pre-flight (no changes yet)

1. **Workers Paid.** Email Sending does not work without it: sends to ordinary recipients fail with
   `not_entitled`. Check **Dashboard → Workers & Pages → Plans**.
2. **Volume against the quota.** The account quota measured 2026-09-23 is **1,000 emails/day**
   (`GET /accounts/{id}/email/sending/limits`), shared by both editions. Read the last 30 days of
   sends per day from the Resend dashboard. If the busiest day is above ~500, file Cloudflare's
   limit-increase request **before** cutover, then raise `DAILY_QUOTA` at deploy time (step 4).
3. **Turn OFF "Email preview" on eno.vn** (Email Service → Sending → eno.vn → Settings). With it
   on, Cloudflare keeps message bodies for about 7 days, and a sign-in body is a live magic link or
   code. Keep **"Drop suppressed recipients" OFF**, so a suppressed address produces an explicit
   error (the app logs it) instead of a silent drop.
4. **Privacy and the PDPL dossier.** Cloudflare starts receiving full message bodies and recipient
   addresses at the first send. The privacy page and `docs/compliance/pdpl-dossier-draft.md` must
   list Cloudflare for transactional email (and the 30-day activity-log retention) **before step
   7**. Resend stays listed too: it still carries eno.vn's mail whenever the fallback fires. That
   change is owned elsewhere; do not start step 7 until it is live.
5. **Carry Resend's suppressions over (recommended).** A new sender that re-mails addresses Resend
   already knows bounce or complained spends reputation in its first days, which is when it has
   the least. Export Resend's bounced and complained addresses, then import them with
   `POST /accounts/{id}/email/sending/suppressions/bulk`. That endpoint allows 10 requests a
   minute. ⛔ It needs an **Email Sending: Edit** token, which can also send as both domains: create
   it on your laptop with an end date a few hours out, never put it on the box, and revoke it when
   the import is done (the same rules as the suppression fallback in "Operating it").
6. **GoTrue is out of scope.** The Supabase auth mailer (change-email confirmations) is not touched
   by this runbook. It points at the local mail catcher, which is a separate bug.

## 1. Onboard eno.forum for Email Sending

eno.vn has been onboarded since 2026-09-22 (DKIM selector `cf-bounce`, return path
`cf-bounce.eno.vn`). eno.forum is not.

1. **Preview first:** `POST /zones/{eno.forum zone id}/email/sending/subdomains/preview` (or the
   dashboard's preview). It lists the records onboarding will write:
   - MX `cf-bounce.eno.forum` → route1/2/3.mx.cloudflare.net
   - TXT `cf-bounce.eno.forum` `v=spf1 include:_spf.mx.cloudflare.net ~all`
   - TXT `cf-bounce._domainkey.eno.forum` (the DKIM key)
   - possibly `_dmarc.eno.forum` `v=DMARC1; p=reject;`
2. ⛔ **DMARC.** Today `_dmarc.eno.forum` is `v=DMARC1; p=none; rua=mailto:support@eno.forum`,
   and staff mail from support@eno.forum goes out through PrivateEmail. If onboarding would
   overwrite it with `p=reject`, any PrivateEmail message without DKIM alignment (`d=eno.forum`)
   starts bouncing. If it would *add* a second record, DMARC is void (RFC 7489: several records
   mean no policy). So: send a test from support@eno.forum through PrivateEmail first and confirm
   `dkim=pass header.d=eno.forum`; then onboard; then **immediately** make sure there is exactly
   one `_dmarc.eno.forum` TXT, still `p=none` with the same `rua`.
3. Onboard eno.forum (dashboard: Email Service → Sending → Add domain, or
   `POST /zones/{id}/email/sending/subdomains`). None of this touches the PrivateEmail records
   (apex MX, apex SPF, `privateemail._domainkey`).
4. Verify with DNS, not the dashboard:
   ```bash
   dig +short MX cf-bounce.eno.forum
   dig +short TXT cf-bounce.eno.forum
   dig +short TXT cf-bounce._domainkey.eno.forum
   dig +short TXT _dmarc.eno.forum      # exactly ONE line, p=none
   ```
5. On eno.forum too: **Email preview OFF**, **Drop suppressed recipients OFF**.

## 2. A token that can deploy — on your laptop, short-lived

Everything from here to step 5a runs on **your laptop**, not the box. The box's
`/opt/eno/secrets/cf-token` is **purge-scoped**: a Workers PUT with it fails with "No access to the
specified resource". Create a token (My Profile → API Tokens → Create Token → Custom token) with:
- Account · **Workers Scripts: Edit**
- Account · **Workers KV Storage: Edit** (it creates the namespace in step 3; Read is enough after)
- Account · **Email Sending: Edit**, only if the upload refuses the `send_email` bindings
- **TTL:** give it an end date a few hours out.

Hand it to the scripts without typing it into a command line (an inline `CF_TOKEN=…` or
`export CF_TOKEN=…` lands in shell history):
```bash
umask 077
pbpaste > ~/.eno-cf-token && chmod 600 ~/.eno-cf-token   # or: read -rs CF_TOKEN && export CF_TOKEN
export CF_TOKEN_FILE=~/.eno-cf-token
```
`deploy-mailer.sh` only ever hands it to curl through a mode-0600 config file, never on a command
line.

⚠️ **This token never goes on the box, and you revoke it after step 5a.** The per-edition keys
isolate one **container** from the other: the forum container cannot send as eno.vn. They do not
protect against someone who has root on the box. Anyone holding a Workers-edit token can redeploy
`eno-mailer` with a `send_email` binding that has no sender restriction. With Email Sending: Edit
it can send as either domain directly, without the Worker at all.

## 3. Create the KV namespace

Dashboard → Storage & Databases → KV → Create namespace **`eno-mailer`**, or, with the step-2 token:
```bash
curl -sS --config <(printf 'header = "Authorization: Bearer %s"\n' "$(cat "$CF_TOKEN_FILE")") \
  -X POST https://api.cloudflare.com/client/v4/accounts/c91cf27edd31b01aba677ac9e007d569/storage/kv/namespaces \
  -H 'content-type: application/json' --data '{"title":"eno-mailer"}'
```
It holds idempotency records (24 h) and the daily counters (48 h). An idempotency record is a
messageId and the SHA-256 of the request body it was sent for; nothing readable about the recipient
or the message is stored. `deploy-mailer.sh` finds the namespace by title; export `MAILER_KV_ID` to
pin the id instead.

## 4. Deploy the Worker (laptop)

Run it from a **scratch checkout** of the commit that carries this runbook, on your laptop, with
`CF_TOKEN_FILE` from step 2. Do **not** use `/opt/eno/app` or the box: the token does not go there.
The script needs `bash`, `curl` and `python3`.
```bash
git clone --depth 1 <origin> ~/scratch/eno-mailer && cd ~/scratch/eno-mailer   # the commit with this file
./infra/cloudflare/deploy-mailer.sh      # add DAILY_QUOTA=… if Cloudflare raised the limit
```
What it does:
- PUTs `eno-mailer.js` with **every** binding in the metadata: `EMAIL_VN`
  (`allowed_sender_addresses: [no-reply@eno.vn]`), `EMAIL_FORUM` (`[no-reply@eno.forum]`),
  `MAILER_KV`, and `DAILY_QUOTA` (1000), `PRIORITY_RESERVE` (400) and `SECURITY_RESERVE` (25) as
  plain-text vars, plus `keep_bindings: ["secret_text"]`. A PUT drops any binding it does not
  send. Secrets are the one exception, and `keep_bindings` is what keeps them.
- Enables the Worker on **workers.dev** and turns **preview URLs OFF**. A preview or version URL
  runs that version with its own secrets, so leaving previews on would let an old version keep
  accepting a key you have rotated out.
- Lists the secret names and warns if a key is missing. Until both are set, every request for that
  edition answers `401 unauthorized`, exactly like a bad signature, so the Worker fails closed and
  tells an outsider nothing about which edition is configured. Workers Logs show `reason: "no_key"`.

The URL is `https://eno-mailer.<account workers.dev subdomain>.workers.dev/v1/send`. Read the
subdomain with `GET /accounts/{id}/workers/subdomain`. We use workers.dev and not a route on
eno.vn because Bot Fight Mode is on in both zones and would challenge the box's server-to-server
POSTs.

What the budget vars mean, for the UTC day, counted across both editions:
- Background mail (`transactional`) stops once the day's total reaches `DAILY_QUOTA − PRIORITY_RESERVE` (600).
- Sign-in stops at `DAILY_QUOTA − SECURITY_RESERVE` (975).
- Security alerts can use the whole quota.

Refusals answer `429 budget`. The counters are KV and run last-write-wins, so a burst can
undercount: treat them as a brake, not a meter. Every request logs the counters. Watch
`evt:"budget_threshold"` lines in Workers Logs, which fire at 50 %, 80 % and at the
background-mail cut-off.

**If KV cannot be read**, every class still sends: nothing is dropped because a counter is
unreachable. Each Worker isolate then keeps its own in-memory tally for the day. **Background mail**
stops at 60 per isolate and answers `429 budget_unknown`. **Sign-in and security mail are exempt**
(owner, 2026-09-23): they are never refused on an unreadable counter. They still count in the
tally, so background mail stops sooner, and Cloudflare's own daily quota still applies to them
(`429 daily_limit`). Every request in that state logs `evt:"budget_unknown"` at error level, with
`exempt: true` on sign-in and security. On eno.vn a refused background message falls back to
Resend; on eno.forum the app logs `[mail] send failed … code: budget_unknown` and the message is not
sent. Search Workers Logs for `budget_unknown` after any KV incident: those are the sends the day's
counters do not include.

## 5. Keys: two secrets on the Worker, one per container

Each edition gets its own 32-byte key. The Worker holds both. **Each container holds only its
own**, and that separation is what stops eno.forum from sending as eno.vn.

**5a. On your laptop** (the step-2 token is here, and stays here):
```bash
umask 077
openssl rand -hex 32 > ~/.mk-vn
openssl rand -hex 32 > ~/.mk-forum
./infra/cloudflare/deploy-mailer.sh set-secret MAILER_KEY_VN    < ~/.mk-vn
./infra/cloudflare/deploy-mailer.sh set-secret MAILER_KEY_FORUM < ~/.mk-forum
./infra/cloudflare/deploy-mailer.sh status      # both MAILER_KEY_* listed; previews_enabled false
```
`set-secret` reads the value from stdin and sends it in the request body. It never passes the
value as an argument. **Now revoke the step-2 token** (My Profile → API Tokens → Delete) and
`rm -P ~/.eno-cf-token` (macOS; `shred -u` on Linux). Nothing later needs it.

**5b. The box half, over ssh from stdin.** The same value goes into that edition's container env,
and ONLY that edition's. The key travels on ssh's stdin: never in argv on either machine, never in
a shell history.
```bash
KEY=${ENO_SSH_KEY:?path to the box ssh key}; BOX=root@162.4.176.233
SSH="ssh -i $KEY -p 24700 -o BatchMode=yes $BOX"
URL=https://eno-mailer.SUBDOMAIN.workers.dev/v1/send   # ← the real subdomain from step 4
url_ok() { [[ $URL =~ ^https://eno-mailer\.[a-z0-9-]+\.workers\.dev/v1/send$ ]] || { echo "⛔ not the Worker URL: $URL" >&2; return 1; }; }
url_ok && { printf '\nMAILER_URL=%s\nMAILER_KEY=' "$URL"; cat ~/.mk-vn; }    | $SSH 'cat >> /opt/eno/secrets/eno-vn.env'
url_ok && { printf '\nMAILER_URL=%s\nMAILER_KEY=' "$URL"; cat ~/.mk-forum; } | $SSH 'cat >> /opt/eno/secrets/eno-forum.env'
$SSH 'grep -c "^MAILER_KEY=" /opt/eno/secrets/eno-vn.env /opt/eno/secrets/eno-forum.env'   # 1 each
url_ok && { rm -P ~/.mk-vn ~/.mk-forum 2>/dev/null || shred -u ~/.mk-vn ~/.mk-forum; }
```
⛔ `url_ok` guards every line that writes or destroys something. Pasted with the placeholder still in
it, the block writes nothing and keeps the keys: a wrong `MAILER_URL` in eno-forum.env would stop
ALL forum mail (the forum has no fallback), and an empty one reads as "not configured".
The leading newline keeps `MAILER_URL=` off the end of a file whose last line has no newline, and
`openssl rand -hex 32` ends the key with one. Adding the env lines does nothing to the running
containers, which still run the Resend build until step 7.

**5c. eno.vn keeps its Resend fallback, and it needs BOTH variables.** Do not remove
`RESEND_API_KEY` or `MAIL_FROM` from `eno-vn.env`. ⚠️ The old build defaulted `MAIL_FROM` when it was
unset; the new one does not, and with `MAIL_FROM` missing eno.vn has **no fallback at all** (its
`[mail] send failed` lines then carry `fallback: "unconfigured"`). Check, printing no key:
```bash
$SSH 'grep -c "^RESEND_API_KEY=." /opt/eno/secrets/eno-vn.env; grep "^MAIL_FROM=" /opt/eno/secrets/eno-vn.env'
# expect: 1, and a MAIL_FROM= line. If MAIL_FROM is missing, add a BARE address:
printf '\nMAIL_FROM=no-reply@eno.vn\n' | $SSH 'cat >> /opt/eno/secrets/eno-vn.env'
```
⛔ Not `MAIL_FROM=eno.vn <no-reply@eno.vn>`: the same file is **sourced by `sh`** at build time (the
Dockerfile's `buildenv` secret), where `<` and `>` are redirections and break the build, and
`docker --env-file` keeps quotes literally, so quoting it breaks the From header instead. A bare
address is safe in both. It must be an eno.vn address: eno.vn is the only domain verified in Resend.
Do **not** add `RESEND_API_KEY` or `MAIL_FROM` to `eno-forum.env`.

**Rotating a key later** (steps 2 and 5a again for the token, laptop only):
1. Set the old value as `MAILER_KEY_VN_OLD`.
2. Set the new value as `MAILER_KEY_VN`.
3. On the box, drop the old lines (`$SSH "sed -i '/^MAILER_URL=/d;/^MAILER_KEY=/d' /opt/eno/secrets/eno-vn.env"`),
   append the new ones with 5b, and recreate the container.
4. After it is healthy, remove `_OLD` with `DELETE .../secrets/MAILER_KEY_VN_OLD`.
An `_OLD` key on its own verifies nothing: the primary must always be set.

## 6. Smoke test, to an EXTERNAL mailbox

⛔ **Do not use a verified destination address.** Sends to a verified destination are free, sit
outside the daily quota and may be 25 MiB, so a green result there proves nothing about Workers
Paid, the quota, the 5 MiB cap or inbox placement. Use a seed mailbox you control that is **not**
in Email Routing's verified list, for example a fresh Gmail account.

Run each check once per edition, with that edition's key. Never paste a key into a command line.
Pick one of the two ways to run it.

**On the box, inside that edition's own container.** It reads `MAILER_URL` and `MAILER_KEY` from the
env file itself, and it proves the box's own path to workers.dev. Copy the script up once, then:
```bash
# from the laptop:  scp -i "$KEY" -P 24700 scripts/mailer-smoke.mjs $BOX:/root/mailer-smoke.mjs
smoke() {   # smoke <vn|forum> <args…>
  local ed=$1; shift
  docker exec -i --env-file "/opt/eno/secrets/eno-$ed.env" "eno-$ed-app" \
    node --input-type=module - --edition "$ed" "$@" < /root/mailer-smoke.mjs
}
smoke vn --to seed.box@gmail.com
smoke vn --to seed.box@gmail.com --class signin
smoke vn --to seed.box@gmail.com --attach-bytes 3670016
smoke vn --to seed.box@gmail.com --bad-signature   # must be 401
smoke vn --to seed.box@gmail.com --stale           # must be 401
# …and the same five with `smoke forum …`.
# Cross-check: the FORUM key signing as vn must be 401:
docker exec -i --env-file /opt/eno/secrets/eno-forum.env eno-forum-app \
  node --input-type=module - --edition vn --to seed.box@gmail.com < /root/mailer-smoke.mjs
rm /root/mailer-smoke.mjs   # when done
```

**Or from your laptop**, with the key piped over ssh into `--key-stdin` (Node ≥ 20, from the
scratch checkout):
```bash
export MAILER_URL=https://eno-mailer.SUBDOMAIN.workers.dev/v1/send   # ← the real subdomain from step 4
key() { $SSH "grep -m1 '^MAILER_KEY=' /opt/eno/secrets/eno-$1.env | cut -d= -f2-"; }
key vn | node scripts/mailer-smoke.mjs --edition vn --to seed.box@gmail.com --key-stdin
key vn | node scripts/mailer-smoke.mjs --edition vn --to seed.box@gmail.com --class signin --key-stdin
key vn | node scripts/mailer-smoke.mjs --edition vn --to seed.box@gmail.com --attach-bytes 3670016 --key-stdin
key vn | node scripts/mailer-smoke.mjs --edition vn --to seed.box@gmail.com --bad-signature --key-stdin  # 401
key vn | node scripts/mailer-smoke.mjs --edition vn --to seed.box@gmail.com --stale --key-stdin          # 401
# …the same five with `key forum` and --edition forum; and the cross-check (must be 401):
key forum | node scripts/mailer-smoke.mjs --edition vn --to seed.box@gmail.com --key-stdin
```

Open each delivered message in the seed inbox with "Show original" and check:
- `From: eno.vn <no-reply@eno.vn>` (or eno.forum).
- `Reply-To: support@eno.vn` (or support@eno.forum). The `--class signin` message has **no**
  Reply-To.
- `spf=pass` on `cf-bounce.<zone>`, `dkim=pass header.d=eno.vn` (or eno.forum), `dmarc=pass`.
- It landed in **Inbox**, not Spam. Check at least Gmail and Outlook.
- The 3.5 MiB attachment arrived. That is the largest file the app attaches, and e-Visa PDFs above
  it go out as a link instead.

⛔ **Reply to the `--class signin` message, on BOTH editions, and prove the reply goes nowhere.** A
real sign-in mail carries a live link or code, and with no Reply-To a reply goes to
`no-reply@<zone>`. It must bounce or be dropped. It must never land in a mailbox someone reads.
- **eno.vn**: inbound is Cloudflare Email Routing, and its catch-all was set to Drop when last
  measured. Since 2026-09-22 some inbound also runs through the `eno-inbound-bridge` Email Worker
  into mailcow, so check the routing rules first: `no-reply@eno.vn` must match no rule, and the
  catch-all must still be Drop, not the bridge. Then reply, and confirm the message appears in no
  staff mailbox (the support@eno.vn forward, mailcow/SOGo).
- **eno.forum**: inbound is **PrivateEmail**, and this has **not** been verified. Reply, then
  confirm you get a bounce or nothing, and that it appears in no PrivateEmail mailbox (support@,
  any alias, any catch-all). If PrivateEmail has a catch-all or an alias that covers
  `no-reply@eno.forum`, exclude that address from it (or make it a rejecting alias) and reply again.
  Do not start step 7 until this passes.

Also read Workers Logs for `eno-mailer`: one `"evt":"mail"` line per send, masked recipient, and
the day's counters.

## 7. App deploy (owner's "deploy" only)

The app change makes the Worker the primary path on both editions and keeps Resend as eno.vn's
fallback only. Deploy **both** editions the usual way
(`infra/vn-node/eno-deploy.sh` on the box) only when the owner says deploy and steps 0–6 are
green. Then, on both eno.vn and eno.forum:
- Email sign-in, **link mode** and **code mode**, to a real inbox. Both must arrive; the link and
  the code must sign in.
- An admin KYC or business-verification decision on a test account: the outcome email arrives.
- On the forum, change a test seller's payout account: the security alert arrives.
- On eno.forum only (eno.vn has no visa desk), if a visa case is available to close, a result PDF
  under 3.5 MiB arrives attached; above that it arrives as a link to the chat, and the desk toast
  says so.
- `docker logs` for each container: `[mail] sent` lines with `"transport":"worker"`, no
  `[mail] MAILER_URL/MAILER_KEY not set`, no `[mail] send failed` and no `mail_fallback` lines
  (see "Seeing the fallback" below).
- On eno.vn, the fallback is configured (prints `fallback-ready`, and no key):
  `docker exec eno-vn-app sh -c 'test -n "$RESEND_API_KEY" && test -n "$MAIL_FROM" && echo fallback-ready'`.
  Skip this on eno.forum: its build never reads either variable.

**Rollback**: redeploy the previous image. eno.vn's env still holds `RESEND_API_KEY`, so the old
build sends as before. eno.forum's old build needs the Resend variables its env still has until
step 8, which is why step 8 waits.

## 8. Take Resend out of the FORUM container only (after mail is verified)

After several days of clean logs and user sign-ins on eno.forum:
1. Delete `RESEND_API_KEY` and `MAIL_FROM` from `/opt/eno/secrets/eno-forum.env`, then recreate the
   forum container. The new build already ignores them; removing them means the forum container no
   longer holds a key that can send as eno.vn, which is the whole point of the per-edition keys.
   ```bash
   $SSH "sed -i '/^RESEND_API_KEY=/d;/^MAIL_FROM=/d' /opt/eno/secrets/eno-forum.env"
   $SSH 'grep -c "^RESEND_API_KEY=\|^MAIL_FROM=" /opt/eno/secrets/eno-forum.env'   # 0
   ```
2. ⛔ **Leave eno.vn alone.** Its `RESEND_API_KEY` and `MAIL_FROM`, the Resend DNS records on eno.vn
   (TXT `resend._domainkey.eno.vn`, MX `send.eno.vn` → `feedback-smtp.ap-northeast-1.amazonses.com`)
   and the Resend API key itself are the fallback. Deleting any of them turns eno.vn's fallback into
   `[mail] send failed` lines. Do not revoke the Resend key.

## Seeing the fallback

Every use of the fallback logs one warning line on the eno.vn container. It is the line to alert on:
it means the Worker refused or could not be reached, and the message went out through Resend instead.
```
[mail] FALLBACK to Resend a…e@gmail.com {"edition":"vn","class":"signin","tag":"signin-link","code":"unauthorized","status":401,"attempts":1,"evt":"mail_fallback"}
```
`code` is why the Worker did not take it. The fields are one line of JSON, so the greps below are
exact. Then exactly one of:
- `[mail] sent … {"transport":"resend", …, "workerCode":"…"}`: Resend delivered it.
- `[mail] send failed … {"fallback":"resend","fallbackCode":"…","fallbackStatus":…}`: Resend failed
  too. The user got nothing.
- `[mail] send failed … {"fallback":"no_time"}`: the caller's deadline left no room to try Resend.

A line with `"fallback":"unconfigured"` means eno.vn hit a failure Resend would have taken, but
`RESEND_API_KEY` or `MAIL_FROM` is missing (step 5c).

```bash
docker logs --since 24h eno-vn-app 2>&1 | grep -c 'mail_fallback'                       # fallbacks today
docker logs --since 24h eno-vn-app 2>&1 | grep 'mail_fallback' | grep -o '"code":"[a-z_]*"' | sort | uniq -c
docker logs --since 24h eno-vn-app 2>&1 | grep '\[mail\] sent' | grep -c '"transport":"resend"'
docker logs --since 24h eno-vn-app 2>&1 | grep -E 'fallback":"(resend|no_time|unconfigured)'
```
One or two `timeout` or `unavailable` fallbacks in a day is a blip. A run of `unauthorized` is a key
or clock problem, `budget`/`daily_limit` is the quota, and `disabled`/`config` is the container's
`MAILER_URL`/`MAILER_KEY`: fix the Worker side, because every fallback is a message that
Cloudflare's suppression list and budget never saw. eno.forum never logs `mail_fallback`: its failures
are `[mail] send failed` lines.

---

## Operating it

- **A user says the sign-in email never arrives.** Check the container log for
  `[mail] send failed a…e@domain {"code":"…"}`. On eno.vn also look for a `mail_fallback` line for
  that masked address: a message that went out through Resend shows up in Resend's dashboard, not
  in Cloudflare's. For `suppressed`, the log also carries
  `[auth/email-link] recipient is on the Cloudflare suppression list`. The user only sees the
  generic "couldn't send", because the route must not reveal suppression. Lift it **only** once they
  prove they control the address (Google sign-in as that address, or a message to support **from**
  it):
  1. **Dashboard, the primary path, no token:** Cloudflare dashboard → Email Service → Sending →
     **Suppressions** → search the address → **Delete**. Suppressions are account-wide, so this one
     page covers both editions.
  2. **A read-only entry** cannot be deleted there or by the API (it returns 403). Open a ticket with
     Cloudflare Support (Email Service) quoting the entry id.
  3. **API fallback, only when the dashboard cannot do it** (a bulk review, say):
     `scripts/email-suppression.mjs`. ⛔ The token it needs, Account · **Email Sending: Edit**, can
     also *send mail* as eno.vn and eno.forum through Cloudflare's own API, skipping this Worker's
     keys, class allowlist and budget. So: create it on your **laptop** with an end date a few hours
     out; never put it on the box or in `/opt/eno/secrets`; paste it at the script's hidden prompt,
     pipe it in, or point `CF_EMAIL_TOKEN_FILE` at a mode-0600 file (the script refuses
     `CF_EMAIL_TOKEN=…`, which would land in shell history); **revoke it** when done.
     ```bash
     node scripts/email-suppression.mjs list   user@example.com          # prompts for the token
     node scripts/email-suppression.mjs remove user@example.com          # dry run
     node scripts/email-suppression.mjs remove user@example.com --yes
     ```
  Suppressions are **account-wide**: a complaint about eno.forum mail blocks eno.vn sign-in too,
  and complaints never expire.
- **`budget`**: the daily share for that class is spent. On eno.vn the message falls back to Resend;
  on eno.forum background mail resumes tomorrow (UTC). If sign-in hits it, raise `DAILY_QUOTA`
  after Cloudflare raises the account limit, and look for a sign-in spray.
- **`daily_limit`**: Cloudflare's own quota is spent. Nothing sends until it resets. Request an
  increase.
- **`budget_unknown`**: the Worker could not read its KV counters and this isolate's cap on
  background mail was spent (sign-in and security are never refused this way). On eno.forum those
  messages were **not** sent; on eno.vn they fell back to Resend. Check KV health; the first send
  after it recovers counts normally again.
- **`unauthorized` on every send of one edition**: the key in its container env does not match
  the Worker's secret, the secret is missing (Workers Logs: `reason: "no_key"`), or the box clock
  is more than 300 s off. Run `deploy-mailer.sh status` from a laptop.
- **`idempotency_conflict`**: the same idempotency key came back with a different message. The app
  treats it as a failure and never falls back on it (a second provider would double-send). The
  e-Visa result keys on the case and the PDF's hash, so a corrected PDF is a new email; this code
  means a genuine collision, and nothing was sent.
- **`config`**: a binding that does not match its sender, or a domain that is not onboarded. Run
  `deploy-mailer.sh status`.
- **Never** send marketing through this Worker. It refuses `class: 'marketing'`, and the app never
  asks.
