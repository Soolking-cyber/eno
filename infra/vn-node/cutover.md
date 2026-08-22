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

Set the same four records back to `8.232.86.0`. Cloud Run keeps serving throughout
the cutover — nothing is stopped, scaled to zero or deleted — so the old origin is
warm and rollback is a DNS edit, not a redeploy.

⚠️ **The one thing rollback does NOT undo: writes.** Once traffic serves from the
box, new rows land in the box's Postgres, not the hosted project. Roll back and
those rows are stranded on the box while the site serves the old database. Before
rolling back, dump anything written since cutover:

```bash
ssh … 'docker exec supabase-db pg_dump -U postgres -d postgres \
  --data-only -t "\"Listing\"" -t "\"Message\"" -t auth.users' > post-cutover-delta.sql
```

⛔ **Do not delete ANY GCP resource until the box has served real traffic for a
few days.** The Cloud Run services, the load balancer, the images and the hosted
Supabase project are the rollback path. Deleting them converts a two-minute DNS
edit into a rebuild.

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
