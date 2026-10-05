# Cloudflare Tunnel `eno-origin` on the VN box

The box dials OUT to Cloudflare, so a colo that cannot open a TCP+TLS connection to Vietnam
(YVR, EWR, IAD and BOS in the 2026-10-03 edge-5xx investigation) reaches the origin inside Cloudflare's
network instead. Full plan, gates, drills and rollback: the runbook
`eno-wb1-backup/plan/cloudflare-tunnel-runbook.md` (revision 4), which lives outside this repo on the
owner's Mac.

**State, 2026-10-05:** preparation P1–P7 done. The tunnel exists with 2 replicas × 4 QUIC
connections to HKG, and **no DNS name points at it**, so it carries zero traffic. Stage 0
(`tunnel-check.eno.vn`, a new name) has not started. Each stage is the owner's "go".

| repo | on the box |
| --- | --- |
| `eno-tunnel-dns.sh` | `/opt/eno/bin/eno-tunnel-dns.sh` (0700 root): DNS snapshot, cut, rollback, verify |
| `eno-tunnel-status.sh` | `/opt/eno/bin/eno-tunnel-status.sh` (0700 root): one screen of health, no token |
| `config.yml` | `/etc/cloudflared/config.yml` (root 0644; no secrets: the credentials file is `/etc/cloudflared/<UUID>.json`, root:cloudflared 0640, never in the repo) |
| `eno-cloudflared@.service` | `/etc/systemd/system/eno-cloudflared@.service`; replicas `@1` (metrics :20241) and `@2` (:20242) |
| `eno-tunnel.conf` | `/etc/nginx/sites-enabled/eno-tunnel.conf`: the `127.0.0.1:8181` default (444), the `tunnel-check.eno.vn` probe, http-level `set_real_ip_from 127.0.0.1` |

⛔ **`eno.conf` AND `partner.eno.vn.conf` CARRY AN EXTRA `listen 127.0.0.1:8181;`** under every
`listen 443 ssl;  listen [::]:443 ssl;` line (5 + 1). That is the whole tunnel path on the nginx side. The
copies in `../nginx/` were reconciled with the box on 2026-10-05, directive for directive; they had drifted
before this work (`../nginx/README.md` lists the comments still stale on the box). Once a hostname is cut
over, a config without the 8181 listens sends its Host to the 444 default and every visitor of that name
gets 502. That is why `cut` now refuses unless `precheck` passes.

**Changes from runbook revision 4, all in `eno-tunnel-dns.sh`:**
- `selftest` verifies the token at `/accounts/<acct>/tokens/verify` first. The token was created under
  Manage account → Account API tokens, and `/user/tokens/verify` answers "Invalid API Token" for an
  account-owned token. It falls back to the user endpoint, so a user-owned replacement passes too.
- `deploying()` matches `[e]no-deploy[.]`. `eno-deploy.sh` re-execs from `/tmp/eno-deploy.XXXXXX.sh`, so
  the old pattern naming `/opt/eno/app/infra/vn-node/eno-deploy` missed a deploy started without a
  wrapper, and `cut` could have run mid-deploy. The new pattern matches with or without `--expect`. Its
  only false positive, such as an editor open on the script, refuses a cut, which is the safe direction.
- **`precheck <stage>`** (read-only, and the first thing `cut` runs for every name of the stage): both
  replicas `/ready` AND nginx :8181 answers that name's Host with a 2xx–4xx. `/ready` only proves the edge
  side. The non-app hosts must give their OWN answer, because an app answer under the wildcard would hide a
  missing vhost: `tunnel-check` returns 200 "tunnel ok"; `partner` returns 200 with its vhost's
  `Cache-Control: public, max-age=300`; `sb` and `tunnel-sb` return the Supabase gateway's 401 on
  `/auth/v1/health`, where the app answers 404. A wildcard is probed as `tunnel-precheck.<zone>`, and `tunnel-sb` as `sb.eno.vn` (the ingress
  rewrites Host). Measured 2026-10-05, every stage passes: 200/308 for the apps, 401 from the Supabase
  gateway, 404 from the app for an unknown shop.
