# Listing image serving

Both editions use Next's built-in optimizer. `src/lib/image-loader.ts` changes only the original
URL for canonical first-party listing rasters to `/listing-images?key=<object key>`.
The public original URLs stored in the database, shared externally, and used by native clients
are unchanged. Never set `NEXT_PUBLIC_SUPABASE_URL` to an internal Docker address.

`apps.compose.yml` sets `LISTING_IMAGES_INTERNAL=true` on **both** app containers. The image route
then reads the fixed `supabase-envoy:8000` service on `supabase_default`. This avoids the broken
server → public Cloudflare → same server round trip observed on 2026-09-11. With the flag absent,
local previews read the configured public storage origin. The route does not forward credentials,
accept arbitrary URLs, follow redirects, or access any bucket except public `listings` rasters.

Keep `images.loader` at its default: setting it to `custom` disables `/_next/image`, even though
`images.loaderFile` is set. Do not enable `dangerouslyAllowLocalIP` or open storage port 8000 to
the internet. App-container recreation through the canonical deploy script applies the compose
flag; merely restarting an old container does not change its environment.

## Verification

Before deployment, use the normal local production previews, one edition at a time. After an
explicitly authorized deployment, check both sites. The following is read-only; replace the key
with an existing, preferably newly uploaded image to exercise cold rather than only warm caches:

```sh
node scripts/check-listing-images.mjs http://localhost:3000 --key=affiliate/example.webp
node scripts/check-listing-images.mjs http://localhost:3101 --key=affiliate/example.webp
node scripts/check-listing-images.mjs https://eno.vn https://eno.forum --key=affiliate/example.webp
```

The probe requires successful, decodable, correctly sized AVIF and WebP responses at two widths.
It never uploads, deletes, or purges caches. Also verify real browser `currentSrc` URLs use the
local original route; testing that route alone does not prove the frontend is wired correctly.
Socket/container health is not a substitute for this check.

Promo artwork is a separate static path. Its bounded recovery removes AVIF sources after an
AVIF failure, keeps the responsive WebP pair, then displays the existing translated message if
WebP also fails. It also detects failures that completed before hydration. Asset updates must
bump content-hash query versions. Test the banner with AVIF requests blocked, then both formats
blocked, at desktop and mobile widths.

Production deployment remains owner-authorized, through `infra/vn-node/eno-deploy.sh` only. Use
the existing deployment rollback workflow if functional image verification fails. Old application
artifacts still depend on public storage connectivity: rollback alone does not repair the
external network path. This application fix does not claim to repair provider/Cloudflare routing
or other unrelated server requests to blocked external hosts.

## The optimizer cache is a volume, and it must stay capped

Measured on the box, 2026-09-14, while chasing "images don't load fast enough when scrolling":

| | |
|---|---|
| Cold AVIF encode, one variant | **505 ms** |
| Same variant served warm | **120 ms** |
| Eight cold variants in parallel, as a scroll triggers | **1.2 s → 3.3 s** |
| Widths the feed requests per photo | 6 (128/256/360/420/640/1080), `q=60` only |

⛔ **`docker inspect eno-vn-app` returned `Mounts: []`.** The 173MB / 3,330-entry cache at
`/app/.next/cache/images` (forum: 145MB / 3,259) lived in the container layer, so every
`up -d --force-recreate` destroyed it. At ~505ms an entry that is roughly **28 minutes of encode
work discarded per deploy** — and the deploy does not pay it, the next visitors to scroll do.
`apps.compose.yml` now mounts `eno-vn-image-cache` / `eno-forum-image-cache` there.

⚠️ **The Dockerfile creates the directory on purpose.** Docker seeds a new named volume from the
image's content at the mount path, ownership included. With the path absent the daemon creates it
root-owned, `server.js` runs as `nextjs(1001)`, every cache write fails, and the optimizer quietly
re-encodes on every request — a slower site than before, with no error anywhere to find it by.

