# nginx on the VN origin

Live on `162.4.176.208`. Cloudflare terminates TLS for the visitor and speaks to
this box; nothing reaches it directly.

## Files

| repo | on the box |
| --- | --- |
| `eno.conf` | `/etc/nginx/sites-available/eno.conf` (symlinked into `sites-enabled/`) |
| `proxy-params.conf` | `/etc/nginx/snippets/eno-proxy.conf` |
| `ssl-params.conf` | `/etc/nginx/snippets/eno-ssl.conf` |

## Deploy

⛔ **The real-IP snippet is generated, not copied — and `eno.conf` hard-includes it.**
Skip step 1 on a fresh box and `nginx -t` fails with
`open() "/etc/nginx/snippets/eno-realip.conf" failed (2: No such file or directory)`,
which blocks every subsequent deploy. All three reviewers caught this runbook as
originally written; it is the difference between notes and something that can
rebuild the box.

```bash
KEY="…/CS-Linux-…​.pem"
H=root@162.4.176.208
SSH="ssh -i $KEY -p 24700 $H"
SCP="scp -i $KEY -P 24700"

# 1. generator first — it creates the include everything else depends on
$SSH 'mkdir -p /opt/eno/bin /etc/nginx/snippets /etc/nginx/ssl'
$SCP gen-cloudflare-realip.sh $H:/opt/eno/bin/gen-cloudflare-realip.sh
$SSH 'chmod +x /opt/eno/bin/gen-cloudflare-realip.sh && /opt/eno/bin/gen-cloudflare-realip.sh'

# 2. snippets and vhosts
$SCP proxy-params.conf $H:/etc/nginx/snippets/eno-proxy.conf
$SCP ssl-params.conf   $H:/etc/nginx/snippets/eno-ssl.conf
$SCP eno.conf          $H:/etc/nginx/sites-available/eno.conf
$SSH 'ln -sfn /etc/nginx/sites-available/eno.conf /etc/nginx/sites-enabled/eno.conf && rm -f /etc/nginx/sites-enabled/default'

# 3. certificate — nginx will not start without BOTH files present.
#    On a rebuild, reuse the existing pair from backup. To mint a new one:
$SSH 'cd /etc/nginx/ssl && openssl genrsa -out origin.key 2048 && chmod 600 origin.key &&
      openssl req -new -key origin.key -out origin.csr -subj "/CN=eno.vn" \
        -addext "subjectAltName=DNS:eno.vn,DNS:*.eno.vn,DNS:eno.forum,DNS:*.eno.forum"'
#    Then POST that CSR to Cloudflare Origin CA (request_type origin-rsa,
#    requested_validity 5475) and write the returned PEM to origin.crt (644).
#    ⛔ Verify the pair matches before reloading — a mismatch stops nginx dead:
$SSH 'openssl x509 -noout -modulus -in /etc/nginx/ssl/origin.crt | sha256sum;
      openssl rsa  -noout -modulus -in /etc/nginx/ssl/origin.key | sha256sum'

# 4. test THEN reload, always as one command
$SSH 'nginx -t && systemctl reload nginx'
```

⚠️ `nginx -t` before `reload`, in the same command, every time. A bad config fails
the test and the running nginx keeps serving the previous one — that is the only
reason three syntax errors during the first deploy caused no outage.

## Certificate

Cloudflare **Origin CA**, issued 2026-08-21, valid to **2041-08-17**, SANs
`eno.vn, *.eno.vn, eno.forum, *.eno.forum`. The private key was generated on the
box and has never left it; only the CSR did.

⛔ It is trusted by Cloudflare and by nobody else. That is deliberate — it is
worthless to anyone reaching the origin directly, and there is no renewal cron to
forget.

⚠️ **Both zones must be on SSL mode "Full (strict)".** As of 2026-08-21 they are
on **Full**, which still encrypts CF→origin but does not verify this certificate,
so a MITM between Cloudflare and the box would go unnoticed. Move to strict at
cutover. On *Flexible* — neither zone is — Cloudflare would talk to this origin in
cleartext and the certificate would be bypassed entirely.

## Verifying a change

Routing and the licensing boundary, on the box:

```bash
s() { curl -sk -o /dev/null -w "%{http_code}" --resolve "$1:443:127.0.0.1" "https://$1$2"; }
s eno.vn /          # 200
s eno.vn /visa      # 404  ⛔ must never be 200
s eno.vn /itinerary # 404  ⛔ must never be 200
s eno.forum /itinerary  # 200
s evil.example /    # 000 — default_server returns 444, closing with no response
```

⚠️ **Verify by ROUTE, never by build flag.** A correct `NEXT_PUBLIC_ENO_EDITION`
proves nothing about what the bundle actually serves.

⚠️ **Check the access log to prove which origin answered.** `server: cloudflare`
appears on every response whether it came from this box or the GCLB:

```bash
tail /var/log/nginx/eno-vn.access.log   # client IPs should be Cloudflare ranges
```

## Pre-cutover alias

`vn-test.eno.vn` (Cloudflare A → 162.4.176.208, proxied) exists so the full
Cloudflare → nginx → app path can be exercised while `eno.vn` still points at the
GCLB. ⛔ **Remove it from `server_name` and delete the DNS record at cutover.**
Only the GUEST suite may run against it: the host is not in `ALLOWED_AUTH_HOSTS`,
so auth links fall back to `NEXT_PUBLIC_APP_URL` and would point at live prod.

