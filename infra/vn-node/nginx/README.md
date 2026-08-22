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

### Where this actually stands

⛔ **Hostname-level AOP is NOT Cloudflare's shared CA — it needs a certificate we
supply.** `PUT /zones/{id}/origin_tls_client_auth/hostnames` takes a `cert_id`,
and that id comes from `POST …/hostnames/certificates`, which requires
`certificate` **and** `private_key`. So the "safe per-hostname toggle" and the
"custom certificate that actually binds to our zone" are the same thing — which is
good news: scoping it to this box's hostnames also gets the stronger property.

**Done and inert:**

- Our own CA generated (`eno-origin-pull-ca.pem`, CN `eno origin-pull CA`, to
  2036). ⛔ **The CA private key never left the machine that made it and must NEVER
  go to Cloudflare** — only the client certificate it signed does. That asymmetry
  is the point: Cloudflare can prove it holds our client cert, but cannot mint
  another one.
- CA installed at `/etc/nginx/ssl/eno-origin-pull-ca.pem` on the box.
- `vn-test.eno.vn` split into its own server block, so mTLS can be required on the
  two hostnames that point here without demanding a client certificate on the
  vhost `eno.vn` lands on at cutover.
- `origin-pull.conf` staged; the `include` is commented out in both blocks.

**The one blocked step.** Uploading the client cert+key needs a Cloudflare token
this session does not hold, and marshalling a private key is refused here by
design. Run it yourself with a token scoped to *SSL and Certificates: Edit*:

```bash
Z=55e558b62f68a44f8177d7d98cb5369e            # eno.vn
D=<the directory holding eno-aop-client.pem / .key>

# ⚠️ --data @- reads the body from STDIN. Passing it as an argument would put the
# private key in this process's argv, where `ps` shows it to every local user.
# --fail makes curl exit non-zero on an API error instead of handing the next
# command an empty cert_id.
jq -n --rawfile c "$D/eno-aop-client.pem" --rawfile k "$D/eno-aop-client.key" \
     '{certificate:$c, private_key:$k}' \
  | curl -sS --fail -X POST \
      "https://api.cloudflare.com/client/v4/zones/$Z/origin_tls_client_auth/hostnames/certificates" \
      -H "Authorization: Bearer $CF_TOKEN" -H "Content-Type: application/json" \
      --data @- > /tmp/aop-upload.json || { echo "UPLOAD FAILED"; exit 1; }
CERT_ID=$(jq -r '.result.id' /tmp/aop-upload.json)
[ -n "$CERT_ID" ] && [ "$CERT_ID" != "null" ] || { echo "no cert_id returned"; exit 1; }
echo "cert_id=$CERT_ID"

curl -s -X PUT "https://api.cloudflare.com/client/v4/zones/$Z/origin_tls_client_auth/hostnames" \
  -H "Authorization: Bearer $CF_TOKEN" -H "Content-Type: application/json" \
  --data "$(jq -n --arg id "$CERT_ID" '{config:[
      {hostname:"vn-test.eno.vn", cert_id:$id, enabled:true}]}')" | jq '.success,.errors'
# ⚠️ vn-test FIRST, alone. Verify it end-to-end before adding sb.eno.vn — sb serves
# auth, storage and realtime for BOTH editions, so getting it wrong is a real
# outage while vn-test is a throwaway. Repeat the call with sb once vn-test proves
# out (include BOTH hostnames in `config`; the PUT replaces the whole association
# list rather than appending to it).
```

⛔ `origin-pull.conf` still names Cloudflare's shared CA. **Change
`ssl_client_certificate` to `/etc/nginx/ssl/eno-origin-pull-ca.pem`** when using
our own certificate — pointing it at the shared CA would accept any Cloudflare
customer and give up the property we just paid for.

**Then, and only then, require it on the box:**

```bash
$SCP origin-pull.conf $H:/etc/nginx/snippets/eno-origin-pull.conf
# uncomment the `include /etc/nginx/snippets/eno-origin-pull.conf;` line in the
# vn-test.eno.vn and sb.eno.vn blocks ONLY — never in the eno.vn/eno.forum blocks
# until their hostnames are associated too.
$SSH 'nginx -t && systemctl reload nginx'
```

**Prove it.** ⚠️ `ssl_verify_client on` completes the handshake and returns
**HTTP 400 "No required SSL certificate was sent"** — not a TLS alert:

```bash
curl -sk -o /dev/null -w '%{http_code}\n' --resolve vn-test.eno.vn:443:127.0.0.1 https://vn-test.eno.vn/
#   expect 400  (bypasses Cloudflare, so carries no client cert)
curl -s  -o /dev/null -w '%{http_code}\n' https://vn-test.eno.vn/
#   expect 200  (through Cloudflare, which now presents our cert)
```

⛔ **This breaks every on-box check in "Verifying a change" above** for those two
hostnames — they all use `--resolve …:127.0.0.1` and so carry no certificate.
Verify through the edge instead.

⛔ **THE CA PRIVATE KEY IS NOT SAVED ANYWHERE DURABLE YET.** It was generated into
a session scratchpad that will be deleted. Without it, the client certificate
cannot be rotated — you would have to mint a whole new CA, reinstall it on the box
and re-upload to Cloudflare. Move it into the vault before that directory goes:

```bash
# ⚠️ the generated files are named eno-aop-ca.{key,pem}; the vault entries are
# named for what they are. Check the filenames before running — a typo here is
# how the only copy gets lost.
~/eno-vault/vault.sh put eno-origin-pull-ca-key  < eno-aop-ca.key   # the irreplaceable half
~/eno-vault/vault.sh put eno-origin-pull-ca-cert < eno-aop-ca.pem
```

⚠️ **Neither file is in this repo, and that is deliberate** — `.gitignore` blanket-
ignores `*.pem`. That rule is what stops a private key being committed by accident,
so it is not worth punching a hole in it to store a public certificate; the vault
holds both halves together instead. The cert also lives on the box at
`/etc/nginx/ssl/eno-origin-pull-ca.pem`, which is where nginx reads it.

⚠️ **Rotate the client key if the transcript that generated it is a concern.**
It is purpose-built and replaceable: upload a new cert and re-associate. The CA
key, which is the one that matters, never left the generating machine.

## Also outstanding

- **SSL mode is Full, not Full (strict)** on both zones — CF→origin is encrypted
  but this certificate is not verified.
- **`vn-test.eno.vn` must be deleted** at cutover, from both DNS and `server_name`.
