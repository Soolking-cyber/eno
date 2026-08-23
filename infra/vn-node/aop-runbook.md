# Authenticated Origin Pulls + Full (strict) — runbook

State when this was written (2026-08-22, ~12h after the DNS cutover):

| | eno.vn | eno.forum |
|---|---|---|
| zone | `55e558b62f68a44f8177d7d98cb5369e` | `cc81e3ff1d792c0aa5384e8feab21efa` |
| plan | Free | Free |
| ssl mode | `full` | `full` |
| `always_use_https` | on | **off** |
| `min_tls_version` | **1.0** | **1.0** |
| zone AOP | off | off |
| per-hostname AOP | no certs, disabled | no certs, disabled |

Every proxied record in both zones points at `162.4.176.208` and nothing else:
`eno.vn`, `www.eno.vn`, `sb.eno.vn`, `eno.forum`, `www.eno.forum`. The only unproxied
A/CNAME records are the two `_acme-challenge` CNAMEs to Google Certificate Manager
(the GCLB rollback path) and eno.forum's mail CNAMEs to privateemail.com.

## ⛔ THE PLAN CHANGED: ZONE-LEVEL, NOT PER-HOSTNAME

The earlier decision — recorded when this was first specced — was **per-hostname** AOP,
"box only". That choice was correct then and is wrong now, and the reason is the cutover
itself. At the time only `vn-test.eno.vn` resolved to this box; `eno.vn` and `eno.forum`
still pointed at the Google load balancer, which does not do mTLS. Zone-level AOP would
have made Cloudflare present a client certificate to the GCLB as well, and the GCLB would
have had nothing to verify it against. Per-hostname was the only way to scope it.

That constraint is gone. **Every proxied hostname in both zones now terminates on this one
nginx.** Zone-level is now both simpler and strictly better:

* one certificate and one switch per zone instead of five hostname associations
* a hostname added later is covered by default rather than silently unprotected
* it sidesteps the plan-gating question below entirely

⚠️ **Per-hostname AOP with a customer certificate appears to be gated above Free.** Both
external reviewers said so independently (one named Enterprise, the other named Advanced
Certificate Manager, a paid add-on). Cloudflare's own availability table says AOP is
`Free: Yes` but does not break that down by configuration level, so the docs do not settle
it. **This has NOT been measured** — the API call that would settle it is a write, and
writes were blocked. Zone-level is the path that does not depend on the answer.

## What Full (strict) needs, and why it is safe here

nginx serves one certificate for every vhost (`snippets/eno-ssl.conf`):

    subject  CN=CloudFlare Origin Certificate
    issuer   CloudFlare Origin SSL Certificate Authority
    SAN      eno.vn, *.eno.vn, eno.forum, *.eno.forum
    validity 2026-08-21 .. 2041-08-17

Full (strict) verifies exactly that: a certificate Cloudflare trusts, unexpired, matching
the hostname. Cloudflare trusts its own Origin CA in strict mode — that is the point of
issuing one. `*.eno.vn` covers `www.eno.vn` and `sb.eno.vn`; `*.eno.forum` covers `www`.
**Both reviewers were asked to name a proxied hostname that would fail and both answered
"none exists."**

## The client certificate

Generated 2026-08-22. Reissued the same day with proper X.509 extensions — the first leaf
had *no extensions at all*. Both reviewers agreed an extension-less certificate is legal
for client auth (an absent EKU means "any purpose"), so this is belt-and-braces against
Cloudflare's upload validation rather than a fix for a known rejection.

    CA   O=eno OU=origin-pull CN="eno origin-pull CA"   CA:TRUE critical   2026 .. 2036
    leaf O=eno OU=origin-pull CN=cloudflare-origin-pull.eno.vn
         basicConstraints CA:FALSE critical
         keyUsage         digitalSignature, keyEncipherment (critical)
         extendedKeyUsage clientAuth
         SAN              DNS:cloudflare-origin-pull.eno.vn
    verified: chains to the CA under `-purpose sslclient`, private key matches

The CA is already installed at `/etc/nginx/ssl/eno-origin-pull-ca.pem`.

⛔ **THE LEAF PRIVATE KEY MUST NOT ENTER THIS REPO.** The repo is public. It lives in the
session scratchpad today, which is temporary — move it to `~/eno-vault` before that
directory is cleaned, or regenerate the pair (the CA is what the box trusts; a new leaf
signed by the same CA is a drop-in replacement).

## ⚠️ THE DISPUTED STEP, AND HOW TO SETTLE IT WITHOUT AN OUTAGE

