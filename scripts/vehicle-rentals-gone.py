#!/usr/bin/env python3
"""
Which imported HCMC vehicle rentals are GONE at the source — the positive-signal list the weekly
refresh (scripts/vehicle-rentals-weekly.sh) passes to `import-vehicle-rentals.ts --gone`.

    python3 scripts/vehicle-rentals-gone.py --prev <snapshot dir> \
        --mioto ~/mioto_rentals_vn --bonbon ~/bonboncar_rentals_vn --bikes ~/motorbike_rentals_vn \
        --out gone.txt [--no-probe]

⛔ ABSENCE IS NOT A SIGNAL ON ITS OWN. A car missing from this run's search may simply be booked
in every window we asked about. So a row is written only on a POSITIVE answer that it no longer EXISTS:
  · Mioto     — absent from every window of the fresh search AND /car/detail answers HTTP 404/410 or
                the not-found code (MIOTO_NOT_FOUND);
  · BonbonCar — absent from the fresh fleet AND /detail/<SKU> no longer carries a car (the site
                answers 200 for any SKU; see bonbon_gone);
  · shops     — absent AND its page answers 404/410 (confirmed by the shop's homepage answering).
⛔ PAUSED IS NOT GONE, AND NEITHER IS OUT OF STOCK ('hidden' is ONE-WAY: nothing ever revives it).
  · A car whose own status is no longer active (Mioto ≠ 2, BonbonCar ≠ 'Onboard') used to be a gone signal here
    — so an owner who paused a car for a week lost it for good (measured: 1 of the 57 Mioto cars hidden on 10-05
    was listed again on 10-12; review 2026-10-13). Now it is INACTIVE: an answer, so it is dropped from the
    baseline (asked no more, never "unresolved"), and the status step expires it — revivably — on its own record
    (notActive) or, absent, on its absence count (src/lib/vehicle-status-plan.ts).
  · A bike out of stock (owner, 2026-10-13: keep a bike "still listed (and in stock, for Jan's) on its shop's site
    in the last 3 checks") is simply not PRESENT for the status step's 3-check rule: out of stock three checks
    running → 'expired', back in stock → revived.
A network failure (timeout, DNS, 5xx), any other API error, or a missing status field is UNKNOWN,
never gone — and every probe run is controlled by re-checking a known-live car (see `controlled`).

⛔ A SHORT SCRAPE RETIRES NOTHING. If a source returned fewer than 80% of last run's HCMC count, the
whole source is skipped this run: a half-failed scrape would otherwise read as a mass delisting,
and retirement is one-way (status is create-only in the importer). A source the job left out of this
run (its scrape failed: no --mioto / --bonbon / --bikes) keeps its baseline untouched.

Stdlib only; ~1 request/s per host.
"""
import argparse
import json
import os
import ssl
import sys
import time
import urllib.error
import urllib.request

UA = ('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 '
      '(KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36')
CTX = ssl.create_default_context(cafile='/etc/ssl/cert.pem') if os.path.exists('/etc/ssl/cert.pem') \
    else ssl.create_default_context()
MIN_SHARE = 0.8
# An absent row with no positive answer is re-asked for this many runs, then dropped from the baseline.
MAX_CARRIED = 4
UNRESOLVED = []  # absent MAX_CARRIED runs with no answer: listed for the owner, never auto-retired
# What a probe of an ABSENT row can answer. None = no answer (unknown): asked again next run.
GONE = 'gone'          # it no longer exists at the source → 'hidden' (one-way)
INACTIVE = 'inactive'  # it exists, paused / not active → not gone; the status step expires it (revivable)
SHOPS = {'janmotorbike', 'theextramile', 'dungmotorbikes', 'tuanmotorbike', 'rentabikevn'}


# Keys are trimmed exactly as the importer trims them (vehicle-rental-listing.ts), so a padded id in a scrape
# names the same row here as in the database.
def hcmc_mioto(rows):
    return {str(r['id']).strip(): r for r in rows if r.get('city') == 'TP. Hồ Chí Minh'}


def hcmc_bonbon(rows):
    return {str(r['sku']).strip(): r for r in rows if r.get('city') == 'Hồ Chí Minh'}


def hcmc_bikes(rows):
    return {f"{r['shop']}:{str(r['external_id']).strip()}": r for r in rows
            if r.get('shop') in SHOPS and 'Ho Chi Minh' in (r.get('city') or '')}


def load(path, pick):
    if not path or not os.path.exists(path):
        return None
    return pick(json.load(open(path, encoding='utf-8')))


_last = {}