## Authenticated Origin Pulls — prepared, NOT enabled

The origin half is installed: Cloudflare's origin-pull CA is at
`/etc/nginx/ssl/cf-origin-pull-ca.pem` (sha256 `c14fed0ce5210db0719fea11d1f10b33750dc17d609aeaf47c75e9eff0d7b843`,
expires **2029-11-01**), and `origin-pull.conf` holds
the two directives. ⛔ **`eno.conf` does not include it, and AOP is off on both
zones.**

### ⛔ Read this before enabling: it closes less than it looks like

Cloudflare's default origin-pull CA is **shared by every Cloudflare customer**.
`ssl_verify_client on` against it proves a request came *from Cloudflare* — not
from *our* zone. An attacker who points their own Cloudflare zone at
`162.4.176.208` with `Host: eno.vn` presents a certificate that same CA signed,
and still gets through. An earlier version of this section claimed otherwise.

| | closed by default-CA AOP? |
| --- | --- |
| Direct hit from a non-Cloudflare IP | already closed by ufw |
| Workers egress / other services in CF ranges | ✅ yes — this is the real gain |
| **Another customer's Cloudflare zone fronting us** | ❌ **no** |

**The fix that actually binds to our zone** is a *custom* origin-pull certificate:
upload our own cert+key with `POST /zones/{id}/origin_tls_client_auth`, then point
`ssl_client_certificate` at **our** CA rather than Cloudflare's global one. Until
then, the Transform-Rule header check in `src/proxy.ts` is the only control that
binds a request to our zone — and it guards `/api/*` only, not page routes.

### Enabling, in this order

⛔ **Order is the entire risk.** Zone first, box second. Reversed, nginx demands a
certificate Cloudflare is not sending and every request through the edge breaks.

**1. Zone or hostname.** Two options, and the second is safer while `eno.vn` still
points at the GCLB:

- **Zone-wide** — `PUT /zones/$ZONE/origin_tls_client_auth/settings` `{"enabled":true}`
  (dashboard: *SSL/TLS → Origin Server → Authenticated Origin Pulls*). Safe for the
  GCLB — an origin that does not ask for a client certificate discards the offered
  one — but it is a live-zone change.
- **Per hostname** (recommended pre-cutover) —
  `PUT /zones/$ZONE/origin_tls_client_auth/hostnames` enables client auth for named
  hostnames only. Turn it on for `sb.eno.vn` and `vn-test.eno.vn`, which are the
  only names pointing at this box, and `eno.vn` on the GCLB is untouched entirely.

Zones: eno.vn `55e558b62f68a44f8177d7d98cb5369e`,
eno.forum `cc81e3ff1d792c0aa5384e8feab21efa`.

**2. Confirm nothing moved.** Baseline captured 2026-08-22 before any change:

```bash
for u in https://eno.vn/ https://www.eno.vn/ https://eno.forum/ https://vn-test.eno.vn/; do
  curl -s -o /dev/null -w "$u %{http_code}\n" "$u"; done
#   eno.vn 200 · www.eno.vn 308 · eno.forum 200 · vn-test.eno.vn 200
SB=$(dig @1.1.1.1 +short sb.eno.vn A | head -1)
curl -s -o /dev/null -w "sb %{http_code}\n" --resolve sb.eno.vn:443:$SB https://sb.eno.vn/auth/v1/health
#   sb 401   ← five checks, five codes; the sb one needs its own command
```

**3. Box** — copy `origin-pull.conf` to `/etc/nginx/snippets/eno-origin-pull.conf`
and add `include /etc/nginx/snippets/eno-origin-pull.conf;` beside the ssl include
in each server block, then `nginx -t && systemctl reload nginx`.

**4. Prove it.** ⚠️ `ssl_verify_client on` does **not** abort the handshake — nginx
completes TLS and answers **HTTP 400 "No required SSL certificate was sent"**. A
test expecting a TLS alert will read as a failure when it is working:

```bash
curl -sk -o /dev/null -w '%{http_code}\n' --resolve eno.vn:443:127.0.0.1 https://eno.vn/
#   expect 400  (was 200)
curl -s  -o /dev/null -w '%{http_code}\n' https://vn-test.eno.vn/
#   expect 200  — still fine, because it goes through Cloudflare
```

✅ **`sb.eno.vn` under mTLS is safe.** Checked from inside the app container: it
resolves `sb.eno.vn` to Cloudflare (`2606:4700:…`), so server-side Supabase calls
hairpin through the edge and carry the client certificate like any other request.
(They are a hairpin, which costs a round trip — worth revisiting separately.)

⛔ **This breaks the on-box verification commands in "Verifying a change" above.**
Every one of those uses `--resolve …:127.0.0.1`, which bypasses Cloudflare and
therefore carries no client certificate — they will all return 400 once mTLS is on.
After enabling, verify through the edge (`https://vn-test.eno.vn/...`) instead, or
temporarily comment the include out on the box.

## Also outstanding

- **SSL mode is Full, not Full (strict)** on both zones — CF→origin is encrypted
  but this certificate is not verified.
- **`vn-test.eno.vn` must be deleted** at cutover, from both DNS and `server_name`.
