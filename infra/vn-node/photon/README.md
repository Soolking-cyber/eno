# eno-photon — place search as you type (OpenStreetMap, on eno's own box)

**Why.** Owner, 2026-11-12, the Facebook import: *"when typing addresses show suggestions like macdonalds thao dien show
exact address of that place similar to shoppee address or grab"*. Offered Goong, Google Places or free OpenStreetMap on
our own server; the owner chose **free OpenStreetMap**. Nominatim (what /api/geocode/search uses, on Enter) forbids
search-as-you-type in its usage policy, so the suggestions come from [Photon](https://github.com/komoot/photon) — komoot's
OpenStreetMap search engine, built for exactly this — running here with OpenStreetMap's Vietnam data.

Measured on Photon's public instance the same day (same software, same data): "mcdonalds thao dien" → *McDonald's,
159-161 Đường Võ Nguyên Giáp, An Khánh, Thủ Đức*; "12 Thao Dien" → CGV / Tops Market at 12 Quốc Hương; "Cho Ben Thanh"
→ Chợ Bến Thành. Unaccented typing works.

**Pieces.**
- `photon.compose.yml` — the `eno-photon` container: `eclipse-temurin:21-jre-noble` running the pinned `photon.jar`
  from `/opt/eno/photon`, on `supabase_default`, **no published port** (Docker bypasses ufw).
- `install.sh` — first install: downloads komoot/photon 1.3.0 (**SHA-256 pinned**), runs the refresh, enables the timer.
- `photon-refresh.sh` + `eno-photon-refresh.{service,timer}` — weekly (Sun 05:15 ICT): downloads GraphHopper's weekly
  Vietnam dump (md5 checked), imports it into a new `data-<stamp>` while the old index keeps answering, then repoints the
  `data` symlink (stop → one rename → start) and points it back if the new one does not answer from inside `eno-vn-app`.
  Nothing the symlink points to is ever removed. Skips while a deploy runs; one run at a time (flock). The timer runs the
  repo copy (`/opt/eno/app/infra/vn-node/photon/photon-refresh.sh`), so a deploy carries its fixes.
- App side: `src/app/api/geocode/suggest/route.ts` + `src/lib/geo-suggest.ts`; `PHOTON_URL` overrides
  `http://eno-photon:2322` (a local run). **Missing or down = "not available"**: the picker says "press Enter" and
  searches Nominatim the old way, so the app can ship before this container exists and survives it stopping.

**Install (once, after the deploy that carries this folder).**

    ssh … root@162.4.176.233 'bash /opt/eno/app/infra/vn-node/photon/install.sh'

About 2 GB of RAM while serving (1 GB heap), ~3 GB more during a refresh; on disk the dump (~71 MB) and one index (two
during a refresh) — measure with `du -sh /opt/eno/photon` after the install.

**If the refresh says "data is a plain directory with files in it".** Someone started the container before the first
index existed and something wrote into it. Look at it, move it aside by hand (`mv data data-old-manual`), and run the
refresh again — it never renames a directory a server may be using.

**Remove.** `docker compose -f /opt/eno/app/infra/vn-node/photon/photon.compose.yml down`,
`systemctl disable --now eno-photon-refresh.timer`, `rm -rf /opt/eno/photon`. The picker falls back to Enter by itself.

**Licence.** OpenStreetMap data, © OpenStreetMap contributors (ODbL) — the import map already carries the credit
(src/lib/map-credit.ts). Photon is Apache-2.0.
