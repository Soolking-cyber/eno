# Cutover: eno.vn + eno.forum → 162.4.176.208

⛔ **Rollback is written first, on purpose.** Read it before doing anything else.

## ✅ READY — all blockers cleared 2026-08-22

The six-dimension adversarial audit found 12 confirmed blockers. Every one is closed
or consciously accepted:

| # | blocker | state |
| --- | --- | --- |
| 1 | CSP pinned the hosted Supabase host | ✅ derived from env; both images rebuilt |
| 2 | `next/image` pinned likewise | ✅ `/_next/image` returns 200 for `sb.eno.vn` |
| 3 | FOUR A records, not two | ⬜ **the change itself, below** |
| 4 | Google sign-in dead on the box | ✅ live; consent screen reads **eno.vn** |
| 5 | listing image URLs absolute on the old host | ✅ all 30 rewritten, 5/5 render |
| 6 | Vertex AI Search needs `K_SERVICE` | ⚠️ **accepted** — AI search degrades off Cloud Run until a service-account key is granted. Gemini is unaffected. |
| 7 | backups on the database's own disk | ✅ **822 MiB dump proven in Bizfly**; ⛔ Bizfly needs `v2_auth` to write |
| 8 | cached HTML across the swap | ✅ purge is step 6 below AND step 1 of rollback |

Also done since: the box has its own systemd cron timers (GCP's schedules do not
survive the migration), and the GCP scheduler secret was fixed — every cron had been
failing UNAUTHENTICATED, so PII retention was not running at all.

**Data parity re-verified immediately before cutover**, not from an earlier run:
Listing 30, Message 43, auth.users 7, Report 4 — counts AND newest timestamps
identical on both sides. No writes since the migration, so the flip loses nothing.

## The change

Four Cloudflare A records move from the GCP load balancer to the VN box. Nothing
else changes — same Cloudflare zones, same certificates, same DNS names.

| record | from | to |
| --- | --- | --- |
| `eno.vn` | `8.232.86.0` | `162.4.176.208` |
| `www.eno.vn` | `8.232.86.0` | `162.4.176.208` |
| `eno.forum` | `8.232.86.0` | `162.4.176.208` |
| `www.eno.forum` | `8.232.86.0` | `162.4.176.208` |

All four are **proxied** (orange), so client TTL is irrelevant: Cloudflare's edge
starts pulling from the new origin within seconds. That cuts both ways — it is why
rollback is fast, and why a mistake is immediate.

## Rollback

⛔ **THERE IS NO DNS ROLLBACK ANY MORE. The Cloud Run services were deleted on
2026-08-23** (owner: *"gcp deleted"*). Verified the same day: `gcloud run services
list` returns nothing. The load-balancer forwarding rules still answer on
`8.232.86.0`, which makes this worse rather than better — pointing the four records
back now sends every visitor to a load balancer with **no backend**, so the "old
origin" they reach is an error page, not the old app.

What this section used to say — *set the records back to 8.232.86.0, Cloud Run stays
warm* — was true for exactly two days and is now the most dangerous line in this
file. It is kept here, struck through, because the instinct in an outage is to
remember that a DNS rollback existed.

**What recovery looks like instead:**

1. `eno-deploy.sh --rollback` — the real path now. It restores the `eno-vn:prev` /
   `eno-forum:prev` images, which are pinned from the actually-serving containers at
   the start of every deploy. This works **only** if those tags exist; the script
   refuses to deploy without them for exactly this reason.
2. If no `:prev` exists, build the last good commit from source (~20 min per edition,
   site broken throughout):
   ```bash
   git -C /opt/eno/app worktree add /tmp/rb <last-good-sha> && …
   ```

⚠️ **The one thing rollback still does NOT undo: writes.** Rolling back the IMAGE
does not roll back the database. Schema-affecting changes are gated by the
`last-deployed-sha` check in `eno-deploy.sh`, but a data migration run by hand is
yours to reverse.

⚠️ Still present in GCP and NOT load-bearing: the LB forwarding rules, Artifact
Registry images, and eight PAUSED schedulers. The forwarding rules cost money and
serve nothing — worth deleting deliberately rather than leaving as a trap that looks
like a fallback.

### Box status

Blockers 1, 2 and 5 are closed and verified. The box serves a CSP naming
`https://sb.eno.vn` and `wss://sb.eno.vn`, `/_next/image` returns 200 for stored
listing URLs, and the licensing boundary still holds (`/visa` and `/itinerary`
404 on eno.vn) after the rebuild.

Rollback for the URL rewrite, if ever needed:

```sql
update "Listing" l set images = b.images
  from _image_url_backup_20260822 b where b.id = l.id;
```

⚠️ The box was also upgraded (120 packages, kernel 6.8.0-138) and rebooted on
2026-08-22 — deliberately BEFORE cutover, because the same reboot afterwards is an
outage. The firewall was re-verified from off-box after it came back.

## Order

0. ⛔ Clear every blocker in the table above. In particular **rebuild both images** —
   the CSP and `remotePatterns` fixes are build-time and an env change does nothing.
1. Verify data parity one more time (prod vs box row counts + newest timestamps).
2. Move `eno.forum` and `www.eno.forum` FIRST — BOTH, they are separate records. It is the smaller surface and it is
   not the licensed marketplace, so a mistake there costs less.
3. Verify the forum end to end, including that `/itinerary` still serves.
4. Then move `eno.vn` and `www.eno.vn`.
5. Verify eno.vn, and **explicitly re-check the licensing boundary on the real
   hostname**: `/visa` and `/itinerary` must 404. Verifying it on `vn-test` is not
   the same test — that is a different server block.
6. Purge Cloudflare (`purge_everything`, both zones). The homepage is cached for 6h;
   without this the cutover is invisible and so is any problem with it.
7. Watch `/var/log/nginx/*.access.log` and `docker stats` for the first minutes.

## After it is stable

- Delete `vn-test.eno.vn` from DNS and from `server_name` in `eno.conf`.
- Move both zones to SSL mode **Full (strict)**.
- Finish Authenticated Origin Pulls (see `nginx/README.md`).
- Set `ENO_BACKUP_REMOTE` — backups currently sit on the same disk as the database.