def get(url, headers=None):
    """(status, body) — status 0 = network failure (unknown)."""
    host = url.split('/')[2]
    wait = _last.get(host, 0) + 1.0 - time.monotonic()
    if wait > 0:
        time.sleep(wait)
    _last[host] = time.monotonic()
    req = urllib.request.Request(url, headers={'User-Agent': UA, **(headers or {})})
    try:
        with urllib.request.urlopen(req, timeout=30, context=CTX) as r:
            return r.status, r.read()
    except urllib.error.HTTPError as e:
        return e.code, b''
    except Exception:  # noqa: BLE001 — timeout/DNS/TLS: unknown, never gone
        return 0, b''


MIOTO_NOT_FOUND = -10200  # what /car/detail answers for an id that does not exist (measured 2026-09-28)
CONTROL_EVERY = 50
_probes = {'mioto': 0, 'bonbon': 0}
_control_ok = {}


def mioto_detail(car_id):
    status, body = get(f'https://m-car.mioto.vn/car/detail?carId={car_id}',
                       {'Origin': 'https://www.mioto.vn', 'Referer': 'https://www.mioto.vn/'})
    try:
        j = json.loads(body) if status == 200 else None
    except ValueError:
        j = None
    return status, (j if isinstance(j, dict) else None)


def controlled(src, check):
    """⛔ Every CONTROL_EVERY probes, re-check a car that IS in this week's fleet. If it does not read
    as live, the source is blocking, rate-limiting or has changed shape — everything is unknown."""
    if _probes[src] % CONTROL_EVERY == 0:
        _control_ok[src] = check()
    _probes[src] += 1
    return _control_ok[src]


def mioto_gone(car_id, control_id):
    """GONE, INACTIVE or None (unknown) for a Mioto car absent from the fresh search."""
    def live_control():
        st, j = mioto_detail(control_id)
        return bool(j) and j.get('error') == 0 and ((j.get('data') or {}).get('car') or {}).get('id') == control_id
    if not controlled('mioto', live_control):
        return None
    status, j = mioto_detail(car_id)
    if status in (404, 410):
        return GONE if live_control() else None  # a moved endpoint answering 404 must not read as a delisting
    if not j:
        return None
    car = (j.get('data') or {}).get('car') or {}
    if j.get('error') == MIOTO_NOT_FOUND:
        # ⛔ CONFIRMED against the live control IMMEDIATELY after: -10200 is also Mioto's generic error, so
        # a block starting mid-run must not read as a delisting (plan reviewer).
        return GONE if live_control() else None
    # The car's own explicit status, not active: paused by its owner — it exists, so it is NOT gone.
    if j.get('error') == 0 and 'status' in car and car['status'] != 2:
        return INACTIVE
    return None


def page_gone(url, shop_url=None):
    """GONE when a shop product page answers 404/410 — confirmed by the shop's own homepage still
    answering 200, so a redesign or a CDN outage that 404s everything is unknown (None), not a delisting."""
    status, _ = get(url)
    if status not in (404, 410):
        return None
    return GONE if not shop_url or get(shop_url)[0] == 200 else None


BONBON_MARK = b'carDetail'  # inside escaped RSC flight strings, so no quotes around it


def bonbon_gone(sku, control_sku):
    """BonbonCar answers 200 for ANY /detail/<SKU> (a client-side not-found), so a status code proves
    nothing. A real car page carries the `carDetail` flight object the scraper parses; a delisted one
    does not. ⛔ CONTROLLED (see `controlled`): the marker is re-checked on a live car every
    CONTROL_EVERY probes — a challenge page or a markup change makes every answer unknown."""
    def live_control():
        st, body = get(f'https://www.bonboncar.vn/detail/{control_sku}')
        return st == 200 and BONBON_MARK in body
    if not controlled('bonbon', live_control):
        return None
    st, body = get(f'https://www.bonboncar.vn/detail/{sku}')
    verdict = st in (404, 410) or (st == 200 and len(body) > 20_000 and BONBON_MARK not in body)
    # ⛔ A challenge or error page also lacks the marker: confirm on the live control right away.
    return GONE if verdict and live_control() else None