The reviewers split on whether `ssl_verify_client optional` is safe to install *before*
Cloudflare is presenting a certificate:

* one said harmless — `optional` records the outcome in `$ssl_client_verify` and never
  rejects, so a client that sends nothing still gets served
* the other said it is an immediate site-wide **525**, on the theory that Cloudflare's edge
  aborts the handshake when it receives a `CertificateRequest` it was not configured for

Both cannot be right, and the second is the kind of claim that costs an outage to be wrong
about. **Do not resolve this by reasoning — measure it, on a hostname where being wrong is
free.** `www.eno.vn` only 308-redirects to the apex, so it is the canary: split it out of
the marketplace `server_name` into its own block, put `ssl_verify_client optional` on that
block alone, reload, and curl it from outside.

* `308` and a log line reading `ssl_client_verify=NONE` → the edge completes the handshake
  and sends no certificate. The claim is refuted and the real rollout is safe.
* `525` → the claim holds. Revert the canary and the whole `optional`-first strategy is
  dead; enablement at Cloudflare has to come first and the origin has to go straight from
  no verification to `on`, with the site briefly unprotected in between rather than briefly
  down.

The canary block and its `log_format` are written out ready to paste; restoring is
`cp /root/eno.conf.pre-aop-canary /etc/nginx/sites-enabled/eno.conf && nginx -s reload`.

## Order of operations

Enablement at Cloudflare must come **before** enforcement at nginx. Reversed, nginx demands
a certificate Cloudflare is not sending, and — note the failure mode — it does **not** fail
the handshake. nginx completes TLS and answers HTTP **400 "No required SSL certificate was
sent"**, so the symptom is every page returning 400, not a connection error.

1. **Full (strict), both zones.** `PATCH /zones/{id}/settings/ssl {"value":"strict"}`.
   Verify externally; rollback is the same call with `"full"`.
2. **Canary.** Settle the disputed step above. Stop here if it 525s.
3. **Upload the leaf + key**, both zones: `POST /zones/{id}/origin_tls_client_auth`
   `{certificate, private_key}`. Storage only — nothing changes on the wire.
   If this returns an entitlement error on Free, the reviewers were right about the plan
   gate and there is no zone-binding option on this plan; stop and reconsider.
4. **Enable**, both zones: `PUT /zones/{id}/origin_tls_client_auth/settings {"enabled":true}`.
   Cloudflare now presents the certificate. The origin still ignores it.
5. **Instrument, do not enforce.** `ssl_client_certificate` + `ssl_verify_client optional`
   on all four vhosts *including the 444 default_server*, with `$ssl_client_verify` logged.
6. **Prove it, then enforce.** Only when every hostname logs `SUCCESS` — pages *and*
   Supabase, including a websocket upgrade to `sb.eno.vn/realtime/v1` — flip `optional` to
   `on`. Rollback is one sed and a reload.

⚠️ **A reviewer's best catch: `SUCCESS` in your logs does not mean every colo agrees.**
Your curls exit through a handful of Cloudflare data centres. Enablement propagates, and
enforcing `on` before it has finished produces failures that are *geographically
intermittent* — the worst kind to diagnose, because it looks fine from wherever you are.
Leave real time between step 4 and step 6, and check the logs for `NONE` from a spread of
edge IPs rather than only for `SUCCESS` from your own.

## What AOP does and does not buy

The `ENO-WEB` iptables chain already limits 80/443 to Cloudflare's published ranges. That
is narrower than the internet and much wider than us: **anyone can point their own
Cloudflare zone at `162.4.176.208`**, and their requests arrive from those same ranges.
Today the only thing stopping them is the `server_name` match — an unknown Host gets 444 —
and a Host header is trivially set from a Worker.

Global AOP does not fix this: its certificate is shared by every Cloudflare customer, so
their zone presents a valid one too. **Only a certificate exclusive to our account binds a
request to our zone**, which is why this is zone-level-with-our-own-cert and not the
one-toggle global option. Until it is on, the Transform-Rule header check in `src/proxy.ts`
is the only zone binding we have, and it covers `/api/*` only — not page routes.

## Adjacent gaps found while reading the zone settings

Not part of this task; both are one call and neither is urgent.

* `min_tls_version` is **1.0** on both zones. TLS 1.0/1.1 have been deprecated for years
  and nothing that reaches us needs them — the origin already refuses anything below 1.2
  (`ssl_protocols TLSv1.2 TLSv1.3`), so this only affects visitor→edge.
* `always_use_https` is **on** for eno.vn and **off** for eno.forum. nginx serves both on
  :80, so an http:// request to eno.forum is answered rather than redirected at the edge.