- **⛔ The licensing boundary, per name, in the same precheck:** `/api/v1/status` (exempt from the
  edge-header gate, so it answers on loopback) must name the `marketplace` build for every eno.vn app name
  and `services` for every eno.forum name. `www.eno.vn` is different: BOTH builds answer it with a 308 to
  the same path on the apex (measured, `/visa` included), so a redirect proves nothing about the build.
  Its check is what actually protects it: every probed path, a services-only one included, redirects to
  the apex, whose edition the same stage checks. A crossed mapping refuses the cut. Verified against stubbed answers: crossed editions, a redirect to the other site or a look-alike
  host, 403 and no answer all refuse.
- **Stage guards in the same precheck:**
  - Both replicas must have started after the last `config.yml` change, because cloudflared reads it only at
    start. It compares ctime, not mtime: `cp -p`, `rsync -a` and `scp -p` can backdate mtime.
  - `cut` re-checks for a running deploy before every DNS write, not just once.
  - 8181 must be bound to `127.0.0.1` only, and `route_localnet` must be 0 on every interface (Docker sets
    it to 1 on a bridge when userland-proxy is off).
  - ⛔ **Stage 3 refuses while `config.yml` still routes `tunnel-sb.eno.vn`.** Once `*.eno.vn` is on the
    tunnel, that wildcard carries every eno.vn ingress name. The Stage 0b rule would then serve the
    Supabase gateway as `tunnel-sb.eno.vn` for good, past every Cloudflare rule keyed on `sb.eno.vn`,
    including the OTP rate limits. After Stage 0b, delete that rule and restart the replicas one at a time.
  - `partner.eno.vn` has no DNS record of its own (it rides `*.eno.vn`), so Stage 3 probes it too.
- `verify 0` / `verify 0b` read the test name's record: none, proxied CNAME to this tunnel, or ✗.
- `gap-create` adopts and `gap-delete` deletes only records this script made (comment `eno tunnel…`, the
  origin IP or this tunnel), and a refused DELETE exits non-zero.

**Known limits, from the 2026-10-05 review:**
- `rollback all` covers the traffic stages (3 4 2 2b 1), not the test names. A full teardown after Stage
  0 also needs `rollback 0`, `rollback 0b` and `gap-delete`, in the runbook's Stage 0 rollback order
  (silence the alert policy first).
- **Before Stage 0b:** while it runs, `tunnel-sb.eno.vn` serves sb's vhost under a second public name, so
  a Cloudflare rule keyed on `http.host eq "sb.eno.vn"` (cache, WAF, rate limit, Access) does not cover
  it. List both zones' rules for that host first, and mirror them or keep 0b short. After 0b, remove its
  ingress rule; the Stage 3 guard above enforces this.
- An nginx-built RELATIVE redirect on an 8181 vhost would come out as `http://<host>:8181/…`. None exists
  today: no `$scheme`, `$server_port` or `rewrite` in the config, every `return 301` is an absolute https
  URL, and the app gets the same headers on both paths (`X-Forwarded-Proto` is hard-coded https). Keep it
  that way, or set `absolute_redirect off`.
- `set_real_ip_from 127.0.0.1` (http level) lets ANY local process, root or not, choose the client IP the
  app sees, by sending `CF-Connecting-IP` to :8181. On :443 AOP refuses it first. Runbook §2.2 accepts this:
  it needs code execution on the origin box already, and bridge containers cannot reach host loopback.
  To close it, have nginx listen on a Unix socket in a directory only the `cloudflared` group can
  traverse, and set cloudflared's `service: unix:` to it.
- A stage that stops midway (`cut` stops at its first failed name) leaves some names on the tunnel and
  some on their A records. Both paths reach the same nginx and the same containers, so that state is safe
  to stay in while you finish the stage or roll it back.
- The unit's `--metrics 127.0.0.1:2024%i` works for replicas 1–9 only (`@10` would ask for port 202410).

**Rollback of the preparation** (nothing routes through the tunnel yet, so any order works):
`systemctl disable --now eno-cloudflared@1 eno-cloudflared@2`; delete the tunnel in the dashboard (or
`DELETE /accounts/<acct>/cfd_tunnel/<UUID>` with the token); restore nginx from
`/root/nginx-backup-20261005T084735Z` (runbook P4), then `nginx -t && systemctl reload nginx`, and copy
the restored files back into `../nginx/`.
