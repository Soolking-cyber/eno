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

## Remaining hardening — NOT done

⛔ **Authenticated Origin Pulls is absent, and it is the one real hole left.**
ufw admits every Cloudflare range, so anyone can point their *own* Cloudflare zone
at `162.4.176.208`, send `Host: eno.vn`, and arrive from an allowed IP at a served
vhost. `/api/*` still refuses them — `src/proxy.ts` requires a header only our
Transform Rule injects — but page routes would answer, and CF's WAF and rate
limits would be bypassed entirely. Three reviewers raised it independently.

The fix is mTLS between Cloudflare and this origin:

```bash
curl -fsSL https://developers.cloudflare.com/ssl/static/authenticated_origin_pull_ca.pem \
  -o /etc/nginx/ssl/cf-origin-pull-ca.pem
# then in each server block: ssl_client_certificate …/cf-origin-pull-ca.pem; ssl_verify_client on;
```

⚠️ **Order matters or you take the site down.** Enable Authenticated Origin Pulls
in the Cloudflare zone FIRST, confirm traffic still flows, and only then set
`ssl_verify_client on`. Reversed, nginx rejects every Cloudflare connection.
Zone-level AOP is safe for the GCLB origin that eno.vn still points at — an origin
that does not ask for a client certificate simply ignores the one CF offers.

Also outstanding:

- **SSL mode is Full, not Full (strict)** on both zones — CF→origin is encrypted
  but this certificate is not verified.
- **`vn-test.eno.vn` must be deleted** at cutover, from both DNS and `server_name`.
