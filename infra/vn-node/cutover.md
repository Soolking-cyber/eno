# Cutover: eno.vn + eno.forum → 162.4.176.208

⛔ **Rollback is written first, on purpose.** Read it before doing anything else.

## ⛔ DO NOT CUT OVER YET — 8 blockers, found 2026-08-22

A six-dimension adversarial audit ran before the first DNS change. 28 findings, 15
sent for refutation, **12 survived**. Several were found independently by three
auditors. Cutting over before these are fixed produces a site that LOADS and is
functionally dead — which is the worst failure mode, because every status check
still returns 200.

| # | blocker | fixed? |
| --- | --- | --- |
| 1 | **CSP pinned the hosted Supabase host** — `connect-src`/`img-src`/`media-src` allowed only `xihiryllwmjoouipkyhw.supabase.co`, so every browser call to `sb.eno.vn` (token refresh, realtime chat, uploads, photos) is blocked | ✅ **DONE + verified 2026-08-22** — both images rebuilt on `a715407`; the box serves `img-src`/`media-src`/`connect-src` with `https://sb.eno.vn` and `wss://sb.eno.vn` |
| 2 | **`next/image` `remotePatterns`** pinned to the same host — every photo 400s at `/_next/image` | ✅ **DONE + verified** — `/_next/image?url=…sb.eno.vn…&q=60` returns **200** on the box |
| 3 | **FOUR A records, not two.** `www.eno.vn` and `www.eno.forum` are separate records still on the GCLB — and `www.eno.forum` is the forum's own `NEXT_PUBLIC_APP_URL`, so every forum magic link would land on the old stack and keep writing to the old database | ⬜ plan corrected below |
| 4 | **Google sign-in is dead** — the self-hosted GoTrue has no Google provider configured, and Google's OAuth client does not know `sb.eno.vn/auth/v1/callback` | ⬜ needs GoTrue env + a Google console change |
| 5 | **Listing image URLs are absolute** on `xihiryllwmjoouipkyhw.supabase.co` — all 30 of them | ✅ **DONE + verified 2026-08-22** — all 30 rewritten to `sb.eno.vn` after confirming every object already resolved there (missing 0); backup in `_image_url_backup_20260822`; 5/5 sampled URLs return 200 `image/jpeg` through `/_next/image` |
| 6 | **Vertex AI Search turns itself off** — `K_SERVICE` is a Cloud Run-only variable and is half the auth predicate. Same gate silently drops the Postgres ISR cache to an in-process LRU | ⬜ |
| 7 | **Backups sit on the same disk as the database**, and rollback is one-way for data written after the flip | ⬜ set `ENO_BACKUP_REMOTE` first |
| 8 | **Cached HTML across the swap** — the homepage is cached 6h and 9 of 36 JS chunks 404 on the other origin, at cutover *and* at rollback | ⬜ purge both zones in the same minute as the flip, and make purge step 1 of rollback |

Serious, not blocking: phone auth is ON with `phone_autoconfirm=true` and no SMS
provider (prod has it OFF — a number can be confirmed without ever receiving an
SMS); no cgroup limits, so a 210s transcode can OOM the database sharing the box;
PostgREST burns 1.2 of 8 cores at zero traffic reloading its schema cache 6×/min;
all 7 scheduled jobs live in the GCP project this cutover intends to retire; the
5xx alarm is scoped to `cloud_run_revision` and goes permanently silent.

Refuted, for the record: the `x-eno-edge` Transform Rule secret does NOT break —
the box shares prod's `EDGE_SECRET`, so `/api/*` works. Two auditors disagreed
about this and the measurement settled it.

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