def source(name, prev, cur, out, nxt, probe_absent, prefix=''):
    """Append this source's gone externalIds to `out`, put next run's baseline in `nxt[name]`, and
    return a one-line report. `probe_absent(key, row)` answers GONE, INACTIVE or None (unknown).

    ⛔ THE BASELINE CARRIES FORWARD WHAT GOT NO ANSWER. It is this run's rows PLUS every row that was
    absent and got no answer — so an inconclusive probe is asked again next run rather than dropping
    out of view with the listing still live. An INACTIVE row got its answer (it exists, paused): it
    leaves the baseline, and the status step expires it revivably. A skipped source keeps last run's
    baseline whole.
    """
    if prev is None or cur is None:
        nxt[name] = cur if prev is None else prev
        return f'{name}: {"no previous snapshot" if prev is None else "no fresh dataset"} — retire skipped'
    # The guard compares with last run's FRESH scrape, not with carried-forward rows, so unknowns
    # cannot ratchet the baseline up until every week reads as "short" (reviewer).
    fresh_prev = sum(1 for r in prev.values() if not r.get('_carried'))
    if len(cur) < MIN_SHARE * fresh_prev:
        nxt[name] = prev
        return f'{name}: fresh {len(cur)} < 80% of last run {fresh_prev} — retire SKIPPED, baseline kept'
    gone, unknown, inactive = [], {}, 0
    absent = [k for k in prev if k not in cur]
    for key in absent:
        answer = probe_absent(key, prev[key])
        if answer == GONE:
            gone.append(key)
        elif answer == INACTIVE:
            inactive += 1
        elif int(prev[key].get('_carried') or 0) < MAX_CARRIED:
            unknown[key] = {**prev[key], '_carried': int(prev[key].get('_carried') or 0) + 1}
        else:
            # ⚠️ Never retired without a positive answer — handed to a human instead (unresolved.txt).
            UNRESOLVED.append(prefix + key)
    # externalIds exactly as the importer writes them (vehicle-rental-listing.ts): mioto:<id>,
    # bonboncar:<sku>; bike keys are already <shop>:<external_id>.
    out.extend(prefix + k for k in gone)
    nxt[name] = {**unknown, **cur}
    return (f'{name}: last run {len(prev)}, fresh {len(cur)}, absent {len(absent)} → gone {len(gone)}, '
            f'inactive (not gone; the status step expires it) {inactive}, unknown (carried forward) {len(unknown)}')


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--prev', required=True, help="dir holding last run's mioto.json / bonbon.json / bikes.json")
    ap.add_argument('--mioto'); ap.add_argument('--bonbon'); ap.add_argument('--bikes')
    ap.add_argument('--out', required=True)
    ap.add_argument('--next-baseline', help='dir to write next run\'s baseline into (the job promotes it after --apply)')
    ap.add_argument('--no-probe', action='store_true', help='report only; absent rows count as unknown')
    a = ap.parse_args()
    probe = not a.no_probe
    out, nxt, lines = [], {}, []

    cur = load(a.mioto and os.path.join(a.mioto, 'all_rentals.json'), hcmc_mioto)
    ctl = next((k for k, r in (cur or {}).items() if r.get('status') == 2), None)
    lines.append(source('mioto', load(os.path.join(a.prev, 'mioto.json'), hcmc_mioto), cur, out, nxt,
                        lambda k, _r: mioto_gone(k, ctl) if probe and ctl is not None else None, 'mioto:'))
    cur = load(a.bonbon and os.path.join(a.bonbon, 'all_rentals.json'), hcmc_bonbon)
    ctl = next((k for k, r in (cur or {}).items() if r.get('status') == 'Onboard'), None)
    lines.append(source('bonboncar', load(os.path.join(a.prev, 'bonbon.json'), hcmc_bonbon), cur, out, nxt,
                        lambda k, _r: bonbon_gone(k, ctl) if probe and ctl is not None else None, 'bonboncar:'))
    cur = load(a.bikes and os.path.join(a.bikes, 'all_rentals.json'), hcmc_bikes)
    # ⛔ never "gone" for being out of stock — the 3-check rule expires it, revivably (docstring)
    lines.append(source('shops', load(os.path.join(a.prev, 'bikes.json'), hcmc_bikes), cur, out, nxt,
                        lambda k, r: page_gone(r['source_url'], r.get('shop_url')) if probe and r.get('source_url') else None))

    with open(a.out, 'w', encoding='utf-8') as f:
        for k in out:
            f.write(k + '\n')
    if a.next_baseline:
        os.makedirs(a.next_baseline, exist_ok=True)
        for name, fname in (('mioto', 'mioto.json'), ('bonboncar', 'bonbon.json'), ('shops', 'bikes.json')):
            if nxt.get(name) is not None:
                json.dump(list(nxt[name].values()), open(os.path.join(a.next_baseline, fname), 'w', encoding='utf-8'), ensure_ascii=False)
    if UNRESOLVED:
        with open(os.path.join(os.path.dirname(os.path.abspath(a.out)), 'unresolved.txt'), 'w', encoding='utf-8') as f:
            f.write('\n'.join(UNRESOLVED) + '\n')
        lines.append(f'UNRESOLVED {len(UNRESOLVED)}: absent {MAX_CARRIED} runs, no answer — check by hand (unresolved.txt)')
    for line in lines:
        print('  ' + line)
    print(f'  gone total {len(out)} → {a.out}')


if __name__ == '__main__':
    sys.exit(main())