⛔ **PERSISTENCE REMOVED THE ONLY THING BOUNDING GROWTH.** 496,377 listing rasters × 6 widths at
the measured ~52KB/entry is **~156GB** against a 120GB disk with 22GB free. The volume is only
safe with `eno-image-cache-prune.timer` installed. It evicts whole cache-key directories down to
80% of the cap, **hourly** — a nightly ceiling is not a ceiling, since a crawler walking the
catalogue can cross 22GB in well under a day, and the run is a single `du` per edition when under
cap.

Three things in that script are counter-intuitive and were each caught by review and then measured
on the box, so do not "simplify" them back:

- **The mount source is read off the running container, never guessed from a volume name.**
  Compose prefixes named volumes with the project, so these are actually
  `vn-node_eno-vn-image-cache` / `vn-node_eno-forum-image-cache`. A `docker volume inspect` on the
  bare key fails, the script logs a reassuring skip and exits 0, and the volume grows to the disk
  limit with nothing reporting a problem.
- **Sizes are accounted in KB.** `du -s --block-size=1M` rounds every entry up to a whole
  megabyte: measured, a 52KB key directory reports `1`. Subtracting that from a running total
  credits ~20× the space actually reclaimed, so the prune stops far above the cap and logs
  success. The script also re-measures with `du` at the end rather than reporting its own
  arithmetic.
- **A key is scored by the newest atime among its files, not by the directory's own atime.**
  Measured here: reading `<key>/<file>` moves the file's atime and leaves the directory's
  untouched, so scoring directories sorts by creation order — evicting the oldest *photos*, which
  on a marketplace are exactly the listings people still browse. `/` is mounted `relatime`, so
  atime advances at most once a day; coarse, but real read information, where mtime is creation
  time again.

Install (root, once — same shape as `eno-docker-prune`):

```sh
install -m 0755 /opt/eno/app/infra/vn-node/eno-image-cache-prune.sh /opt/eno/bin/
install -m 0644 /opt/eno/app/infra/vn-node/eno-image-cache-prune.{service,timer} /etc/systemd/system/
systemctl daemon-reload && systemctl enable --now eno-image-cache-prune.timer
systemctl start eno-image-cache-prune.service && journalctl -u eno-image-cache-prune -n 20 --no-pager
```

Raise `ENO_IMAGE_CACHE_CAP_MB` in the unit on the 24GB/150GB box; 4096 per edition is sized for
the 22GB free on the current one.

⚠️ **The first deploy after this change is still cold** — the volume starts empty, so the cache
rebuilds once. It is the last time it has to.

### ⛔ Withdrawn rasters: bounded here, not yet purged

The wipe-per-deploy was incidentally the only thing that ever purged an encoded variant of a photo
that had been **taken down**. All three reviewers ranked this their top finding, and measuring it
made it worse than any of them said:

⚠️ **THE WINDOW WAS A YEAR, NOT THIRTY DAYS.** `/_next/image` entries are keyed on URL + width +
quality, and Next expires them on **the larger of** the upstream `Cache-Control` and
`images.minimumCacheTTL`. Measured 2026-09-14, the source objects return
`cache-control: max-age=31536000` — so the effective TTL is **one year**, and *lowering
`minimumCacheTTL` cannot shorten it*. The obvious knob does nothing; that is why the bound lives in
the pruner instead.

`ENO_IMAGE_CACHE_MAX_AGE_DAYS` (default **7**) evicts entries by age on every hourly run,
independently of the size cap, so a deleted source stops being served within a week. The cost was
checked rather than assumed: ~3,800 live entries re-encoded at most once a week is ~32 minutes of
CPU spread across the week, and any one visitor pays a single ~505ms cold encode.

⛔ **THIS IS A BOUND, NOT A PURGE, AND THE PURGE IS STILL OWED.** A moderation takedown of illegal
or personal content should stop serving *immediately*, not within seven days. The real fix is a
hook on the takedown path that drops the matching cache-key directories (and purges the edge, which
`max-age=31536000` means has never been invalidated by a takedown either — only by the deploy's
`purge_everything`). That is a separate commit against the moderation path, deliberately not
bundled into a performance change. Do not treat the seven days as closing it.
